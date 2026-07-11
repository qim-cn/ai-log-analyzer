"""
Timeline Service - 日志时间线数据服务

提供时间轴展示所需的错误分布数据。
"""

import logging
import re
from datetime import datetime, timedelta
from typing import List, Optional

from app.config.database import get_connection
from app.repositories.log_repository import log_repository
from app.services.log_service import log_service

logger = logging.getLogger(__name__)


class TimelineService:
    """时间线服务"""

    def get_error_timeline(
        self,
        session_id: str,
        interval: str = "hour",
    ) -> dict:
        """
        获取错误时间线数据

        Args:
            session_id: 会话 ID
            interval: 时间间隔 (minute, hour, day)

        Returns:
            时间线数据
        """
        logs = log_repository.get_by_session(session_id)
        if not logs:
            return {"timeline": [], "total_errors": 0}

        # 收集所有错误及其时间戳
        error_events = []
        error_pattern = re.compile(
            r'\b(ERROR|FATAL|CRITICAL|EXCEPTION|PANIC|FAIL(?:ED|URE)?)\b',
            re.IGNORECASE
        )

        # 时间戳模式
        timestamp_patterns = [
            r'(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)',
            r'(\d{2}:\d{2}:\d{2}(?:\.\d+)?)',
            r'(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})',
        ]

        for log_file in logs:
            content = log_service.get_log_content(log_file)
            lines = content.split('\n')

            for i, line in enumerate(lines):
                if error_pattern.search(line):
                    # 提取时间戳
                    timestamp = self._extract_timestamp(line, timestamp_patterns)
                    if not timestamp:
                        timestamp = log_file.created_at

                    # 提取错误类型
                    error_match = error_pattern.search(line)
                    error_type = error_match.group(1).upper() if error_match else "UNKNOWN"

                    error_events.append({
                        "timestamp": timestamp,
                        "line_number": i + 1,
                        "error_type": error_type,
                        "content": line.strip()[:200],
                        "log_file": log_file.filename,
                        "log_id": log_file.id,
                    })

        # 按时间排序
        error_events.sort(key=lambda x: x["timestamp"])

        # 按时间间隔分组
        timeline = self._group_by_interval(error_events, interval)

        return {
            "timeline": timeline,
            "total_errors": len(error_events),
            "events": error_events[:100],  # 返回前 100 个事件
        }

    def _extract_timestamp(self, line: str, patterns: List[str]) -> Optional[str]:
        """从日志行提取时间戳"""
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                try:
                    ts_str = match.group(1)
                    # 尝试解析时间戳
                    for fmt in [
                        "%Y-%m-%dT%H:%M:%S",
                        "%Y-%m-%d %H:%M:%S",
                        "%Y/%m/%d %H:%M:%S",
                        "%H:%M:%S",
                    ]:
                        try:
                            dt = datetime.strptime(ts_str[:19], fmt)
                            return dt.isoformat()
                        except ValueError:
                            continue
                except Exception:
                    pass
        return None

    def _group_by_interval(
        self,
        events: List[dict],
        interval: str,
    ) -> List[dict]:
        """按时间间隔分组"""
        if not events:
            return []

        # 确定时间格式
        format_map = {
            "minute": "%Y-%m-%d %H:%M",
            "hour": "%Y-%m-%d %H:00",
            "day": "%Y-%m-%d",
        }
        fmt = format_map.get(interval, format_map["hour"])

        # 分组
        groups = {}
        for event in events:
            try:
                ts = event["timestamp"]
                if len(ts) > 19:
                    ts = ts[:19]
                dt = datetime.fromisoformat(ts)
                key = dt.strftime(fmt)
            except (ValueError, TypeError):
                key = "unknown"

            if key not in groups:
                groups[key] = {
                    "time": key,
                    "count": 0,
                    "error_types": {},
                }

            groups[key]["count"] += 1
            error_type = event.get("error_type", "UNKNOWN")
            groups[key]["error_types"][error_type] = (
                groups[key]["error_types"].get(error_type, 0) + 1
            )

        # 转换为列表并排序
        timeline = sorted(groups.values(), key=lambda x: x["time"])

        return timeline

    def get_log_context(
        self,
        log_id: str,
        line_number: int,
        context_lines: int = 20,
    ) -> dict:
        """
        获取日志行的上下文

        Args:
            log_id: 日志文件 ID
            line_number: 行号
            context_lines: 上下文行数

        Returns:
            上下文内容
        """
        log_file = log_repository.get_by_id(log_id)
        if not log_file:
            return {"error": "Log file not found"}

        content = log_service.get_log_content(log_file)
        lines = content.split('\n')

        start = max(0, line_number - context_lines)
        end = min(len(lines), line_number + context_lines)

        context = []
        for i in range(start, end):
            context.append({
                "line_number": i + 1,
                "content": lines[i],
                "is_target": i + 1 == line_number,
            })

        return {
            "log_id": log_id,
            "filename": log_file.filename,
            "target_line": line_number,
            "context": context,
        }


# 全局单例
timeline_service = TimelineService()
