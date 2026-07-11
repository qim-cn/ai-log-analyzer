"""
User 数据模型
"""

from dataclasses import dataclass
from enum import Enum


class UserRole(str, Enum):
    """用户角色枚举"""

    ADMIN = "admin"
    USER = "user"


@dataclass
class User:
    """用户数据模型"""

    id: str
    username: str
    password_hash: str
    role: UserRole
    created_at: str

    @classmethod
    def from_row(cls, row: dict) -> "User":
        """从数据库行创建实例"""
        return cls(
            id=row["id"],
            username=row["username"],
            password_hash=row["password_hash"],
            role=UserRole(row["role"]),
            created_at=row["created_at"],
        )

    def to_safe_dict(self) -> dict:
        """返回安全的用户信息（不含密码）"""
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role.value,
            "created_at": self.created_at,
        }
