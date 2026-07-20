"""
SessionService 自动命名（generate_auto_title）单元测试

AI 调用和数据库访问全部 mock 掉，只验证编排逻辑。
"""

import asyncio

import pytest

from app.models.message import Message, MessageRole
from app.models.session import Session
from app.repositories.message_repository import message_repository
from app.repositories.session_repository import session_repository
from app.services.ai_service import ai_service
from app.services.session_service import (
    SessionService,
    build_title_prompt,
    clean_generated_title,
)


def _session(title: str = "新对话") -> Session:
    return Session(
        id="s1",
        title=title,
        created_at="2024-01-15T10:00:00",
        updated_at="2024-01-15T10:00:00",
        user_id="u1",
    )


def _message(role: MessageRole, content: str) -> Message:
    return Message(
        id="m1",
        session_id="s1",
        role=role,
        content=content,
        created_at="2024-01-15T10:00:00",
    )


@pytest.fixture
def service():
    return SessionService()


def _patch_common(monkeypatch, messages, session):
    """mock 掉消息查询和会话查询/更新，返回记录 update 调用的列表"""
    updates: list[tuple[str, str]] = []
    monkeypatch.setattr(
        message_repository,
        "get_by_session",
        lambda session_id, limit=100, offset=0: messages,
    )
    monkeypatch.setattr(
        session_repository, "get_by_id", lambda session_id: session
    )
    monkeypatch.setattr(
        session_repository,
        "update_title",
        lambda session_id, title: updates.append((session_id, title)),
    )
    return updates


# ---- 纯函数 ----

def test_build_title_prompt_contains_both_sides():
    prompt = build_title_prompt("nginx 502 怎么办", "可能是上游挂了")
    assert len(prompt) == 1
    assert prompt[0]["role"] == "user"
    assert "nginx 502 怎么办" in prompt[0]["content"]
    assert "可能是上游挂了" in prompt[0]["content"]
    assert "15 字以内" in prompt[0]["content"]


def test_build_title_prompt_truncates_long_content():
    prompt = build_title_prompt("u" * 1000, "a" * 1000)
    assert "u" * 1000 not in prompt[0]["content"]
    assert "u" * 500 in prompt[0]["content"]


def test_clean_generated_title_strips_quotes_and_newlines():
    assert clean_generated_title('"nginx 502 排查"') == "nginx 502 排查"
    assert clean_generated_title("「内存故障排查」\n") == "内存故障排查"
    assert clean_generated_title("标题一\n标题二") == "标题一 标题二"


def test_clean_generated_title_truncates():
    assert len(clean_generated_title("长" * 50)) == 20


def test_clean_generated_title_empty():
    assert clean_generated_title("   ") == ""


# ---- generate_auto_title 编排 ----

def test_auto_title_updates_on_success(monkeypatch, service):
    messages = [
        _message(MessageRole.USER, "nginx 一直 502"),
        _message(MessageRole.ASSISTANT, "上游服务连接被拒绝..."),
    ]
    updates = _patch_common(monkeypatch, messages, _session())

    async def fake_chat(prompt, temperature=0.7):
        return '"nginx 502 排查"'

    monkeypatch.setattr(ai_service, "chat", fake_chat)

    title, updated = asyncio.run(service.generate_auto_title("s1"))
    assert updated
    assert title == "nginx 502 排查"
    assert updates == [("s1", "nginx 502 排查")]


def test_auto_title_silent_when_ai_fails(monkeypatch, service):
    messages = [
        _message(MessageRole.USER, "nginx 一直 502"),
        _message(MessageRole.ASSISTANT, "上游服务连接被拒绝..."),
    ]
    updates = _patch_common(monkeypatch, messages, _session("确认中 - 502"))

    async def failing_chat(prompt, temperature=0.7):
        raise RuntimeError("AI 不可用")

    monkeypatch.setattr(ai_service, "chat", failing_chat)

    title, updated = asyncio.run(service.generate_auto_title("s1"))
    assert not updated
    assert title == "确认中 - 502"  # 保持原标题
    assert updates == []


def test_auto_title_skips_when_no_first_round(monkeypatch, service):
    # 只有用户消息、还没有 AI 回复
    updates = _patch_common(
        monkeypatch, [_message(MessageRole.USER, "你好")], _session()
    )
    title, updated = asyncio.run(service.generate_auto_title("s1"))
    assert not updated
    assert title == "新对话"
    assert updates == []


def test_auto_title_empty_ai_response_keeps_old(monkeypatch, service):
    messages = [
        _message(MessageRole.USER, "q"),
        _message(MessageRole.ASSISTANT, "a"),
    ]
    updates = _patch_common(monkeypatch, messages, _session())

    async def empty_chat(prompt, temperature=0.7):
        return "   "

    monkeypatch.setattr(ai_service, "chat", empty_chat)

    title, updated = asyncio.run(service.generate_auto_title("s1"))
    assert not updated
    assert title == "新对话"
    assert updates == []
