"""
LogFile 数据模型
"""

from dataclasses import dataclass
from enum import Enum


class LogFileType(str, Enum):
    """日志文件类型枚举"""

    LOG = "log"
    TXT = "txt"
    CSV = "csv"


@dataclass
class LogFile:
    """日志文件数据模型"""

    id: str
    session_id: str
    filename: str
    file_type: LogFileType
    file_size: int
    line_count: int
    content: str | None  # 小文件直接存内容
    disk_path: str | None  # 大文件存磁盘路径
    summary: str | None  # 大文件摘要
    created_at: str
    masking_map: str | None = None  # 脱敏映射（JSON：占位符 -> 原始值）

    @classmethod
    def from_row(cls, row: dict) -> "LogFile":
        """从数据库行创建实例"""
        return cls(
            id=row["id"],
            session_id=row["session_id"],
            filename=row["filename"],
            file_type=LogFileType(row["file_type"]),
            file_size=row["file_size"],
            line_count=row["line_count"],
            content=row["content"],
            disk_path=row["disk_path"],
            summary=row["summary"],
            created_at=row["created_at"],
            masking_map=row.get("masking_map"),
        )

    @property
    def is_on_disk(self) -> bool:
        """是否存储在磁盘上"""
        return self.disk_path is not None

    def get_display_content(self) -> str:
        """获取用于显示的内容（小文件返回完整内容，大文件返回摘要）"""
        if self.content:
            return self.content
        return self.summary or "(文件内容存储在磁盘)"
