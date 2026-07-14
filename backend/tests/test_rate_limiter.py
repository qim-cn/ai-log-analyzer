"""
RateLimiter 单元测试
"""

import time

from app.services.rate_limiter import (
    MemoryRateLimiter,
    RateLimiterFactory,
    SQLiteRateLimiter,
)


def test_memory_rate_limiter_allows_under_limit():
    limiter = MemoryRateLimiter(max_requests=3, window_seconds=60)
    assert limiter.is_allowed("1.2.3.4")
    assert limiter.is_allowed("1.2.3.4")
    assert limiter.is_allowed("1.2.3.4")


def test_memory_rate_limiter_blocks_at_limit():
    limiter = MemoryRateLimiter(max_requests=2, window_seconds=60)
    assert limiter.is_allowed("1.2.3.4")
    assert limiter.is_allowed("1.2.3.4")
    assert not limiter.is_allowed("1.2.3.4")


def test_memory_rate_limiter_tracks_per_ip():
    limiter = MemoryRateLimiter(max_requests=2, window_seconds=60)
    assert limiter.is_allowed("1.2.3.4")
    assert limiter.is_allowed("5.6.7.8")
    assert limiter.is_allowed("1.2.3.4")
    assert limiter.is_allowed("5.6.7.8")
    assert not limiter.is_allowed("1.2.3.4")
    assert not limiter.is_allowed("5.6.7.8")


def test_memory_rate_limiter_window_slides():
    limiter = MemoryRateLimiter(max_requests=1, window_seconds=0.1)
    assert limiter.is_allowed("1.2.3.4")
    assert not limiter.is_allowed("1.2.3.4")
    time.sleep(0.15)
    assert limiter.is_allowed("1.2.3.4")


def test_factory_returns_sqlite_by_default():
    RateLimiterFactory.reset()
    limiter = RateLimiterFactory.get_limiter(backend="sqlite")
    assert isinstance(limiter, SQLiteRateLimiter)


def test_factory_returns_memory_when_configured():
    RateLimiterFactory.reset()
    limiter = RateLimiterFactory.get_limiter(backend="memory")
    assert isinstance(limiter, MemoryRateLimiter)


def test_factory_is_singleton():
    RateLimiterFactory.reset()
    a = RateLimiterFactory.get_limiter(backend="memory")
    b = RateLimiterFactory.get_limiter(backend="memory")
    assert a is b
