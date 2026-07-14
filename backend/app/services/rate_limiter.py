"""
IP 请求限流器

默认使用 SQLite 存储请求记录，支持多进程/多容器复本（共享数据库）。
也可通过 RATE_LIMITER_BACKEND=memory 切换到内存限流器。
"""

import abc
import time
from typing import ClassVar

from app.config.database import get_connection


class RateLimiter(abc.ABC):
    """限流器接口"""

    @abc.abstractmethod
    def is_allowed(self, client_ip: str) -> bool:
        """返回 True 表示请求被允许"""


class MemoryRateLimiter(RateLimiter):
    """基于内存滑动窗口的限流器（仅适合单进程）"""

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = {}

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        window_start = now - self.window_seconds

        if client_ip not in self._requests:
            self._requests[client_ip] = []

        self._requests[client_ip] = [
            t for t in self._requests[client_ip] if t > window_start
        ]

        if len(self._requests[client_ip]) >= self.max_requests:
            return False

        self._requests[client_ip].append(now)
        return True


class SQLiteRateLimiter(RateLimiter):
    """基于 SQLite 滑动窗口的限流器（适合多进程/多容器）"""

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        cutoff = now - self.window_seconds
        conn = get_connection()

        # 清理过期记录
        conn.execute("DELETE FROM rate_limits WHERE timestamp < ?", (cutoff,))

        # 统计当前窗口内的请求数
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM rate_limits WHERE client_ip = ? AND timestamp >= ?",
            (client_ip, cutoff),
        ).fetchone()
        count = row["cnt"] if row else 0

        if count >= self.max_requests:
            conn.commit()
            return False

        conn.execute(
            "INSERT INTO rate_limits (client_ip, timestamp) VALUES (?, ?)",
            (client_ip, now),
        )
        conn.commit()
        return True


class RateLimiterFactory:
    """限流器工厂"""

    _instance: ClassVar[RateLimiter | None] = None

    @classmethod
    def get_limiter(
        cls,
        backend: str | None = None,
        max_requests: int = 120,
        window_seconds: int = 60,
    ) -> RateLimiter:
        if cls._instance is None:
            backend = (backend or "sqlite").lower()
            if backend == "memory":
                cls._instance = MemoryRateLimiter(max_requests, window_seconds)
            elif backend == "sqlite":
                cls._instance = SQLiteRateLimiter(max_requests, window_seconds)
            else:
                raise ValueError(f"不支持的限流器后端: {backend}")
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        cls._instance = None
