"""
agent_steps 排查步骤单元测试
"""

from app.models.log_file import LogFile, LogFileType
from app.services.agent_steps import (
    InvestigationContext,
    run_error_extraction,
)


def _log(log_id: str = "log-1", session_id: str = "sess-1", content: str = "") -> LogFile:
    """构造内存态 LogFile（content 直存，不触 DB/磁盘）"""
    return LogFile(
        id=log_id,
        session_id=session_id,
        filename=f"{log_id}.log",
        file_type=LogFileType.LOG,
        file_size=len(content),
        line_count=content.count("\n") + 1,
        content=content,
        disk_path=None,
        summary=None,
        created_at="2026-07-21T00:00:00Z",
    )


def _ctx(content: str = "", model: str | None = None, history: str = "") -> InvestigationContext:
    return InvestigationContext(
        session_id="sess-1",
        logs=[_log(content=content)],
        session_model=model,
        history_text=history,
    )


def _collector():
    """收集 emit 的进度消息"""
    messages: list[str] = []
    return messages, messages.append


# ---- 步骤 1：错误定位 ----

async def test_error_extraction_clusters_errors():
    content = (
        "2024-01-15 10:30:00 INFO boot\n"
        "2024-01-15 10:30:01 ERROR DIMM A2 training failed\n"
        "2024-01-15 10:30:02 ERROR DIMM A2 training failed\n"
        "2024-01-15 10:30:03 ERROR PCIe link down\n"
    )
    ctx = _ctx(content=content)
    messages, emit = _collector()

    result = await run_error_extraction(ctx, emit)

    assert result.status == "ok"
    assert ctx.error_clusters["total_error_lines"] == 3
    assert len(ctx.top_patterns) >= 1
    assert any("DIMM" in p for p in ctx.top_patterns)
    assert messages  # 有进度消息


async def test_error_extraction_no_error_lines():
    ctx = _ctx(content="2024-01-15 10:30:00 INFO all good\nINFO nothing wrong\n")
    messages, emit = _collector()

    result = await run_error_extraction(ctx, emit)

    assert result.status == "ok"
    assert "未发现错误行" in result.summary
    assert ctx.top_patterns == []


async def test_error_extraction_empty_content_fails():
    ctx = _ctx(content="")
    messages, emit = _collector()

    result = await run_error_extraction(ctx, emit)

    assert result.status == "failed"


# ---- 步骤 2：相似案例检索 ----

import sys
from types import SimpleNamespace

from app.services.agent_steps import run_similar_cases


class _FakeVectorStore:
    """假向量库：search_similar 返回固定结果"""

    def __init__(self, results):
        self._results = results

    async def search_similar(self, text, limit=5, exclude_id=None):
        return self._results[:limit]


def _patch_vector_store(monkeypatch, results):
    """用 sys.modules 注入假模块，避免真 import chromadb"""
    monkeypatch.setitem(
        sys.modules,
        "app.services.vector_store",
        SimpleNamespace(vector_store=_FakeVectorStore(results)),
    )


async def test_similar_cases_found(monkeypatch):
    _patch_vector_store(monkeypatch, [
        {"log_id": "old-1", "similarity": 0.92, "metadata": {}, "preview": "x" * 600},
        {"log_id": "old-2", "similarity": 0.71, "metadata": {}, "preview": "short"},
    ])
    ctx = _ctx(content="ERROR DIMM A2 training failed\n")
    ctx.top_patterns = ["ERROR DIMM A2 training failed"]
    messages, emit = _collector()

    result = await run_similar_cases(ctx, emit)

    assert result.status == "ok"
    assert len(ctx.similar_cases) == 2
    assert ctx.similar_cases[0]["similarity"] == 0.92
    # 预览截断到 500 字符
    assert len(ctx.similar_cases[0]["preview"]) == 500
    assert any("0.92" in m for m in messages)


async def test_similar_cases_empty(monkeypatch):
    _patch_vector_store(monkeypatch, [])
    ctx = _ctx(content="ERROR x\n")
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_similar_cases(ctx, emit)

    assert result.status == "ok"
    assert ctx.similar_cases == []
    assert "无相似" in result.summary


async def test_similar_cases_skipped_without_patterns():
    ctx = _ctx(content="INFO ok\n")
    ctx.top_patterns = []
    messages, emit = _collector()

    result = await run_similar_cases(ctx, emit)

    assert result.status == "skipped"
