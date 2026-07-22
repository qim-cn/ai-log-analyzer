"""
agent_service 流水线 runner 单元测试
"""

import sys
from types import SimpleNamespace

from app.services import agent_service as agent_module
from app.services.agent_service import AgentService
from app.services.agent_steps import InvestigationContext, StepResult


def _ctx() -> InvestigationContext:
    return InvestigationContext(session_id="sess-1", logs=[], session_model="7500S")


def _patch_common(monkeypatch, ai):
    """假上下文构建 + 假 AI + 假消息服务"""
    monkeypatch.setattr(AgentService, "_build_context", lambda self, sid: _ctx())
    monkeypatch.setitem(
        sys.modules, "app.services.ai_service", SimpleNamespace(ai_service=ai)
    )
    saved: list[str] = []
    monkeypatch.setattr(
        agent_module,
        "message_service",
        SimpleNamespace(
            create_message=lambda session_id, role, content: saved.append(content)
            or SimpleNamespace(id="msg-1")
        ),
    )
    return saved


class _OkAI:
    def chat_stream(self, messages, temperature=0.7):
        async def gen():
            yield "## 🎯 故障部件定位\n内存条 A2"
        return gen()


class _FailAI:
    def chat_stream(self, messages, temperature=0.7):
        async def gen():
            raise RuntimeError("AI down")
            yield  # pragma: no cover  # 使其成为 async generator
        return gen()


class _PartialFailAI:
    """先吐一个 chunk 再失败，覆盖'生成中断'路径"""

    def chat_stream(self, messages, temperature=0.7):
        async def gen():
            yield "## 🎯 故障部件定位\n部分内容"
            raise RuntimeError("AI mid-stream down")

        return gen()


async def _ok_step(ctx, emit):
    emit("进度消息")
    return StepResult(status="ok", summary="完成")


async def _boom_step(ctx, emit):
    raise RuntimeError("step exploded")


async def _collect(service: AgentService) -> list[dict]:
    return [e async for e in service.investigate("sess-1", "u1")]


async def test_pipeline_event_sequence(monkeypatch):
    saved = _patch_common(monkeypatch, _OkAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "步骤一", _ok_step), (2, "步骤二", _ok_step)])
    service = AgentService()

    events = await _collect(service)

    types = [e["type"] for e in events]
    # 两个步骤各 start/done 一次，进度消息在 start 之后
    assert types[0] == "step_start"
    assert "step_progress" in types
    assert types.count("step_start") == 3      # 2 个证据步骤 + 报告步骤
    assert types.count("step_done") == 3
    assert "report_chunk" in types
    assert types[-1] == "done"
    # 报告落库为 assistant 消息
    assert saved and "自主排查报告" in saved[0]
    # 并发锁已释放
    assert not service.is_active("u1")


async def test_pipeline_step_failure_isolated(monkeypatch):
    saved = _patch_common(monkeypatch, _OkAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "爆炸步骤", _boom_step), (2, "步骤二", _ok_step)])
    service = AgentService()

    events = await _collect(service)

    failed = [e for e in events if e["type"] == "step_done" and e["status"] == "failed"]
    assert len(failed) == 1 and failed[0]["step"] == 1
    # 后续步骤照常执行
    ok_done = [e for e in events if e["type"] == "step_done" and e["step"] == 2]
    assert ok_done and ok_done[0]["status"] == "ok"
    assert events[-1]["type"] == "done"
    assert not service.is_active("u1")


async def test_pipeline_ai_failure_fallback_report(monkeypatch):
    saved = _patch_common(monkeypatch, _FailAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "步骤一", _ok_step)])
    service = AgentService()

    events = await _collect(service)

    report_text = "".join(e.get("content", "") for e in events if e["type"] == "report_chunk")
    assert "本地兜底" in report_text
    assert events[-1]["type"] == "done"
    assert saved and "本地兜底" in saved[0]
    # AI 失败路径亦须释放并发锁
    assert not service.is_active("u1")


async def test_pipeline_ai_partial_failure_appends_interrupt_note(monkeypatch):
    _patch_common(monkeypatch, _PartialFailAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "步骤一", _ok_step)])
    service = AgentService()

    events = await _collect(service)

    report_text = "".join(e.get("content", "") for e in events if e["type"] == "report_chunk")
    # 已有部分内容时追加"生成中断"提示
    assert "生成中断" in report_text
    # 部分内容被保留
    assert "部分内容" in report_text
    assert events[-1]["type"] == "done"
    # 中断路径同样释放并发锁
    assert not service.is_active("u1")


async def test_pipeline_concurrent_user_rejected(monkeypatch):
    _patch_common(monkeypatch, _OkAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "步骤一", _ok_step)])
    service = AgentService()
    service._active_users.add("u1")

    events = await _collect(service)

    assert events == [{"type": "error", "message": "已有排查进行中，请稍后再试"}]
