"""
操作审计日志服务

记录用户操作，支持分页查询。
"""

import uuid
from datetime import datetime

from app.config.database import get_connection


def init_audit_table() -> None:
    """初始化审计日志表"""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL,
            username   TEXT NOT NULL DEFAULT '',
            action     TEXT NOT NULL,
            detail     TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    """)


class AuditService:
    """审计日志服务"""

    def log(
        self,
        user_id: str,
        username: str,
        action: str,
        detail: str = None,
    ) -> None:
        """记录操作日志"""
        conn = get_connection()
        log_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        conn.execute(
            "INSERT INTO audit_logs (id, user_id, username, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (log_id, user_id, username, action, detail, now),
        )
        conn.commit()

    def list_logs(
        self,
        page: int = 1,
        limit: int = 50,
        user_id: str = None,
    ) -> dict:
        """
        分页查询审计日志

        Returns:
            {"logs": [...], "total": int, "page": int, "limit": int}
        """
        conn = get_connection()

        # 构建查询
        where_clause = ""
        params = []

        if user_id:
            where_clause = "WHERE user_id = ?"
            params.append(user_id)

        # 总数
        count_sql = f"SELECT COUNT(*) as cnt FROM audit_logs {where_clause}"
        total = conn.execute(count_sql, params).fetchone()["cnt"]

        # 分页查询
        offset = (page - 1) * limit
        query_sql = f"""
            SELECT * FROM audit_logs {where_clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """
        rows = conn.execute(query_sql, params + [limit, offset]).fetchall()

        return {
            "logs": [dict(row) for row in rows],
            "total": total,
            "page": page,
            "limit": limit,
        }


# 全局实例
audit_service = AuditService()
