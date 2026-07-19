"""
错误聚类服务

生产日志同一报错常常刷屏。本服务把已存储的日志内容按错误行提取、
归一化（去掉时间戳/数字/UUID/路径行号等易变部分）后归组统计，
输出每个聚类的出现次数、首末出现时间、原始样例行和占比。

与 services/cluster_service.py 的区别：
- cluster_service 是旧的轻量实现（仅 pattern/count/samples/level）；
- 本服务面向"错误聚类面板"，额外提供首末出现时间、占比和更完整的
  错误行识别（堆栈行、failed/failure 等）。
"""

import re
from dataclasses import dataclass

# ---- 错误行识别 ----

# 错误级别关键词
_LEVEL_PATTERN = re.compile(r"\b(ERROR|FATAL|CRITICAL)\b", re.IGNORECASE)

# failed / failure 等失败关键词
_FAIL_KEYWORD_PATTERN = re.compile(
    r"\b(failed|failure|fail|exception|panic)\b", re.IGNORECASE
)

# 异常堆栈行
_STACK_PATTERNS = [
    re.compile(r"Traceback \(most recent call last\)"),          # Python
    re.compile(r'^\s*File\s+"[^"]+",\s+line\s+\d+'),              # Python 帧
    re.compile(r"^\s*at\s+[\w.$]+\([^)]*\)\s*$"),                 # Java 帧
    re.compile(r"^\s*Caused by:\s*[\w.]+"),                       # Java 原因链
    re.compile(r"^\s*[\w.$]*(?:Exception|Error)\b\s*(:|$)"),      # 异常类名行
]


def is_error_line(line: str) -> bool:
    """判断一行是否是错误行（错误级别 / 失败关键词 / 异常堆栈行）"""
    if _LEVEL_PATTERN.search(line):
        return True
    if _FAIL_KEYWORD_PATTERN.search(line):
        return True
    stripped = line.strip()
    if not stripped:
        return False
    return any(p.search(line) for p in _STACK_PATTERNS)


# ---- 时间戳解析（用于首末出现时间）----

_TS_PATTERNS = [
    # ISO: 2024-01-15 10:30:00 / 2024-01-15T10:30:00.123+08:00
    re.compile(
        r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}"
        r"(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?"
    ),
    # 斜杠日期: 2024/01/15 10:30:00
    re.compile(r"\d{4}/\d{2}/\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?"),
    # syslog: Jan 15 10:30:00
    re.compile(r"\b[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b"),
    # 仅时间: 10:30:00
    re.compile(r"\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b"),
]


def extract_timestamp(line: str) -> str | None:
    """从日志行中提取时间戳文本（无法解析时返回 None）"""
    for pattern in _TS_PATTERNS:
        m = pattern.search(line)
        if m:
            return m.group(0)
    return None


# ---- 归一化 ----

_NORMALIZE_RULES: list[tuple[re.Pattern, str]] = [
    # ISO / 斜杠时间戳
    (re.compile(r"\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?"), "<TS>"),
    # syslog 时间戳
    (re.compile(r"\b[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b"), "<TS>"),
    # 仅日期 / 仅时间
    (re.compile(r"\b\d{4}[-/]\d{2}[-/]\d{2}\b"), "<TS>"),
    (re.compile(r"\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b"), "<TS>"),
    # UUID
    (re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"), "<UUID>"),
    # 十六进制（0x 前缀或 32 位以上的 hex 串，如 md5）
    (re.compile(r"0x[0-9a-fA-F]+"), "<HEX>"),
    (re.compile(r"\b[0-9a-fA-F]{32,}\b"), "<HEX>"),
    # 引号内字符串
    (re.compile(r'"[^"\n]*"'), "<STR>"),
    (re.compile(r"'[^'\n]*'"), "<STR>"),
    # 文件路径中的行号（a/b/c.java:123 / app.py:42）
    (re.compile(r"([\w./\\-]+\.\w+):\d+"), r"\1:<LINE>"),
    # 独立数字
    (re.compile(r"\b\d+\b"), "<NUM>"),
]


def normalize_line(line: str) -> str:
    """归一化日志行：替换时间戳、数字、UUID、引号字符串、路径行号等易变部分"""
    norm = line.strip()
    for pattern, repl in _NORMALIZE_RULES:
        norm = pattern.sub(repl, norm)
    # 合并连续占位符（如 <NUM>, <NUM> -> <NUM>）并压缩空白
    norm = re.sub(r"<NUM>(?:[,;\s]*<NUM>)+", "<NUM>", norm)
    norm = re.sub(r"\s+", " ", norm).strip()
    return norm[:300]


@dataclass
class ErrorCluster:
    """错误聚类结果"""

    pattern: str          # 归一化模式
    count: int            # 出现次数
    first_seen: str | None  # 首次出现时间（行内时间戳）
    last_seen: str | None   # 最后出现时间
    sample: str           # 一条原始样例行
    ratio: float          # 占全部错误行的比例

    def to_dict(self) -> dict:
        return {
            "pattern": self.pattern,
            "count": self.count,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "sample": self.sample,
            "ratio": self.ratio,
        }


class ErrorClusterService:
    """错误聚类服务"""

    def cluster_errors(self, content: str, limit: int = 20) -> dict:
        """
        对日志内容做错误聚类

        Args:
            content: 日志内容（已脱敏）
            limit: 返回的最大聚类数（按次数降序截取）

        Returns:
            {"total_error_lines": int, "clusters": [ErrorCluster.to_dict(), ...]}
        """
        error_lines = [
            line.strip()
            for line in content.split("\n")
            if line.strip() and is_error_line(line)
        ]

        total = len(error_lines)
        if total == 0:
            return {"total_error_lines": 0, "clusters": []}

        # 归一化分组（dict 保持插入顺序，样例取首条）
        groups: dict[str, dict] = {}
        for line in error_lines:
            pattern = normalize_line(line)
            ts = extract_timestamp(line)
            group = groups.get(pattern)
            if group is None:
                groups[pattern] = {
                    "count": 1,
                    "sample": line,
                    "first_seen": ts,
                    "last_seen": ts,
                }
            else:
                group["count"] += 1
                if ts is not None:
                    if group["first_seen"] is None or ts < group["first_seen"]:
                        group["first_seen"] = ts
                    if group["last_seen"] is None or ts > group["last_seen"]:
                        group["last_seen"] = ts

        # 按次数降序
        sorted_groups = sorted(groups.items(), key=lambda kv: -kv[1]["count"])[:limit]

        clusters = [
            ErrorCluster(
                pattern=pattern,
                count=g["count"],
                first_seen=g["first_seen"],
                last_seen=g["last_seen"],
                sample=g["sample"],
                ratio=round(g["count"] / total, 4),
            ).to_dict()
            for pattern, g in sorted_groups
        ]

        return {"total_error_lines": total, "clusters": clusters}


# 全局实例
error_cluster_service = ErrorClusterService()
