"""
Session 数据模型
"""

from dataclasses import dataclass


@dataclass
class Session:
    """会话数据模型"""

    id: str
    title: str
    created_at: str
    updated_at: str
    user_id: str | None = None

    @classmethod
    def from_row(cls, row: dict) -> "Session":
        """从数据库行创建实例"""
        return cls(
            id=row["id"],
            title=row["title"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            user_id=row.get("user_id"),
        )
