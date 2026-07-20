"""
LogService.get_content_slice 时间窗切片单元测试
"""

from app.models.log_file import LogFile, LogFileType
from app.services.log_service import LogService

CONTENT = "\n".join([
    "2024-01-15 09:59:59 INFO before window",
    "2024-01-15 10:00:00 ERROR first in window",
    "\tat com.foo.Bar.run(Bar.java:12)",   # 无时间戳的延续行（堆栈）
    "2024-01-15 10:30:00 INFO middle",
    "2024-01-15 11:00:00 ERROR last in window",
    "2024-01-15 11:00:01 INFO after window",
])

START = "2024-01-15 10:00:00"
END = "2024-01-15 11:00:00"


def _log_file(content: str | None) -> LogFile:
    return LogFile(
        id="test-id",
        session_id="session-id",
        filename="test.log",
        file_type=LogFileType.LOG,
        file_size=len(content or ""),
        line_count=6,
        content=content,
        disk_path=None,
        summary=None,
        created_at="2024-01-15T00:00:00",
    )


def test_slice_filters_by_time_window():
    service = LogService()
    result = service.get_content_slice(_log_file(CONTENT), start=START, end=END)
    assert result["matched_lines"] == 4  # 3 条时间戳行 + 1 条延续行
    assert result["total_lines"] == 6
    assert not result["truncated"]
    assert "before window" not in result["content"]
    assert "after window" not in result["content"]
    assert "first in window" in result["content"]
    assert "last in window" in result["content"]


def test_slice_keeps_continuation_lines_inside_window():
    """无时间戳的行（如堆栈）跟随上一条时间戳行的窗口状态"""
    service = LogService()
    result = service.get_content_slice(_log_file(CONTENT), start=START, end=END)
    assert "at com.foo.Bar.run" in result["content"]


def test_slice_skips_continuation_lines_outside_window():
    content = "\n".join([
        "2024-01-15 09:00:00 ERROR outside",
        "\tat com.foo.Bar.run(Bar.java:12)",  # 窗口外延续行应跳过
        "2024-01-15 10:00:00 ERROR inside",
    ])
    service = LogService()
    result = service.get_content_slice(
        _log_file(content), start=START, end=END
    )
    assert "inside" in result["content"]
    assert "outside" not in result["content"]
    assert "at com.foo.Bar.run" not in result["content"]


def test_slice_open_bounds():
    service = LogService()
    # 不限窗口 = 全量
    result = service.get_content_slice(_log_file(CONTENT))
    assert result["matched_lines"] == 6
    # 只给 start
    result = service.get_content_slice(_log_file(CONTENT), start=END)
    assert "first in window" not in result["content"]
    assert "last in window" in result["content"]
    assert "after window" in result["content"]


def test_slice_truncates_by_max_lines():
    service = LogService()
    result = service.get_content_slice(
        _log_file(CONTENT), max_lines=2
    )
    assert result["truncated"]
    assert result["matched_lines"] == 6
    assert "已截断" in result["content"]
    # 截断后正文只含前 2 行
    body = result["content"].split("\n... (")[0]
    assert len(body.split("\n")) == 2


def test_slice_truncates_by_max_chars():
    service = LogService()
    result = service.get_content_slice(_log_file(CONTENT), max_chars=40)
    assert result["truncated"]
    assert "已截断" in result["content"]


def test_slice_no_content_available():
    service = LogService()
    result = service.get_content_slice(_log_file(None), start=START, end=END)
    assert result["content"] == ""
    assert result["matched_lines"] == 0
    assert result["total_lines"] == 0


def test_slice_syslog_timestamp_format():
    """syslog 格式时间戳（与 error_cluster_service 提取格式一致）"""
    content = "\n".join([
        "Jan 15 09:59:59 ERROR before",
        "Jan 15 10:00:00 ERROR inside",
        "Jan 15 10:00:01 ERROR after",
    ])
    service = LogService()
    result = service.get_content_slice(
        _log_file(content), start="Jan 15 10:00:00", end="Jan 15 10:00:00"
    )
    assert result["matched_lines"] == 1
    assert "inside" in result["content"]
