"""
日志解析工具

支持多种日志格式的智能识别和结构化解析：
- syslog: "Jun 18 13:00:57 hostname service[pid]: message"
- journalctl: "-- Logs begin at ... --"
- dmesg: "[12345.678901] message"
- nginx access: '192.168.1.1 - - [18/Jun/2026:13:00:57 +0800] "GET / HTTP/1.1" 200'
- nginx error: "2026/06/18 13:00:57 [error] pid#tid: message"
- docker logs: "2026-06-18T13:00:57.123456789Z message"
- JSON logs: 每行一个 JSON 对象
- 自定义时间戳: 正则匹配常见时间格式
"""

import csv
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote


@dataclass
class LogEntry:
    """单条日志的结构化数据"""

    line_number: int
    timestamp: str | None = None
    level: str | None = None
    source: str | None = None
    message: str = ""
    raw: str = ""


@dataclass
class LogStatistics:
    """日志统计信息"""

    total_lines: int = 0
    file_size_mb: float = 0.0
    time_start: str | None = None
    time_end: str | None = None
    level_counts: dict[str, int] = field(default_factory=dict)
    source_counts: dict[str, int] = field(default_factory=dict)
    hour_distribution: dict[str, int] = field(default_factory=dict)
    error_types: dict[str, int] = field(default_factory=dict)
    key_alerts: list[str] = field(default_factory=list)
    sample_head: str = ""
    sample_tail: str = ""
    detected_format: str = "unknown"


@dataclass
class LogSummary:
    """日志结构化摘要（兼容旧接口）"""

    total_lines: int = 0
    file_size_mb: float = 0.0
    time_start: str | None = None
    time_end: str | None = None
    error_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    key_alerts: list[str] = field(default_factory=list)
    error_types: dict[str, int] = field(default_factory=dict)
    sample_head: str = ""
    sample_tail: str = ""

    def to_prompt_text(self) -> str:
        """转换为可注入 system prompt 的文本"""
        parts = [
            "=== 日志摘要 ===",
            f"总行数: {self.total_lines}",
            f"文件大小: {self.file_size_mb:.2f} MB",
        ]

        if self.time_start or self.time_end:
            parts.append(
                f"时间范围: {self.time_start or '未知'} ~ {self.time_end or '未知'}"
            )

        parts.append(
            f"错误: {self.error_count} | 警告: {self.warning_count} | 信息: {self.info_count}"
        )

        if self.error_types:
            top_errors = sorted(self.error_types.items(), key=lambda x: -x[1])[:5]
            parts.append(
                f"错误类型分布: {', '.join(f'{k}({v})' for k, v in top_errors)}"
            )

        if self.key_alerts:
            parts.append(f"\n关键告警 ({len(self.key_alerts)} 条):")
            for alert in self.key_alerts[:10]:
                parts.append(f"  - {alert}")

        if self.sample_head:
            parts.append("\n--- 日志开头 ---")
            parts.append(self.sample_head)

        if self.sample_tail:
            parts.append("\n--- 日志末尾 ---")
            parts.append(self.sample_tail)

        return "\n".join(parts)


# ============================================================
# 日志格式识别正则
# ============================================================

# 时间戳模式
TIMESTAMP_PATTERNS = [
    # ISO 8601: 2024-01-15T10:30:45 / 2024-01-15 10:30:45
    re.compile(
        r"(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)"
    ),
    # syslog: Jan 15 10:30:45
    re.compile(r"(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})"),
    # nginx: 15/Jan/2024:10:30:45
    re.compile(r"(\d{2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2})"),
    # 短格式: 01-15 10:30:45
    re.compile(r"(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})"),
    # nginx error: 2026/06/18 13:00:57
    re.compile(r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})"),
]

# 日志级别
LEVEL_PATTERN = re.compile(
    r"\b(ERROR|FATAL|CRITICAL|WARN(?:ING)?|ALERT|NOTICE|INFO|DEBUG|TRACE|EMERG)\b",
    re.IGNORECASE,
)

