"""
LogFile 数据访问层
"""

import uuid
from datetime import datetime

from app.config.database import get_connection
from app.models.log_file import LogFile, LogFileType


class LogRepository:
    """日志文件数据访问"""

    def create(
        self,
        session_id: str,
        filename: str,
        file_type: LogFileType,
        file_size: int,
        line_count: int,
        content: str | None = None,
        disk_path: str | None = None,
        summary: str | None = None,
        masking_map: str | None = None,
    ) -> LogFile:
        """创建日志文件记录"""
        conn = get_connection()
        log_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        conn.execute(
            """INSERT INTO log_files
               (id, session_id, filename, file_type, file_size, line_count,
                content, disk_path, summary, masking_map, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (log_id, session_id, filename, file_type.value, file_size,
             line_count, content, disk_path, summary, masking_map, now),
        )
        conn.commit()

        return LogFile(
            id=log_id,
            session_id=session_id,
            filename=filename,
            file_type=file_type,
            file_size=file_size,
            line_count=line_count,
            content=content,
            disk_path=disk_path,
            summary=summary,
            created_at=now,
            masking_map=masking_map,
        )

    def get_by_id(self, log_id: str) -> LogFile | None:
        """根据 ID 获取日志文件"""
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM log_files WHERE id = ?", (log_id,)
        ).fetchone()

        if row is None:
            return None
        return LogFile.from_row(dict(row))

    def get_all(self) -> list[LogFile]:
        """获取所有日志文件"""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM log_files ORDER BY created_at DESC"
        ).fetchall()

        return [LogFile.from_row(dict(row)) for row in rows]

    def get_by_session(self, session_id: str) -> list[LogFile]:
        """获取会话下的所有日志文件"""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM log_files WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        ).fetchall()

        return [LogFile.from_row(dict(row)) for row in rows]

    def delete(self, log_id: str) -> bool:
        """删除日志文件记录"""
        conn = get_connection()
        cursor = conn.execute("DELETE FROM log_files WHERE id = ?", (log_id,))
        conn.commit()
        return cursor.rowcount > 0

    def delete_by_session(self, session_id: str) -> int:
        """删除会话下的所有日志文件"""
        conn = get_connection()
        cursor = conn.execute(
            "DELETE FROM log_files WHERE session_id = ?", (session_id,)
        )
        conn.commit()
        return cursor.rowcount


# 全局实例
log_repository = LogRepository()
