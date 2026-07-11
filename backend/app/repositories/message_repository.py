"""
Message 数据访问层
"""

import uuid
from datetime import datetime

from app.config.database import get_connection
from app.models.message import Message, MessageRole


class MessageRepository:
    """消息数据访问"""

    def create(self, session_id: str, role: MessageRole, content: str) -> Message:
        """创建新消息"""
        conn = get_connection()
        message_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (message_id, session_id, role.value, content, now),
        )
        conn.commit()

        return Message(
            id=message_id,
            session_id=session_id,
            role=role,
            content=content,
            created_at=now,
        )

    def get_by_session(
        self, session_id: str, limit: int = 100, offset: int = 0
    ) -> list[Message]:
        """获取会话下的消息列表"""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?",
            (session_id, limit, offset),
        ).fetchall()

        return [Message.from_row(dict(row)) for row in rows]

    def get_recent_by_session(
        self, session_id: str, limit: int = 20
    ) -> list[Message]:
        """获取会话下最近的消息（用于上下文组装）"""
        conn = get_connection()
        rows = conn.execute(
            """SELECT * FROM (
                SELECT * FROM messages WHERE session_id = ?
                ORDER BY created_at DESC LIMIT ?
            ) ORDER BY created_at ASC""",
            (session_id, limit),
        ).fetchall()

        return [Message.from_row(dict(row)) for row in rows]

    def count_by_session(self, session_id: str) -> int:
        """统计会话下的消息数量"""
        conn = get_connection()
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return row["cnt"]

    def delete_by_session(self, session_id: str) -> int:
        """删除会话下的所有消息"""
        conn = get_connection()
        cursor = conn.execute(
            "DELETE FROM messages WHERE session_id = ?", (session_id,)
        )
        conn.commit()
        return cursor.rowcount


# 全局实例
message_repository = MessageRepository()