# 来源提取模式
SOURCE_PATTERNS = [
    # syslog: kernel:, sshd:, nginx:
    re.compile(r"^\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+(\S+?)(?:\[\d+\])?:"),
    # 带方括号: [main], [worker-1]
    re.compile(r"\[([^\]]+)\]"),
    # 带冒号: nginx.access, app.main
    re.compile(r"^(\w+(?:\.\w+)+)\s"),
    # Python logger: 2024-01-15 10:30:45 - module_name - LEVEL
    re.compile(r"\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}\s*-\s*(\S+)\s*-"),
]

# 错误类型提取
ERROR_TYPE_PATTERN = re.compile(r"(\w+(?:Error|Exception|Fault|Failure))")

# 格式检测模式
FORMAT_PATTERNS = {
    "syslog": re.compile(
        r"^\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+(?:\[\d+\])?:"
    ),
    "dmesg": re.compile(r"^\[\s*\d+\.\d+\]"),
    "nginx_access": re.compile(
        r'^\S+\s+\S+\s+\S+\s+\[\d{2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]\d{4}\]\s+"'
    ),
    "nginx_error": re.compile(r"^\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}\s+\[\w+\]"),
    "docker": re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z"),
    "json": re.compile(r'^\{"[^"]+"\s*:'),
    "journalctl": re.compile(r"^--\s+Logs\s+begin"),
}


def _normalize_level(raw: str | None) -> str | None:
    """标准化日志级别"""
    if not raw:
        return None
    upper = raw.upper()
    if upper in ("ERROR", "FATAL", "CRITICAL", "EMERG"):
        return "error"
    if upper in ("WARN", "WARNING", "ALERT", "NOTICE"):
        return "warning"
    if upper in ("INFO",):
        return "info"
    if upper in ("DEBUG", "TRACE"):
        return "debug"
    return None


def _extract_timestamp(line: str) -> str | None:
    """提取时间戳"""
    for pattern in TIMESTAMP_PATTERNS:
        match = pattern.search(line)
        if match:
            return match.group(1)
    return None


def _extract_source(line: str) -> str | None:
    """提取日志来源"""
    for pattern in SOURCE_PATTERNS:
        match = pattern.search(line)
        if match:
            return match.group(1)
    return None


def _parse_hour(timestamp: str | None) -> str | None:
    """从时间戳提取小时"""
    if not timestamp:
        return None
    for fmt in [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%d/%b/%Y:%H:%M:%S",
    ]:
        try:
            dt = datetime.strptime(timestamp[:19], fmt[: len(timestamp[:19])])
            return dt.strftime("%Y-%m-%d %H:00")
        except ValueError:
            continue
    match = re.search(r"(\d{2}):\d{2}:\d{2}", timestamp)
    if match:
        return match.group(1) + ":00"
    return None


def detect_log_format(lines: list[str]) -> str:
    """检测日志格式"""
    # 取前 100 行检测
    sample = lines[:100]
    format_votes: dict[str, int] = {}

    for line in sample:
        if not line.strip():
            continue
        for fmt_name, pattern in FORMAT_PATTERNS.items():
            if pattern.match(line):
                format_votes[fmt_name] = format_votes.get(fmt_name, 0) + 1

    if format_votes:
        return max(format_votes, key=format_votes.get)  # type: ignore
    return "unknown"


def parse_json_log(line: str) -> LogEntry:
    """解析 JSON 格式日志"""
    entry = LogEntry(line_number=0, raw=line, message=line)
    try:
        data = json.loads(line)
        if isinstance(data, dict):
            entry.timestamp = (
                data.get("timestamp")
                or data.get("time")
                or data.get("ts")
                or data.get("@timestamp")
            )
            entry.level = _normalize_level(
                data.get("level") or data.get("severity") or data.get("lvl")
            )
            entry.source = (
                data.get("source")
                or data.get("logger")
                or data.get("module")
                or data.get("service")
            )
            entry.message = (
                data.get("message")
                or data.get("msg")
                or data.get("text")
                or line
            )
    except (json.JSONDecodeError, TypeError):
        pass
    return entry


