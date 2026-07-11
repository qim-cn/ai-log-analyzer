"""
Message 数据模型
"""

from dataclasses import dataclass
from enum import Enum


class MessageRole(str, Enum):
    """消息角色枚举"""

    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


@dataclass
class Message:
    """消息数据模型"""

    id: str
    session_id: str
    role: MessageRole
    content: str
    created_at: str

    @classmethod
    def from_row(cls, row: dict) -> "Message":
        """从数据库行创建实例"""
        return cls(
            id=row["id"],
            session_id=row["session_id"],
            role=MessageRole(row["role"]),
            content=row["content"],
            created_at=row["created_at"],
        )
