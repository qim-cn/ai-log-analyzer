"""
agent_routes 路由单元测试

无路由测试基建（无 TestClient/JWT fixture），按现有测试风格
直接调用 handler：fake request + monkeypatch 归属校验与服务。
"""

from types import SimpleNamespace

import pytest
from fastapi.responses import StreamingResponse

from app.middlewares.error_handler import ValidationError
from app.routes import agent_routes
from app.routes.agent_routes import investigate
from app.types.agent_types import InvestigateRequest


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(user=SimpleNamespace(id="u1", role="admin"))
    )


def _patch_happy(monkeypatch, events):
    """打通 handler 的所有外部依赖"""
    monkeypatch.setattr(agent_routes, "require_session_owner", lambda sid, user: None)
    monkeypatch.setattr(agent_routes, "require_log_owner", lambda lid, user: None)
    monkeypatch.setattr(
        agent_routes,
        "log_repository",
        SimpleNamespace(get_by_id=lambda lid: SimpleNamespace(session_id="sess-1")),
    )
    monkeypatch.setattr(
        agent_routes,
        "log_service",
        SimpleNamespace(get_logs_by_session=lambda sid: [object()]),
    )

    class _FakeAgent:
        def is_active(self, user_id):
            return False

        def investigate(self, session_id, user_id):
            async def gen():
                for e in events:
                    yield e
            return gen()

    monkeypatch.setattr(agent_routes, "agent_service", _FakeAgent())


async def test_investigate_requires_one_id():
    with pytest.raises(ValidationError, match="必须提供一个"):
        await investigate(InvestigateRequest(), _request())


async def test_investigate_rejects_when_active(monkeypatch):
    _patch_happy(monkeypatch, [])
    monkeypatch.setattr(
        agent_routes,
        "agent_service",
        SimpleNamespace(is_active=lambda uid: True),
    )
    with pytest.raises(ValidationError, match="已有排查进行中"):
        await investigate(InvestigateRequest(session_id="sess-1"), _request())


async def test_investigate_rejects_without_logs(monkeypatch):
    _patch_happy(monkeypatch, [])
    monkeypatch.setattr(
        agent_routes,
        "log_service",
        SimpleNamespace(get_logs_by_session=lambda sid: []),
    )
    with pytest.raises(ValidationError, match="还没有日志文件"):
        await investigate(InvestigateRequest(session_id="sess-1"), _request())


async def test_investigate_streams_sse_by_session_id(monkeypatch):
    _patch_happy(monkeypatch, [
        {"type": "step_start", "step": 1, "title": "错误定位"},
        {"type": "done", "message_id": "msg-1"},
    ])

    resp = await investigate(InvestigateRequest(session_id="sess-1"), _request())

    assert isinstance(resp, StreamingResponse)
    chunks = [c async for c in resp.body_iterator]
    text = "".join(chunks)
    assert text.startswith("data: ")
    assert '"step_start"' in text
    assert '"done"' in text
    assert text.endswith("\n\n")


async def test_investigate_accepts_log_id(monkeypatch):
    """log_id 入口：复用日志所属会话"""
    used = {}

    _patch_happy(monkeypatch, [{"type": "done", "message_id": "msg-1"}])

    class _RecordingAgent:
        def is_active(self, user_id):
            return False

        def investigate(self, session_id, user_id):
            used["session_id"] = session_id

            async def gen():
                yield {"type": "done", "message_id": "msg-1"}
            return gen()

    monkeypatch.setattr(agent_routes, "agent_service", _RecordingAgent())

    resp = await investigate(InvestigateRequest(log_id="log-9"), _request())

    assert isinstance(resp, StreamingResponse)
    # generate() 是惰性异步生成器，需消费 body_iterator 才会触发
    # agent_service.investigate() 调用并记录 session_id
    _ = [c async for c in resp.body_iterator]
    assert used["session_id"] == "sess-1"   # 来自 fake log_repository
