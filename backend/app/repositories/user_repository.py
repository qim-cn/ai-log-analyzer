"""
User 数据访问层
"""

import uuid
from datetime import datetime

from app.config.database import get_connection
from app.models.user import User, UserRole


class UserRepository:
    """用户数据访问"""

    def create(self, username: str, password_hash: str, role: UserRole = UserRole.USER) -> User:
        """创建用户"""
        conn = get_connection()
        user_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, username, password_hash, role.value, now),
        )
        conn.commit()

        return User(
            id=user_id,
            username=username,
            password_hash=password_hash,
            role=role,
            created_at=now,
        )

    def get_by_id(self, user_id: str) -> User | None:
        """根据 ID 获取用户"""
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            return None
        return User.from_row(dict(row))

    def get_by_username(self, username: str) -> User | None:
        """根据用户名获取用户"""
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        if row is None:
            return None
        return User.from_row(dict(row))

    def list_all(self) -> list[User]:
        """获取所有用户"""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM users ORDER BY created_at ASC"
        ).fetchall()
        return [User.from_row(dict(row)) for row in rows]

    def delete(self, user_id: str) -> bool:
        """删除用户"""
        conn = get_connection()
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return cursor.rowcount > 0

    def count(self) -> int:
        """统计用户数量"""
        conn = get_connection()
        row = conn.execute("SELECT COUNT(*) as cnt FROM users").fetchone()
        return row["cnt"]

    def update_password(self, user_id: str, password_hash: str) -> bool:
        """更新密码"""
        conn = get_connection()
        cursor = conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (password_hash, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0


# 全局实例
user_repository = UserRepository()
