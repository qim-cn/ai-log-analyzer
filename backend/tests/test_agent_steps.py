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


# ---- 步骤 3：同批次模式检测 ----

from app.models.session import Session
from app.services.agent_steps import run_batch_pattern


def _session(sid: str, model: str | None, sn: str | None = None) -> Session:
    return Session(
        id=sid,
        title=f"会话-{sid}",
        created_at="2026-07-21T00:00:00Z",
        updated_at="2026-07-21T00:00:00Z",
        user_id="u1",
        model=model,
        sn=sn,
        status="open",
    )


def _patch_batch_repos(monkeypatch, sessions, logs_by_session):
    """假 session/log 仓库（函数级 import，sys.modules 注入）"""
    monkeypatch.setitem(
        sys.modules,
        "app.repositories.session_repository",
        SimpleNamespace(
            session_repository=SimpleNamespace(
                list_all=lambda model=None, limit=100: [
                    s for s in sessions if model is None or s.model == model
                ][:limit]
            )
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.repositories.log_repository",
        SimpleNamespace(
            log_repository=SimpleNamespace(
                get_by_session=lambda sid: logs_by_session.get(sid, [])
            )
        ),
    )


async def test_batch_pattern_detects_batch(monkeypatch):
    """同机型另一台机器出现相同归一化错误模式 → 批次判定"""
    error_log = _log(log_id="l-cur", session_id="sess-1",
                     content="2024-01-15 10:30:01 ERROR DIMM A2 training failed\n")
    other_log = _log(log_id="l-other", session_id="sess-2",
                     content="2024-01-16 09:00:01 ERROR DIMM A2 training failed\n")
    clean_log = _log(log_id="l-clean", session_id="sess-3", content="INFO ok\n")

    _patch_batch_repos(
        monkeypatch,
        sessions=[
            _session("sess-1", "7500S", sn="SN001"),
            _session("sess-2", "7500S", sn="SN002"),
            _session("sess-3", "7500S", sn="SN003"),
        ],
        logs_by_session={"sess-1": [error_log], "sess-2": [other_log], "sess-3": [clean_log]},
    )

    ctx = _ctx(content=error_log.content, model="7500S")
    ctx.top_patterns = ["ERROR DIMM A<NUM> training failed"]  # 归一化后形态
    # 用真实归一化保证测试与实现对齐
    from app.services.error_cluster_service import normalize_line
    ctx.top_patterns = [normalize_line("2024-01-15 10:30:01 ERROR DIMM A2 training failed")]

    messages, emit = _collector()
    result = await run_batch_pattern(ctx, emit)

    assert result.status == "ok"
    assert ctx.batch_result["matched_count"] == 1
    assert ctx.batch_result["is_batch"] is True
    assert "SN002" in ctx.batch_result["matched_machines"]
    assert "同批次" in result.summary


async def test_batch_pattern_single_occurrence(monkeypatch):
    """同机型其他会话都没有相同模式 → 单台偶发"""
    error_log = _log(log_id="l-cur", session_id="sess-1",
                     content="ERROR unique failure xyz\n")
    clean_log = _log(log_id="l-clean", session_id="sess-2", content="INFO ok\n")
    _patch_batch_repos(
        monkeypatch,
        sessions=[_session("sess-1", "7500S"), _session("sess-2", "7500S", sn="SN002")],
        logs_by_session={"sess-1": [error_log], "sess-2": [clean_log]},
    )

    ctx = _ctx(content=error_log.content, model="7500S")
    ctx.top_patterns = ["ERROR unique failure xyz"]
    messages, emit = _collector()

    result = await run_batch_pattern(ctx, emit)

    assert result.status == "ok"
    assert ctx.batch_result["matched_count"] == 0
    assert ctx.batch_result["is_batch"] is False
    assert "单台偶发" in result.summary


async def test_batch_pattern_skipped_without_model():
    ctx = _ctx(content="ERROR x\n", model=None)
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_batch_pattern(ctx, emit)

    assert result.status == "skipped"
    assert "机型" in result.summary


# ---- 步骤 4：知识库与维修模板 ----

from app.services.agent_steps import run_knowledge_lookup


class _FakeKnowledgeFeedback:
    def __init__(self, refs):
        self._refs = refs

    async def search_and_inject(self, query, obsidian_service):
        return ("注入文本", self._refs)


def _patch_knowledge(monkeypatch, refs, templates):
    monkeypatch.setitem(
        sys.modules,
        "app.services.knowledge_feedback",
        SimpleNamespace(knowledge_feedback=_FakeKnowledgeFeedback(refs)),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.services.obsidian_service",
        SimpleNamespace(obsidian_service=object()),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.services.repair_template_service",
        SimpleNamespace(
            repair_template_service=SimpleNamespace(
                list=lambda model=None, limit=50: templates[:limit]
            )
        ),
    )


async def test_knowledge_lookup_hits(monkeypatch):
    _patch_knowledge(
        monkeypatch,
        refs=[{"filename": "case1.md", "title": "DIMM 故障案例", "snippet": "s" * 400}],
        templates=[{"text": "重插拔内存条", "model": "7500S", "count": 3}],
    )
    ctx = _ctx(content="ERROR x\n", model="7500S")
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_knowledge_lookup(ctx, emit)

    assert result.status == "ok"
    assert len(ctx.knowledge_refs) == 1
    assert ctx.knowledge_refs[0]["title"] == "DIMM 故障案例"
    # snippet 截断到 300 字符
    assert len(ctx.knowledge_refs[0]["snippet"]) == 300
    assert ctx.repair_templates == [{"text": "重插拔内存条", "count": 3}]


async def test_knowledge_lookup_no_hits(monkeypatch):
    _patch_knowledge(monkeypatch, refs=[], templates=[])
    ctx = _ctx(content="ERROR x\n")
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_knowledge_lookup(ctx, emit)

    assert result.status == "ok"
    assert "均无命中" in result.summary
    assert ctx.knowledge_refs == []
    assert ctx.repair_templates == []


async def test_knowledge_lookup_kb_failure_still_gets_templates(monkeypatch):
    """知识库抛异常不阻断：模板照常查询，步骤整体 ok"""

    class _FailKF:
        async def search_and_inject(self, query, obsidian_service):
            raise RuntimeError("WebDAV down")

    monkeypatch.setitem(
        sys.modules,
        "app.services.knowledge_feedback",
        SimpleNamespace(knowledge_feedback=_FailKF()),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.services.obsidian_service",
        SimpleNamespace(obsidian_service=object()),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.services.repair_template_service",
        SimpleNamespace(
            repair_template_service=SimpleNamespace(
                list=lambda model=None, limit=50: [{"text": "重插拔内存条", "model": "", "count": 1}]
            )
        ),
    )
    ctx = _ctx(content="ERROR x\n")
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_knowledge_lookup(ctx, emit)

    assert result.status == "ok"
    assert ctx.knowledge_refs == []
    assert len(ctx.repair_templates) == 1
    assert any("不可用" in m for m in messages)
