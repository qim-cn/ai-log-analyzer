"""
日志脱敏服务

在日志内容写入数据库/磁盘之前，用占位符替换敏感信息，
防止公司敏感数据（IP、手机号、邮箱、token、API key、身份证号）
随日志内容泄露给外部 LLM API。

特性：
- 同一文件内同一敏感值映射到同一占位符（如 [IP_1]、[PHONE_2]），
  保证 AI 分析时仍能区分不同实体。
- 占位符 -> 原始值的映射按日志文件持久化（log_files.masking_map），
  供将来可能的还原使用。
- 开关：settings.mask_sensitive_data（环境变量 MASK_SENSITIVE_DATA，默认开启）。
"""

import re

from app.config.settings import settings

# 占位符类别
CAT_IP = "IP"
CAT_PHONE = "PHONE"
CAT_EMAIL = "EMAIL"
CAT_TOKEN = "TOKEN"
CAT_APIKEY = "APIKEY"
CAT_IDCARD = "IDCARD"

# IPv4（校验每段 0-255）
_IPV4 = r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}"

# 中国大陆 11 位手机号（前后不能再是数字，避免误伤 18 位身份证号）
_PHONE = r"(?<!\d)1[3-9]\d{9}(?!\d)"

# 18 位身份证号（末位可为 X；前后不能再是数字/字母）
_IDCARD = r"(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])"

# JWT（三段 base64url）
_JWT = r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"

# Bearer token（JWT 或非 JWT 形式）
_BEARER = r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}"

# OpenAI 风格 API key（sk-xxx）
_SK_KEY = r"\bsk-[A-Za-z0-9_-]{16,}\b"

# key=value / key: value 形式的敏感字段（password/secret/token/api_key 等）
# 只替换值部分，保留键名便于阅读
_KV_SECRET = (
    r"(?i)\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token"
    r"|secret[_-]?key|client[_-]?secret|secret|token|password|passwd|pwd)"
    r"(\s*[:=]\s*)"
    r"(\"[^\"\s]{4,}\"|'[^'\s]{4,}'|[^\s\"',;&]{4,})"
)

_EMAIL = r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"


class LogMasker:
    """有状态脱敏器

    内部维护 值 -> 占位符 的映射，同一实例处理的所有文本
    （如同一文件的多个流式分块）中，同一敏感值始终映射到同一占位符。
    """

    def __init__(self) -> None:
        # 类别 -> {原始值: 占位符}
        self._maps: dict[str, dict[str, str]] = {}
        self._counters: dict[str, int] = {}

    @property
    def mapping(self) -> dict[str, str]:
        """占位符 -> 原始值 的完整映射（用于持久化/还原）"""
        result: dict[str, str] = {}
        for value_map in self._maps.values():
            for original, placeholder in value_map.items():
                result[placeholder] = original
        return result

    def _placeholder(self, category: str, value: str) -> str:
        """获取（或创建）某个敏感值对应的占位符"""
        value_map = self._maps.setdefault(category, {})
        if value not in value_map:
            self._counters[category] = self._counters.get(category, 0) + 1
            value_map[value] = f"[{category}_{self._counters[category]}]"
        return value_map[value]

    def mask(self, text: str) -> str:
        """对文本脱敏，返回脱敏后的文本"""
        if not text:
            return text

        # 1. Bearer token（先去掉整个 "Bearer xxx"，避免后续规则重复命中）
        def _mask_bearer(m: re.Match) -> str:
            token = m.group(0).split(None, 1)[1]
            return f"Bearer {self._placeholder(CAT_TOKEN, token)}"

        text = re.sub(_BEARER, _mask_bearer, text)

        # 2. 裸 JWT
        text = re.sub(_JWT, lambda m: self._placeholder(CAT_TOKEN, m.group(0)), text)

        # 3. key=value / key: value 敏感字段（保留键名，替换值）
        def _mask_kv(m: re.Match) -> str:
            value = m.group(3)
            quote = ""
            if value[:1] in ("\"", "'") and value[-1:] == value[:1]:
                quote = value[:1]
                value = value[1:-1]
            placeholder = self._placeholder(CAT_APIKEY, value)
            return f"{m.group(1)}{m.group(2)}{quote}{placeholder}{quote}"

        text = re.sub(_KV_SECRET, _mask_kv, text)

        # 4. sk- 风格 API key
        text = re.sub(_SK_KEY, lambda m: self._placeholder(CAT_APIKEY, m.group(0)), text)

        # 5. 邮箱
        text = re.sub(_EMAIL, lambda m: self._placeholder(CAT_EMAIL, m.group(0)), text)

        # 6. 身份证号（先于手机号处理）
        text = re.sub(_IDCARD, lambda m: self._placeholder(CAT_IDCARD, m.group(0)), text)

        # 7. 手机号
        text = re.sub(_PHONE, lambda m: self._placeholder(CAT_PHONE, m.group(0)), text)

        # 8. IPv4 地址
        text = re.sub(_IPV4, lambda m: self._placeholder(CAT_IP, m.group(0)), text)

        return text


class MaskingService:
    """日志脱敏服务（无状态入口，按文件创建 LogMasker）"""

    def is_enabled(self) -> bool:
        """脱敏开关（MASK_SENSITIVE_DATA，默认开启）"""
        return settings.mask_sensitive_data

    def create_masker(self) -> LogMasker:
        """创建一个带独立映射的脱敏器（每个日志文件一个）"""
        return LogMasker()

    def mask_text(self, text: str) -> tuple[str, dict[str, str]]:
        """一次性脱敏：返回 (脱敏后文本, 占位符 -> 原始值 映射)"""
        masker = LogMasker()
        masked = masker.mask(text)
        return masked, masker.mapping


# 全局实例
masking_service = MaskingService()


def summarize_mapping(mapping: dict[str, str]) -> dict[str, int]:
    """统计脱敏映射中每类占位符的数量（如 {"IP": 2, "PHONE": 1}）"""
    stats: dict[str, int] = {}
    for placeholder in mapping:
        m = re.match(r"\[([A-Z]+)_\d+\]", placeholder)
        category = m.group(1) if m else "OTHER"
        stats[category] = stats.get(category, 0) + 1
    return stats
