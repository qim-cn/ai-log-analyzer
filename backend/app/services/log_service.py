"""
Log 业务逻辑层

处理日志文件的上传、解析、存储。
- 小文件（<=1MB）：存数据库 content 字段
- 中等文件（1MB~10MB）：存磁盘，数据库存路径 + 摘要
- 大文件（>10MB）：流式分块解析，存磁盘
- 上传入库前统一脱敏（settings.mask_sensitive_data），
  占位符映射存 log_files.masking_map
"""

import codecs
import json
import logging
import re
import uuid
from pathlib import Path

from app.config.database import get_connection
from app.config.settings import settings
from app.middlewares.error_handler import ValidationError
from app.models.log_file import LogFile, LogFileType
from app.repositories.log_repository import log_repository
from app.services.error_cluster_service import extract_timestamp
from app.services.masking_service import load_custom_patterns, masking_service
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

# 日志级别关键词（统一使用，避免正则重复）
ERROR_KEYWORDS = {"ERROR", "FATAL", "CRITICAL", "EXCEPTION", "PANIC", "FAIL"}
WARN_KEYWORDS = {"WARN", "WARNING", "ALERT"}


def _build_level_pattern(keywords: set[str]) -> re.Pattern:
    """拼接级别关键词为 word-boundary 正则"""
    escaped = "|".join(re.escape(k) for k in sorted(keywords))
    return re.compile(rf"\b({escaped})\b", re.IGNORECASE)


