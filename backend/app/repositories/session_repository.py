"""
Session 数据访问层
"""

import uuid
from datetime import datetime

from app.config.database import get_connection
from app.models.session import Session


class SessionRepository:
    """会话数据访问"""

    def create(
        self,
        title: str = "新对话",
        user_id: str | None = None,
        model: str | None = None,
        sn: str | None = None,
    ) -> Session:
        """创建新会话"""
        conn = get_connection()
        session_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        conn.execute(
            "INSERT INTO sessions (id, user_id, title, model, sn, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
            (session_id, user_id, title, model, sn, now, now),
        )
        conn.commit()

        return Session(
            id=session_id, user_id=user_id, title=title, created_at=now, updated_at=now,
            model=model, sn=sn, status="open",
        )

    def get_by_id(self, session_id: str) -> Session | None:
        """根据 ID 获取会话"""
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()

        if row is None:
            return None
        return Session.from_row(dict(row))

    @staticmethod
    def _filters(
        model: str | None, status: str | None, q: str | None
    ) -> tuple[list[str], list]:
        """组装机型/状态/关键字筛选条件"""
        where, params = [], []
        if model:
            where.append("model = ?")
            params.append(model)
        if status:
            where.append("status = ?")
            params.append(status)
        if q:
            where.append("(title LIKE ? OR model LIKE ? OR sn LIKE ?)")
            kw = f"%{q}%"
            params.extend([kw, kw, kw])
        return where, params

    def list_all(
        self, limit: int = 100, offset: int = 0,
        model: str | None = None, status: str | None = None, q: str | None = None,
    ) -> list[Session]:
        """获取所有会话列表（管理员用），支持机型/状态/关键字筛选"""
        conn = get_connection()
        where, params = self._filters(model, status, q)
        sql = "SELECT * FROM sessions"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()
        return [Session.from_row(dict(row)) for row in rows]

    def list_by_user(
        self, user_id: str, limit: int = 100, offset: int = 0,
        model: str | None = None, status: str | None = None, q: str | None = None,
    ) -> list[Session]:
        """获取指定用户的会话列表，支持机型/状态/关键字筛选"""
        conn = get_connection()
        where, params = self._filters(model, status, q)
        where.insert(0, "user_id = ?")
        params.insert(0, user_id)
        sql = "SELECT * FROM sessions WHERE " + " AND ".join(where)
        sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()
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

    def update_model(self, session_id: str, model: str | None = None, sn: str | None = None) -> bool:
        """更新机型/SN（只更新非 None 字段）"""
        conn = get_connection()
        now = datetime.utcnow().isoformat()
        sets, params = ["updated_at = ?"], [now]
        if model is not None:
            sets.append("model = ?")
            params.append(model)
        if sn is not None:
            sets.append("sn = ?")
            params.append(sn)
        params.append(session_id)
        cursor = conn.execute(
            f"UPDATE sessions SET {', '.join(sets)} WHERE id = ?", params
        )
        conn.commit()
        return cursor.rowcount > 0

    def update_status(self, session_id: str, status: str) -> bool:
        """更新会话状态（open/resolved）"""
        conn = get_connection()
        now = datetime.utcnow().isoformat()
        cursor = conn.execute(
            "UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, session_id),
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