def parse_line(line: str, line_number: int, detected_format: str = "unknown") -> LogEntry:
    """解析单行日志为结构化数据"""
    entry = LogEntry(line_number=line_number, raw=line, message=line)

    if not line.strip():
        return entry

    # JSON 格式优先
    if detected_format == "json" or line.strip().startswith("{"):
        entry = parse_json_log(line)
        entry.line_number = line_number
        if entry.timestamp:
            return entry

    # 提取时间戳
    entry.timestamp = _extract_timestamp(line)

    # 提取级别
    level_match = LEVEL_PATTERN.search(line)
    if level_match:
        entry.level = _normalize_level(level_match.group(1))

    # 提取来源
    entry.source = _extract_source(line)

    # nginx access log
    if detected_format == "nginx_access":
        match = re.match(
            r'^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+\S+"\s+(\d{3})',
            line,
        )
        if match:
            entry.source = f"nginx:{match.group(5)}"
            entry.timestamp = match.group(2)
            status = int(match.group(5))
            if status >= 500:
                entry.level = "error"
            elif status >= 400:
                entry.level = "warning"

    # nginx error log
    if detected_format == "nginx_error":
        match = re.match(
            r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(\d+)#(\d+):",
            line,
        )
        if match:
            entry.timestamp = match.group(1)
            entry.level = _normalize_level(match.group(2))
            entry.source = f"nginx:{match.group(3)}"

    # dmesg
    if detected_format == "dmesg":
        match = re.match(r"\[\s*(\d+\.\d+)\]", line)
        if match:
            entry.source = "kernel"
            # dmesg 没有标准时间戳，用 uptime

    # 提取错误类型
    if entry.level == "error":
        err_match = ERROR_TYPE_PATTERN.search(line)
        if err_match:
            pass  # 可以存储错误类型

    return entry


def parse_log_entries(
    text: str, max_entries: int = 10000
) -> tuple[list[LogEntry], str]:
    """
    解析日志文本为结构化条目列表

    Returns:
        (entries, detected_format)
    """
    lines = text.split("\n")
    detected_format = detect_log_format(lines)
    entries = []

    for i, line in enumerate(lines[:max_entries], 1):
        if line.strip():
            entries.append(parse_line(line, i, detected_format))

    return entries, detected_format


def compute_statistics(
    entries: list[LogEntry], file_size_bytes: int = 0, detected_format: str = "unknown"
) -> LogStatistics:
    """计算日志统计信息"""
    stats = LogStatistics()
    stats.file_size_mb = file_size_bytes / (1024 * 1024)
    stats.total_lines = len(entries)
    stats.detected_format = detected_format

    for entry in entries:
        if entry.level:
            stats.level_counts[entry.level] = stats.level_counts.get(entry.level, 0) + 1

        if entry.source:
            stats.source_counts[entry.source] = stats.source_counts.get(entry.source, 0) + 1

        if entry.timestamp:
            if stats.time_start is None:
                stats.time_start = entry.timestamp
            stats.time_end = entry.timestamp

            hour = _parse_hour(entry.timestamp)
            if hour:
                stats.hour_distribution[hour] = stats.hour_distribution.get(hour, 0) + 1

        if entry.level == "error":
            err_match = ERROR_TYPE_PATTERN.search(entry.raw)
            if err_match:
                err_type = err_match.group(1)
                stats.error_types[err_type] = stats.error_types.get(err_type, 0) + 1

            if len(stats.key_alerts) < 20:
                stats.key_alerts.append(entry.raw.strip()[:200])

    if len(stats.source_counts) > 10:
        sorted_sources = sorted(stats.source_counts.items(), key=lambda x: -x[1])
        stats.source_counts = dict(sorted_sources[:10])

    return stats


# ============================================================
# 兼容旧接口
# ============================================================

