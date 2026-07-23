"""
sop_service 流水线单元测试
"""

import sys
from types import SimpleNamespace

import pytest

from app.services import sop_service as sop_module
from app.services.sop_service import SopService


def _patch_all(monkeypatch, fake_obsidian, fake_templates, fake_linux, fake_sessions, fake_ai):
    """假数据源 + 假 AI + 假消息服务"""
    monkeypatch.setitem(sys.modules, "app.services.obsidian_service", SimpleNamespace(
        obsidian_service=SimpleNamespace(search_notes=fake_obsidian)
    ))
    monkeypatch.setitem(sys.modules, "app.services.repair_template_service", SimpleNamespace(
        repair_template_service=SimpleNamespace(list=fake_templates)
    ))
    monkeypatch.setitem(sys.modules, "app.services.linux_knowledge_service", SimpleNamespace(
        search_linux_knowledge=fake_linux
    ))
    monkeypatch.setitem(sys.modules, "app.repositories.session_repository", SimpleNamespace(
        session_repository=SimpleNamespace(list_all=fake_sessions)
    ))
    monkeypatch.setitem(sys.modules, "app.services.ai_service", SimpleNamespace(
        ai_service=fake_ai
    ))
    saved: list[str] = []
    monkeypatch.setattr(sop_module, "message_service", SimpleNamespace(
        create_message=lambda session_id, role, content: saved.append(content) or SimpleNamespace(id="msg-1")
    ))
    return saved


class _OkAI:
    def chat_stream(self, messages, temperature=0.7):
        async def gen():
            yield "## 🎯 故障概述\n内存ECC 是 DDR5 常见可纠正错误"
        return gen()


async def _collect(svc: SopService, model="7500S", fault="内存ECC", session_id="sess-1"):
    return [e async for e in svc.generate_sop(model, fault, session_id)]


async def _async_search(query):
    return [{"filename": "case1.md", "title": "DIMM 故障", "snippet": "换内存解决"}]


async def test_sop_event_sequence(monkeypatch):
    saved = _patch_all(
        monkeypatch,
        fake_obsidian=_async_search,
        fake_templates=lambda model=None, limit=50: [{"text": "重插拔内存条", "model": "7500S", "count": 3}],
        fake_linux=lambda query, limit=5: [{"title": "内存ECC检查", "content": "dmesg | grep ECC", "category": "内存"}],
        fake_sessions=lambda model=None, limit=100, offset=0, status=None, q=None: [],
        fake_ai=_OkAI(),
    )
    svc = SopService()
    events = await _collect(svc)

    types = [e["type"] for e in events]
    assert types[0] == "step_start"
    assert types.count("step_start") == 3   # 知识检索 + 证据聚合 + SOP 合成
    assert types.count("step_done") == 3
    assert "report_chunk" in types
    assert types[-1] == "done"
    assert saved and "故障概述" in saved[0]


async def test_sop_ai_failure_fallback(monkeypatch):
    class _FailAI:
        def chat_stream(self, messages, temperature=0.7):
            async def gen():
                raise RuntimeError("AI down")
                yield  # pragma: no cover
            return gen()

    saved = _patch_all(
        monkeypatch,
        fake_obsidian=_async_search,
        fake_templates=lambda model=None, limit=50: [{"text": "重插拔", "model": "7500S", "count": 1}],
        fake_linux=lambda query, limit=5: [],
        fake_sessions=lambda **kw: [],
        fake_ai=_FailAI(),
    )
    svc = SopService()
    events = await _collect(svc)

    report = "".join(e.get("content", "") for e in events if e["type"] == "report_chunk")
    assert "兜底" in report or "SOP" in report  # fallback 报告
    assert saved
