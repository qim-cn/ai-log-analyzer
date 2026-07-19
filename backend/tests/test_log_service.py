"""
LogService 单元测试
"""

import pytest

from app.models.log_file import LogFile, LogFileType
from app.services.log_service import (
    ERROR_PATTERN,
    WARN_PATTERN,
    LogService,
    _build_level_pattern,
)


def test_build_level_pattern_matches_keywords():
    pattern = _build_level_pattern({"ERROR", "FATAL"})
    assert pattern.search("this is an ERROR line")
    assert pattern.search("FATAL: something broke")
    assert not pattern.search("this is a warning")


def test_build_level_pattern_is_case_insensitive():
    pattern = _build_level_pattern({"ERROR"})
    assert pattern.search("error")
    assert pattern.search("Error")
    assert pattern.search("ERROR")


def test_build_level_pattern_respects_word_boundary():
    pattern = _build_level_pattern({"ERROR", "FAIL"})
    # 应该匹配单词
    assert pattern.search("ERROR: message")
    assert pattern.search("FAIL: message")
    # 不应该匹配词的一部分
    assert not pattern.search("NOTERRORMESSAGE")
    assert not pattern.search("NOTFAILMESSAGE")


def test_error_pattern_matches_all_keywords():
    assert ERROR_PATTERN.search("ERROR")
    assert ERROR_PATTERN.search("FATAL")
    assert ERROR_PATTERN.search("CRITICAL")
    assert ERROR_PATTERN.search("EXCEPTION")
    assert ERROR_PATTERN.search("PANIC")
    assert ERROR_PATTERN.search("FAIL")


def test_warn_pattern_matches_all_keywords():
    assert WARN_PATTERN.search("WARN")
    assert WARN_PATTERN.search("WARNING")
    assert WARN_PATTERN.search("ALERT")
    assert not WARN_PATTERN.search("ERROR")


def test_get_error_lines_only_filters_errors():
    service = LogService()
    log_file = LogFile(
        id="test-id",
        session_id="session-id",
        filename="test.log",
        file_type=LogFileType.LOG,
        file_size=100,
        line_count=4,
        content="INFO: start\nERROR: something broke\nWARN: caution\nFATAL: crash",
        disk_path=None,
        summary=None,
        created_at="2026-07-18T00:00:00Z",
    )
    result = service.get_error_lines_only(log_file, max_lines=10)
    assert "ERROR" in result
    assert "FATAL" in result
    assert "INFO" not in result
    assert "WARN" not in result


def test_get_error_lines_only_truncates():
    service = LogService()
    content = "\n".join([f"ERROR: line {i}" for i in range(10)])
    log_file = LogFile(
        id="test-id",
        session_id="session-id",
        filename="test.log",
        file_type=LogFileType.LOG,
        file_size=100,
        line_count=10,
        content=content,
        disk_path=None,
        summary=None,
        created_at="2026-07-18T00:00:00Z",
    )
    result = service.get_error_lines_only(log_file, max_lines=3)
    lines = result.split("\n")
    assert len(lines) == 4  # 3 行 + 尾部提示
    assert "共 10 行错误" in lines[-1]