def parse_log_text(text: str, file_size_bytes: int = 0) -> LogSummary:
    """解析日志文本，生成结构化摘要（兼容旧接口）"""
    entries, detected_format = parse_log_entries(text)
    stats = compute_statistics(entries, file_size_bytes, detected_format)

    summary = LogSummary()
    summary.total_lines = stats.total_lines
    summary.file_size_mb = stats.file_size_mb
    summary.time_start = stats.time_start
    summary.time_end = stats.time_end
    summary.error_count = stats.level_counts.get("error", 0)
    summary.warning_count = stats.level_counts.get("warning", 0)
    summary.info_count = stats.level_counts.get("info", 0)
    summary.key_alerts = stats.key_alerts
    summary.error_types = stats.error_types

    lines = text.split("\n")
    summary.sample_head = "\n".join(lines[:30])
    summary.sample_tail = "\n".join(lines[-30:]) if len(lines) > 30 else ""

    return summary


def parse_log_chunked(file_path: str, chunk_size: int = 1024 * 1024) -> LogSummary:
    """流式分块解析大日志文件（兼容旧接口）"""
    summary = LogSummary()
    path = Path(file_path)
    summary.file_size_mb = path.stat().st_size / (1024 * 1024)

    total_lines = 0
    head_lines: list[str] = []
    tail_buffer: list[str] = []
    max_tail = 30

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        remainder = ""

        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break

            chunk = remainder + chunk
            lines = chunk.split("\n")
            remainder = lines[-1]
            lines = lines[:-1]

            for line in lines:
                if not line.strip():
                    continue

                total_lines += 1

                if len(head_lines) < 30:
                    head_lines.append(line)

                tail_buffer.append(line)
                if len(tail_buffer) > max_tail:
                    tail_buffer.pop(0)

                ts = _extract_timestamp(line)
                if ts:
                    if summary.time_start is None:
                        summary.time_start = ts
                    summary.time_end = ts

                level_match = LEVEL_PATTERN.search(line)
                if level_match:
                    level = _normalize_level(level_match.group(1))
                    if level == "error":
                        summary.error_count += 1
                        err_match = ERROR_TYPE_PATTERN.search(line)
                        if err_match:
                            err_type = err_match.group(1)
                            summary.error_types[err_type] = (
                                summary.error_types.get(err_type, 0) + 1
                            )
                        if len(summary.key_alerts) < 20:
                            summary.key_alerts.append(line.strip()[:200])
                    elif level == "warning":
                        summary.warning_count += 1
                    elif level == "info":
                        summary.info_count += 1

        if remainder.strip():
            total_lines += 1
            tail_buffer.append(remainder)
            if len(tail_buffer) > max_tail:
                tail_buffer.pop(0)

    summary.total_lines = total_lines
    summary.sample_head = "\n".join(head_lines)
    summary.sample_tail = "\n".join(tail_buffer)

    return summary


def parse_csv_summary(file_path: str, sample_rows: int = 5) -> LogSummary:
    """解析 CSV 日志文件摘要（兼容旧接口）"""
    summary = LogSummary()
    path = Path(file_path)
    summary.file_size_mb = path.stat().st_size / (1024 * 1024)

    head_lines: list[str] = []
    tail_buffer: list[str] = []
    max_tail = 30
    total_lines = 0

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        for row in reader:
            total_lines += 1
            line = " | ".join(row)

            if len(head_lines) < 30:
                head_lines.append(line)

            tail_buffer.append(line)
            if len(tail_buffer) > max_tail:
                tail_buffer.pop(0)

            for cell in row:
                ts = _extract_timestamp(cell)
                if ts:
                    if summary.time_start is None:
                        summary.time_start = ts
                    summary.time_end = ts

                level_match = LEVEL_PATTERN.search(cell)
                if level_match:
                    level = _normalize_level(level_match.group(1))
                    if level == "error":
                        summary.error_count += 1
                    elif level == "warning":
                        summary.warning_count += 1

    summary.total_lines = total_lines
    summary.sample_head = "\n".join(head_lines)
    summary.sample_tail = "\n".join(tail_buffer)

    return summary
