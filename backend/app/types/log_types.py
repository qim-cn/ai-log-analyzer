"""
Log 相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class LogFileResponse(BaseModel):
    """日志文件响应"""

    id: str
    session_id: str
    filename: str
    file_type: str
    file_size: int
    line_count: int
    content: str | None
    disk_path: str | None
    summary: str | None
    created_at: str


class LogFileListResponse(BaseModel):
    """日志文件列表响应"""

    files: list[LogFileResponse]


class LogStatisticsResponse(BaseModel):
    """日志统计响应"""

    total_lines: int
    file_size_mb: float
    time_start: str | None
    time_end: str | None
    level_counts: dict[str, int]
    source_counts: dict[str, int]
    hour_distribution: dict[str, int]
    error_types: dict[str, int]
    key_alerts: list[str]
    detected_format: str = "unknown"
