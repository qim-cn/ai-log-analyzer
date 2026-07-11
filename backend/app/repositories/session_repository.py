"""
Session 数据访问层
"""

import uuid
from datetime import datetime

from app.config.database import get_connection
from app.models.session import Session


class SessionRepository:
    """会话数据访问"""

    def create(self, title: str = "新对话", user_id: str | None = None) -> Session:
        """创建新会话"""
        conn = get_connection()
        session_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        conn.execute(
            "INSERT INTO sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, user_id, title, now, now),
        )
        conn.commit()

        return Session(id=session_id, user_id=user_id, title=title, created_at=now, updated_at=now)

    def get_by_id(self, session_id: str) -> Session | None:
        """根据 ID 获取会话"""
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()

        if row is None:
            return None
        return Session.from_row(dict(row))

    def list_all(self, limit: int = 100, offset: int = 0) -> list[Session]:
        """获取所有会话列表（管理员用）"""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()

        return [Session.from_row(dict(row)) for row in rows]

    def list_by_user(self, user_id: str, limit: int = 100, offset: int = 0) -> list[Session]:
        """获取指定用户的会话列表"""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (user_id, limit, offset),
        ).fetchall()

        return [Session.from_row(dict(row)) for row in rows]

    def update_title(self, session_id: str, title: str) -> bool:
        """更新会话标题"""
        conn = get_connection()
        now = datetime.utcnow().isoformat()
        cursor = conn.execute(
            "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, session_id),
        )
        conn.commit()
        return cursor.rowcount > 0

    def update_timestamp(self, session_id: str) -> None:
        """更新会话的更新时间"""
        conn = get_connection()
        now = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        conn.commit()

    def delete(self, session_id: str) -> bool:
        """删除会话（级联删除消息和日志文件）"""
        conn = get_connection()
        cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        return cursor.rowcount > 0


# 全局实例
session_repository = SessionRepository()
