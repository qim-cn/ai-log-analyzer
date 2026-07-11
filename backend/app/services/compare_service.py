"""
日志对比分析服务

对比两份日志，提取关键差异。
"""

import difflib
import re
from dataclasses import dataclass, field

from app.middlewares.error_handler import ValidationError
from app.models.log_file import LogFile
from app.repositories.log_repository import log_repository
from app.services.log_service import log_service
from app.utils.log_parser import ERROR_TYPE_PATTERN, LEVEL_PATTERN, _normalize_level


@dataclass
class DiffLine:
    """差异行"""

    line_number: int
    content: str
    type: str  # 'added', 'removed', 'unchanged'


@dataclass
class CompareResult:
    """对比结果"""

    # 统计
    total_lines_1: int = 0
    total_lines_2: int = 0
    added_lines: int = 0
    removed_lines: int = 0
    modified_lines: int = 0
    unchanged_lines: int = 0

    # 关键差异
    new_errors: list[str] = field(default_factory=list)
    fixed_errors: list[str] = field(default_factory=list)
    changed_params: list[str] = field(default_factory=list)

    # 差异详情（前 200 行）
    diff_lines: list[dict] = field(default_factory=list)

    # AI 分析用的摘要
    summary: str = ""


class CompareService:
    """日志对比服务"""

    def compare_logs(self, log_id_1: str, log_id_2: str) -> CompareResult:
        """
        对比两份日志

        Args:
            log_id_1: 第一份日志 ID（修复前）
            log_id_2: 第二份日志 ID（修复后）

        Returns:
            CompareResult 对比结果
        """
        # 获取日志文件
        log1 = log_repository.get_by_id(log_id_1)
        log2 = log_repository.get_by_id(log_id_2)

        if not log1:
            raise ValidationError(f"日志文件 {log_id_1} 不存在")
        if not log2:
            raise ValidationError(f"日志文件 {log_id_2} 不存在")

        # 获取内容
        content1 = log_service.get_log_content(log1)
        content2 = log_service.get_log_content(log2)

        # 按行分割
        lines1 = content1.splitlines()
        lines2 = content2.splitlines()

        # 计算差异
        result = CompareResult()
        result.total_lines_1 = len(lines1)
        result.total_lines_2 = len(lines2)

        # 使用 difflib 计算差异
        differ = difflib.unified_diff(lines1, lines2, lineterm="", n=0)
        diff_lines = []

        for line in list(differ)[:500]:  # 限制 500 行
            if line.startswith("+++") or line.startswith("---") or line.startswith("@@"):
                continue

            if line.startswith("+"):
                diff_lines.append({"type": "added", "content": line[1:]})
                result.added_lines += 1
            elif line.startswith("-"):
                diff_lines.append({"type": "removed", "content": line[1:]})
                result.removed_lines += 1

        # 提取关键差异
        self._extract_key_differences(lines1, lines2, result)

        # 生成摘要
        result.summary = self._generate_summary(result, log1.filename, log2.filename)
        result.diff_lines = diff_lines[:200]

        return result

    def _extract_key_differences(
        self, lines1: list[str], lines2: list[str], result: CompareResult
    ) -> None:
        """提取关键差异：新增错误、消失错误、变化参数"""

        # 提取错误行
        errors1 = set()
        errors2 = set()

        for line in lines1:
            if LEVEL_PATTERN.search(line):
                level = _normalize_level(LEVEL_PATTERN.search(line).group(1))
                if level == "error":
                    # 提取错误关键部分（去掉时间戳等变量）
                    key = self._extract_error_key(line)
                    errors1.add(key)

        for line in lines2:
            if LEVEL_PATTERN.search(line):
                level = _normalize_level(LEVEL_PATTERN.search(line).group(1))
                if level == "error":
                    key = self._extract_error_key(line)
                    errors2.add(key)

        # 新增的错误
        new_errors = errors2 - errors1
        result.new_errors = list(new_errors)[:20]

        # 消失的错误（已修复）
        fixed_errors = errors1 - errors2
        result.fixed_errors = list(fixed_errors)[:20]

        # 提取变化的参数（数字、ID 等变化）
        self._extract_param_changes(lines1, lines2, result)

    def _extract_error_key(self, line: str) -> str:
        """提取错误的关键特征（去掉时间戳、PID 等变量）"""
        # 去掉时间戳
        key = re.sub(r"\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}", "", line)
        # 去掉方括号中的数字（PID/TID）
        key = re.sub(r"\[\d+\]", "", key)
        # 去掉连续空格
        key = re.sub(r"\s+", " ", key).strip()
        return key[:200]

    def _extract_param_changes(
        self, lines1: list[str], lines2: list[str], result: CompareResult
    ) -> None:
        """提取参数变化"""
        # 简单实现：比较相似行中的数字变化
        set1 = {self._extract_error_key(l): l for l in lines1 if LEVEL_PATTERN.search(l)}
        set2 = {self._extract_error_key(l): l for l in lines2 if LEVEL_PATTERN.search(l)}

        for key in set1:
            if key in set2 and set1[key] != set2[key]:
                # 同一类型的错误，但内容不同
                result.changed_params.append(f"变化: {key[:100]}")

    def _generate_summary(
        self, result: CompareResult, filename1: str, filename2: str
    ) -> str:
        """生成对比摘要"""
        parts = [
            f"=== 日志对比分析 ===",
            f"文件1（修复前）: {filename1} ({result.total_lines_1} 行)",
            f"文件2（修复后）: {filename2} ({result.total_lines_2} 行)",
            f"",
            f"差异统计:",
            f"  新增行: {result.added_lines}",
            f"  删除行: {result.removed_lines}",
            f"  未变化: {result.unchanged_lines}",
        ]

        if result.new_errors:
            parts.append(f"\n新增错误 ({len(result.new_errors)} 个):")
            for err in result.new_errors[:5]:
                parts.append(f"  + {err}")

        if result.fixed_errors:
            parts.append(f"\n已修复错误 ({len(result.fixed_errors)} 个):")
            for err in result.fixed_errors[:5]:
                parts.append(f"  - {err}")

        if result.changed_params:
            parts.append(f"\n参数变化 ({len(result.changed_params)} 个):")
            for change in result.changed_params[:5]:
                parts.append(f"  ~ {change}")

        return "\n".join(parts)


# 全局实例
compare_service = CompareService()
