"""
Log 业务逻辑层

处理日志文件的上传、解析、存储。
- 小文件（<=1MB）：存数据库 content 字段
- 中等文件（1MB~10MB）：存磁盘，数据库存路径 + 摘要
- 大文件（>10MB）：流式分块解析，存磁盘
"""

import logging
import uuid
from pathlib import Path

from app.config.database import get_connection
from app.config.settings import settings
from app.middlewares.error_handler import ValidationError
from app.models.log_file import LogFile, LogFileType
from app.repositories.log_repository import log_repository
from app.utils.log_parser import (
    LogStatistics,
    LogSummary,
    compute_statistics,
    parse_csv_summary,
    parse_log_chunked,
    parse_log_entries,
    parse_log_text,
)

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".log", ".txt", ".csv"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


class LogService:
    """日志文件服务"""

    async def upload_log_streaming(
        self,
        session_id: str,
        filename: str,
        file_iterator,
        file_size: int,
    ) -> LogFile:
        """
        流式上传日志文件

        边上传边写入磁盘，不全部读进内存。

        Args:
            session_id: 会话 ID
            filename: 文件名
            file_iterator: 文件内容迭代器
            file_size: 文件大小

        Returns:
            LogFile 数据模型
        """
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ValidationError(f"不支持的文件类型: {ext}")

        if file_size > MAX_FILE_SIZE:
            raise ValidationError(f"文件大小超过限制 (最大 50MB)")

        file_type = LogFileType(ext.lstrip("."))
        storage_dir = Path(settings.log_storage_path)
        storage_dir.mkdir(parents=True, exist_ok=True)

        # 先创建 DB 记录获取 ID
        log_file = log_repository.create(
            session_id=session_id,
            filename=filename,
            file_type=file_type,
            file_size=file_size,
            line_count=0,
            disk_path="",
        )

        disk_path = str(storage_dir / f"{log_file.id}{ext}")

        # 流式写入磁盘 + 边写边统计
        line_count = 0
        error_count = 0
        warning_count = 0
        first_lines = []
        last_lines_buffer = []
        max_tail = 30

        import re
        error_pattern = re.compile(r"\b(ERROR|FATAL|CRITICAL|EXCEPTION)\b", re.IGNORECASE)
        warn_pattern = re.compile(r"\b(WARN|WARNING|ALERT)\b", re.IGNORECASE)

        with open(disk_path, "wb") as f:
            async for chunk in file_iterator:
                f.write(chunk)
                # 统计行数和错误
                text = chunk.decode("utf-8", errors="replace")
                for line in text.split("\n"):
                    if not line.strip():
                        continue
                    line_count += 1
                    if len(first_lines) < 30:
                        first_lines.append(line)
                    last_lines_buffer.append(line)
                    if len(last_lines_buffer) > max_tail:
                        last_lines_buffer.pop(0)
                    if error_pattern.search(line):
                        error_count += 1
                    elif warn_pattern.search(line):
                        warning_count += 1

        # 生成摘要
        summary = self._generate_summary(
            filename, line_count, file_size, error_count, warning_count,
            first_lines, last_lines_buffer
        )

        # 更新 DB
        conn = get_connection()
        conn.execute(
            "UPDATE log_files SET disk_path = ?, summary = ?, line_count = ? WHERE id = ?",
            (disk_path, summary, line_count, log_file.id),
        )
        conn.commit()

        logger.info(f"文件上传完成: {filename}, {line_count} 行, 错误 {error_count}")
        return log_repository.get_by_id(log_file.id)

    def _generate_summary(
        self, filename, line_count, file_size, error_count, warning_count,
        first_lines, last_lines
    ) -> str:
        """生成结构化摘要"""
        size_mb = file_size / (1024 * 1024)
        parts = [
            f"=== {filename} ===",
            f"总行数: {line_count}",
            f"文件大小: {size_mb:.2f} MB",
            f"错误: {error_count} | 警告: {warning_count}",
        ]
        if first_lines:
            parts.append("\n--- 前 30 行 ---")
            parts.extend(first_lines[:30])
        if last_lines and len(last_lines) > 30:
            parts.append("\n--- 末 30 行 ---")
            parts.extend(last_lines[-30:])
        return "\n".join(parts)

    def upload_log(self, session_id: str, filename: str, content: bytes) -> LogFile:
        """兼容旧接口"""
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ValidationError(f"不支持的文件类型: {ext}")
        if len(content) > MAX_FILE_SIZE:
            raise ValidationError("文件大小超过限制")

        file_type = LogFileType(ext.lstrip("."))
        text_content = content.decode("utf-8", errors="replace")
        line_count = text_content.count("\n") + 1

        summary_obj = parse_log_text(text_content, len(content))

        if len(content) <= 1024 * 1024:
            return log_repository.create(
                session_id=session_id,
                filename=filename,
                file_type=file_type,
                file_size=len(content),
                line_count=line_count,
                content=text_content,
                summary=summary_obj.to_prompt_text(),
            )
        else:
            storage_dir = Path(settings.log_storage_path)
            storage_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_repository.create(
                session_id=session_id, filename=filename, file_type=file_type,
                file_size=len(content), line_count=line_count, disk_path="",
            )
            disk_path = str(storage_dir / f"{log_file.id}{ext}")
            Path(disk_path).write_bytes(content)
            conn = get_connection()
            conn.execute(
                "UPDATE log_files SET disk_path = ?, summary = ? WHERE id = ?",
                (disk_path, summary_obj.to_prompt_text(), log_file.id),
            )
            conn.commit()
            return log_repository.get_by_id(log_file.id)

    def get_log_content(self, log_file: LogFile, max_chars: int = 50000) -> str:
        """获取日志内容"""
        if log_file.content:
            if len(log_file.content) <= max_chars:
                return log_file.content
            half = max_chars // 2
            return log_file.content[:half] + "\n... (截断) ...\n" + log_file.content[-half:]
        if log_file.summary:
            return log_file.summary
        if log_file.disk_path and Path(log_file.disk_path).exists():
            return self._read_head_tail(log_file.disk_path, max_chars)
        return "(文件内容不可用)"

    def get_error_lines_only(self, log_file: LogFile, max_lines: int = 500) -> str:
        """只获取错误行（用于上下文注入，节省 token）"""
        content = self.get_log_content(log_file)
        import re
        error_pattern = re.compile(r"\b(ERROR|FATAL|CRITICAL|EXCEPTION|PANIC|FAIL)\b", re.IGNORECASE)
        error_lines = [line for line in content.split("\n") if error_pattern.search(line)]
        if len(error_lines) > max_lines:
            error_lines = error_lines[:max_lines] + [f"... (共 {len(error_lines)} 行错误)"]
        return "\n".join(error_lines)

    def _read_head_tail(self, file_path: str, max_chars: int) -> str:
        half = max_chars // 2
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                head = f.read(half)
                f.seek(0, 2)
                fsize = f.tell()
                if fsize > max_chars:
                    f.seek(max(fsize - half, 0))
                    tail = f.read()
                else:
                    tail = ""
        except Exception:
            return "(文件读取失败)"
        return head + "\n... (截断) ...\n" + tail if tail else head

    def get_logs_by_session(self, session_id: str) -> list[LogFile]:
        return log_repository.get_by_session(session_id)

    def get_logs_summary_for_session(self, session_id: str) -> str:
        """获取会话日志摘要（只注入错误行 + 统计）"""
        logs = log_repository.get_by_session(session_id)
        if not logs:
            return ""
        parts = []
        for lf in logs:
            if lf.summary:
                parts.append(f"[{lf.filename}]\n{lf.summary}")
            elif lf.content:
                # 只取错误行
                import re
                error_pattern = re.compile(r"\b(ERROR|FATAL|CRITICAL|EXCEPTION)\b", re.IGNORECASE)
                errors = [l for l in lf.content.split("\n") if error_pattern.search(l)]
                if errors:
                    parts.append(f"[{lf.filename} 错误行]\n" + "\n".join(errors[:50]))
        return "\n\n".join(parts)

    def get_log_statistics(self, log_id: str) -> LogStatistics:
        log_file = log_repository.get_by_id(log_id)
        if log_file is None:
            raise ValidationError(f"日志文件 {log_id} 不存在")
        content = self.get_log_content(log_file)
        entries, detected_format = parse_log_entries(content)
        return compute_statistics(entries, log_file.file_size, detected_format)

    def delete_log(self, log_id: str) -> None:
        log_file = log_repository.get_by_id(log_id)
        if log_file is None:
            return
        if log_file.disk_path and Path(log_file.disk_path).exists():
            Path(log_file.disk_path).unlink()
        log_repository.delete(log_id)


log_service = LogService()
