"""
ErrorClusterService 单元测试
"""

from app.services.error_cluster_service import (
    ErrorClusterService,
    extract_timestamp,
    is_error_line,
    normalize_line,
)

service = ErrorClusterService()


# ---- 错误行识别 ----

def test_is_error_line_matches_levels():
    assert is_error_line("2024-01-15 10:30:00 ERROR disk full")
    assert is_error_line("FATAL: kernel panic")
    assert is_error_line("critical failure in module")


def test_is_error_line_matches_fail_keywords():
    assert is_error_line("INFO request failed after 3 retries")
    assert is_error_line("connection failure detected")


def test_is_error_line_matches_stack_lines():
    assert is_error_line("Traceback (most recent call last):")
    assert is_error_line('  File "app.py", line 42, in <module>')
    assert is_error_line("\tat com.foo.Bar.run(Bar.java:123)")
    assert is_error_line("Caused by: java.io.IOException: disk full")
    assert is_error_line("NullPointerException")


def test_is_error_line_ignores_normal_lines():
    assert not is_error_line("2024-01-15 10:30:00 INFO service started")
    assert not is_error_line("DEBUG cache hit ratio 99%")
    assert not is_error_line("")


# ---- 时间戳提取 ----

def test_extract_timestamp_iso():
    assert extract_timestamp("2024-01-15 10:30:00 ERROR x") == "2024-01-15 10:30:00"
    assert extract_timestamp("2024-01-15T10:30:00.123Z ERROR x") == "2024-01-15T10:30:00.123Z"


def test_extract_timestamp_none():
    assert extract_timestamp("ERROR no timestamp here") is None


# ---- 归一化 ----

def test_normalize_removes_variable_parts():
    a = normalize_line('2024-01-15 10:30:00 ERROR request 12345 from "user-a" failed')
    b = normalize_line('2024-02-20 11:40:01 ERROR request 67890 from "user-b" failed')
    assert a == b
    assert "12345" not in a
    assert "user-a" not in a


def test_normalize_handles_uuid_hex_and_line_numbers():
    line = (
        "ERROR job 550e8400-e29b-41d4-a716-446655440000 at 0x7fff1234 "
        "failed in /app/worker.py:88"
    )
    norm = normalize_line(line)
    assert "550e8400" not in norm
    assert "0x7fff1234" not in norm
    assert ":88" not in norm
    assert "<UUID>" in norm
    assert "<HEX>" in norm


# ---- 聚类 ----

def test_cluster_groups_and_counts():
    content = "\n".join([
        "2024-01-15 10:00:00 INFO start",
        "2024-01-15 10:00:01 ERROR disk full on /dev/sda1",
        "2024-01-15 10:00:02 ERROR disk full on /dev/sda1",
        "2024-01-15 10:00:03 ERROR connection refused to db",
        "2024-01-15 10:00:04 ERROR disk full on /dev/sda1",
    ])
    result = service.cluster_errors(content)
    assert result["total_error_lines"] == 4
    clusters = result["clusters"]
    assert len(clusters) == 2
    # 按次数降序
    assert clusters[0]["count"] == 3
    assert clusters[1]["count"] == 1
    # 占比
    assert clusters[0]["ratio"] == 0.75
    # 样例是原始行
    assert "disk full on /dev/sda1" in clusters[0]["sample"]


def test_cluster_first_and_last_seen():
    content = "\n".join([
        "2024-01-15 10:00:05 ERROR timeout after 30s",
        "2024-01-15 10:02:11 ERROR timeout after 30s",
        "2024-01-15 10:01:07 ERROR timeout after 30s",
    ])
    result = service.cluster_errors(content)
    cluster = result["clusters"][0]
    assert cluster["first_seen"] == "2024-01-15 10:00:05"
    assert cluster["last_seen"] == "2024-01-15 10:02:11"


def test_cluster_no_error_lines():
    result = service.cluster_errors("INFO all good\nDEBUG nothing to see")
    assert result["total_error_lines"] == 0
    assert result["clusters"] == []


def test_cluster_limit():
    content = "\n".join(
        f"2024-01-15 10:00:{i:02d} ERROR unique problem number {i} occurred"
        for i in range(30)
    )
    # 每行数字不同但归一化后相同 -> 只有 1 个聚类
    result = service.cluster_errors(content, limit=20)
    assert len(result["clusters"]) == 1
    assert result["clusters"][0]["count"] == 30