ERROR_PATTERN = _build_level_pattern(ERROR_KEYWORDS)
WARN_PATTERN = _build_level_pattern(WARN_KEYWORDS)


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

        # 脱敏器：同一文件全程复用同一实例，保证同一敏感值映射到同一占位符
        mask_enabled = masking_service.is_enabled()
        masker = (
            masking_service.create_masker(custom_patterns=load_custom_patterns())
            if mask_enabled
            else None
        )
        # 增量解码 + 行级缓冲：保证跨分块的 UTF-8 字符和敏感值不被截断
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        pending = ""

        def _collect_stats(text: str) -> None:
            nonlocal line_count, error_count, warning_count
            for line in text.split("\n"):
                if not line.strip():
                    continue
                line_count += 1
                if len(first_lines) < 30:
                    first_lines.append(line)
                last_lines_buffer.append(line)
                if len(last_lines_buffer) > max_tail:
                    last_lines_buffer.pop(0)
                if ERROR_PATTERN.search(line):
                    error_count += 1
                elif WARN_PATTERN.search(line):
                    warning_count += 1

        def _emit(f, text: str) -> None:
            """脱敏后写盘并统计"""
            if masker is not None:
                text = masker.mask(text)
            f.write(text.encode("utf-8"))
            _collect_stats(text)

        with open(disk_path, "wb") as f:
            async for chunk in file_iterator:
                if masker is None:
                    # 未开启脱敏：保持原始字节写盘，仅做统计
                    f.write(chunk)
                    _collect_stats(chunk.decode("utf-8", errors="replace"))
                    continue
                # 只处理到最后一个换行符为止，剩余部分留到下一分块，
                # 避免敏感值恰好落在分块边界时漏脱敏
                pending += decoder.decode(chunk)
                last_newline = pending.rfind("\n")
                if last_newline >= 0:
                    _emit(f, pending[: last_newline + 1])
                    pending = pending[last_newline + 1:]
            if masker is not None:
                pending += decoder.decode(b"", final=True)
                if pending:
                    _emit(f, pending)

        # 生成摘要
        summary = self._generate_summary(
            filename, line_count, file_size, error_count, warning_count,
            first_lines, last_lines_buffer
        )

        # 更新 DB（含脱敏映射，供将来还原）
        masking_map_json = (
            json.dumps(masker.mapping, ensure_ascii=False)
            if masker is not None and masker.mapping
            else None
        )
        conn = get_connection()
        conn.execute(
            "UPDATE log_files SET disk_path = ?, summary = ?, line_count = ?, masking_map = ? WHERE id = ?",
            (disk_path, summary, line_count, masking_map_json, log_file.id),
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

        # 入库前脱敏：后续所有下游（统计/摘要/发给 LLM 的内容）都是脱敏后的
        mask_enabled = masking_service.is_enabled()
        masking_map_json = None
        if mask_enabled:
            text_content, mapping = masking_service.mask_text(
                text_content, custom_patterns=load_custom_patterns()
            )
            if mapping:
                masking_map_json = json.dumps(mapping, ensure_ascii=False)

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
                masking_map=masking_map_json,
            )
        else:
            storage_dir = Path(settings.log_storage_path)
            storage_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_repository.create(
                session_id=session_id, filename=filename, file_type=file_type,
                file_size=len(content), line_count=line_count, disk_path="",
            )
            disk_path = str(storage_dir / f"{log_file.id}{ext}")
            if mask_enabled:
                Path(disk_path).write_text(text_content, encoding="utf-8")
            else:
                Path(disk_path).write_bytes(content)
            conn = get_connection()
            conn.execute(
                "UPDATE log_files SET disk_path = ?, summary = ?, masking_map = ? WHERE id = ?",
                (disk_path, summary_obj.to_prompt_text(), masking_map_json, log_file.id),
            )
            conn.commit()
            return log_repository.get_by_id(log_file.id)

    def get_log_content(self, log_file: LogFile, max_chars: int = 50000) -> str:
        """获取日志内容（用于统计/对比/聚类/时间线等需要真实日志的场景）

        优先级：DB content -> 磁盘文件（头尾截断）-> 摘要（最后兜底）。
        summary 是结构化文本摘要，不能替代真实日志用于行级解析；
        此前磁盘存储的日志（>1MB）误返回 summary，导致统计/对比/聚类/时间线全失真。
        """
        if log_file.content:
            if len(log_file.content) <= max_chars:
                return log_file.content
            half = max_chars // 2
            return log_file.content[:half] + "\n... (截断) ...\n" + log_file.content[-half:]
        if log_file.disk_path and Path(log_file.disk_path).exists():
            return self._read_head_tail(log_file.disk_path, max_chars)
        if log_file.summary:
            return log_file.summary
        return "(文件内容不可用)"

    def get_error_lines_only(self, log_file: LogFile, max_lines: int = 500) -> str:
        """只获取错误行（用于上下文注入，节省 token）"""
        content = self.get_log_content(log_file)
        error_lines = [line for line in content.split("\n") if ERROR_PATTERN.search(line)]
        if len(error_lines) > max_lines:
            error_lines = error_lines[:max_lines] + [f"... (共 {len(error_lines)} 行错误)"]
        return "\n".join(error_lines)

    def get_content_slice(
        self,
        log_file: LogFile,
        start: str | None = None,
        end: str | None = None,
        max_lines: int = 5000,
        max_chars: int = 200 * 1024,
    ) -> dict:
        """按行内时间戳切取时间窗内的日志内容

        - start/end 与行内时间戳同格式（ISO 等），字典序比较；缺省表示不限。
        - 行内无时间戳的行视为上一条时间戳行的延续（如堆栈行），
          处于窗口内则保留，窗口外则跳过。
        - 超过 max_lines / max_chars 截断并置 truncated 标记。

        Returns:
            {content, matched_lines, total_lines, truncated, start, end}
        """
        # 取行源：DB 小文件直接切分；磁盘文件流式逐行读，避免整文件进内存
        if log_file.content:
            line_iter = iter(log_file.content.split("\n"))
        elif log_file.disk_path and Path(log_file.disk_path).exists():
            line_iter = self._iter_file_lines(log_file.disk_path)
        else:
            return {
                "content": "",
                "matched_lines": 0,
                "total_lines": 0,
                "truncated": False,
                "start": start,
                "end": end,
            }

        kept: list[str] = []
        total_lines = 0
        matched_lines = 0
        chars = 0
        truncated = False
        in_window = False

        for line in line_iter:
            if not line.strip():
                continue
            total_lines += 1
            ts = extract_timestamp(line)
            if ts is not None:
                in_window = (start is None or ts >= start) and (end is None or ts <= end)
            # 无时间戳的行沿用上一行的窗口状态（延续行归并策略）
            if not in_window:
                continue
            matched_lines += 1
            if len(kept) >= max_lines or chars + len(line) + 1 > max_chars:
                truncated = True
                continue
            kept.append(line)
            chars += len(line) + 1

        content = "\n".join(kept)
        if truncated:
            content += f"\n... (切片过大已截断，仅保留前 {len(kept)} 行 / {max_chars // 1024}KB)"
        return {
            "content": content,
            "matched_lines": matched_lines,
            "total_lines": total_lines,
            "truncated": truncated,
            "start": start,
            "end": end,
        }

    def _iter_file_lines(self, file_path: str):
        """逐行读取磁盘日志文件"""
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                yield line.rstrip("\n")

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
                errors = [l for l in lf.content.split("\n") if ERROR_PATTERN.search(l)]
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
