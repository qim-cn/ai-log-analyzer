### Task 7: agent_routes + main.py 注册

**Files:**
- Create: `backend/app/routes/agent_routes.py`
- Modify: `backend/app/main.py`（import 区 + include_router 区各加一行）
- Test: `backend/tests/test_agent_routes.py`

**Interfaces:**
- Consumes: `InvestigateRequest`（Task 1）；`agent_service`（Task 6）；`require_session_owner(session_id, user)` / `require_log_owner(log_id, user)`（`app/utils/auth.py`，失败抛 `ValidationError`）；`log_repository.get_by_id(log_id) -> LogFile`；`log_service.get_logs_by_session(session_id) -> list`
- Produces: `POST /api/agent/investigate`（SSE）。鉴权经现有 `AuthMiddleware`，`request.state.user` 有 `id`/`role`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_agent_routes.py`：

```python
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
    assert used["session_id"] == "sess-1"   # 来自 fake log_repository
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routes.agent_routes'`

- [ ] **Step 3: 实现路由并注册**

创建 `backend/app/routes/agent_routes.py`：

```python
"""
AI Agent 自主排查路由

POST /api/agent/investigate —— 启动固定流水线排查，SSE 流式返回过程与报告。
归属校验/限流复用现有中间件；SSE 事件格式与 chat 路由一致。
"""

import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.middlewares.error_handler import ValidationError
from app.repositories.log_repository import log_repository
from app.services.agent_service import agent_service
from app.services.log_service import log_service
from app.types.agent_types import InvestigateRequest
from app.utils.auth import require_log_owner, require_session_owner

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/investigate")
async def investigate(body: InvestigateRequest, request: Request):
    """
    启动自主排查

    Body 二选一：
    - session_id：对指定会话排查（聊天中"深入调查"入口）
    - log_id：对该日志所属会话排查（上传后"深度排查"入口）
    """
    user = request.state.user

    if not body.session_id and not body.log_id:
        raise ValidationError("session_id 与 log_id 必须提供一个")

    if body.session_id:
        require_session_owner(body.session_id, user)
        session_id = body.session_id
    else:
        require_log_owner(body.log_id, user)
        lf = log_repository.get_by_id(body.log_id)
        session_id = lf.session_id

    if not log_service.get_logs_by_session(session_id):
        raise ValidationError("该会话还没有日志文件，请先上传日志")

    if agent_service.is_active(user.id):
        raise ValidationError("已有排查进行中，请稍后再试")

    async def generate():
        try:
            async for event in agent_service.investigate(session_id, user.id):
                yield _sse_event(event)
        except Exception as e:
            logger.exception(f"自主排查异常: {e}")
            yield _sse_event({"type": "error", "message": "排查服务异常，请稍后重试"})
            yield _sse_event({"type": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


def _sse_event(data: dict) -> str:
    """格式化 SSE 事件"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
```

修改 `backend/app/main.py`：在 import 区（`from app.routes.anomaly_routes import ...` 之前，保持字母序）加：

```python
from app.routes.agent_routes import router as agent_router
```

在 include_router 区（`app.include_router(anomaly_router, ...)` 之前）加：

```python
app.include_router(agent_router, prefix="/api/agent", tags=["AI 自主排查"])
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_routes.py -v`
Expected: 5 passed

- [ ] **Step 5: 跑后端全量测试确认无回归**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/ -v`
Expected: 全部通过（含既有测试）

- [ ] **Step 6: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/routes/agent_routes.py backend/app/main.py backend/tests/test_agent_routes.py
git commit -m "feat: 自主排查 SSE 路由与注册"
```

---

