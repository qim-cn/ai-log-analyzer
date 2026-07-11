"""
AI 调用统计服务
"""

import time
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class AICallStats:
    """AI 调用统计"""

    total_calls: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    total_tokens: int = 0
    total_duration_ms: int = 0
    last_call_time: str | None = None
    last_call_model: str | None = None
    last_call_duration_ms: int = 0

    # 按小时统计
    hourly_calls: dict[str, int] = field(default_factory=dict)

    @property
    def avg_duration_ms(self) -> int:
        if self.successful_calls == 0:
            return 0
        return self.total_duration_ms // self.successful_calls

    @property
    def success_rate(self) -> float:
        if self.total_calls == 0:
            return 0
        return self.successful_calls / self.total_calls * 100


class StatsService:
    """统计服务"""

    def __init__(self):
        self._stats = AICallStats()

    def record_call(
        self,
        success: bool,
        duration_ms: int,
        tokens: int = 0,
        model: str = "",
    ) -> None:
        """记录一次 AI 调用"""
        self._stats.total_calls += 1

        if success:
            self._stats.successful_calls += 1
        else:
            self._stats.failed_calls += 1

        self._stats.total_tokens += tokens
        self._stats.total_duration_ms += duration_ms
        self._stats.last_call_time = datetime.utcnow().isoformat()
        self._stats.last_call_model = model
        self._stats.last_call_duration_ms = duration_ms

        # 按小时统计
        hour_key = datetime.utcnow().strftime("%Y-%m-%d %H:00")
        self._stats.hourly_calls[hour_key] = self._stats.hourly_calls.get(hour_key, 0) + 1

    def get_stats(self) -> dict:
        """获取统计信息"""
        return {
            "total_calls": self._stats.total_calls,
            "successful_calls": self._stats.successful_calls,
            "failed_calls": self._stats.failed_calls,
            "success_rate": round(self._stats.success_rate, 1),
            "total_tokens": self._stats.total_tokens,
            "avg_duration_ms": self._stats.avg_duration_ms,
            "last_call_time": self._stats.last_call_time,
            "last_call_model": self._stats.last_call_model,
            "last_call_duration_ms": self._stats.last_call_duration_ms,
            "hourly_calls": dict(sorted(self._stats.hourly_calls.items())[-24:]),
        }


# 全局实例
stats_service = StatsService()
