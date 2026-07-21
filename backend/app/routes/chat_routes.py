"""
Chat 路由定义

处理聊天消息的发送和流式响应。
使用 SSE (Server-Sent Events) 实现流式输出。

分析流程（AI 优先，本地兜底）：
1. 保存用户消息
2. 取日志摘要 + 原始日志片段
3. 预计算本地分析结果（仅作为 AI 不可用时的兜底，不再抢跑 AI）
4. 组装上下文 -> 流式调用 AI
5. AI 在产出前失败 / 空回复 -> 回退本地分析；否则保存 AI 回复

SSE 事件格式：
- data: {"status": "thinking", "message": "正在分析日志..."}
- data: {"content": "片段文本"}
- data: {"done": true, "source": "AI 分析" | "本地分析(兜底)"}
"""

import asyncio as _asyncio
import json
import logging
import re

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.middlewares.error_handler import AIError, ValidationError
from app.models.message import MessageRole
from app.services.ai_service import ai_service
from app.services.context_manager import get_context_manager
from app.services.local_analysis_service import try_local_analysis, feed_known_pattern
from app.services.log_service import log_service
from app.services.message_service import message_service
from app.types.message_types import SendMessageRequest
from app.utils.auth import require_session_owner as _require_session_owner

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("")
async def send_message(body: SendMessageRequest, request: Request):
    """
    发送消息并获取 AI 流式回复

    流程：
    1. 保存用户消息到数据库
    2. 获取会话关联的日志摘要
    3. 获取历史消息
    4. 组装上下文（含自动压缩）
    5. 流式调用 AI 并返回 SSE
    6. 完整回复保存到数据库
    """
    if not body.content.strip():
        raise ValidationError("消息内容不能为空")

    # 归属校验：只能向自己拥有的会话发消息
    _require_session_owner(body.session_id, request.state.user)

    # 1. 保存用户消息
    message_service.create_message(
        session_id=body.session_id,
        role=MessageRole.USER,
        content=body.content,
    )

    # 2. 获取日志摘要
    log_summary = log_service.get_logs_summary_for_session(body.session_id)

    # 提取原始日志内容（用于本地模式匹配）
    log_snippet = ""
    try:
        from app.repositories.log_repository import log_repository
        logs = log_repository.get_by_session(body.session_id)
        if logs:
            log_snippet = "\n".join(l.content[:500] for l in logs[:3] if l.content)
    except Exception:
        pass

    # 3. 预计算本地分析结果（仅作为 AI 不可用时的兜底，不再抢跑 AI）
    local_result, _ = try_local_analysis(body.content, log_snippet)
    if local_result:
        logger.debug("本地分析已备选结果，AI 失败时兜底")

    # 3.5 提取会话标题（首条消息）
    # 依赖 log_snippet（步骤 2）和 local_result（步骤 3），必须置于二者之后；
    # 此前该块在这两个变量定义之前执行，必然抛 NameError 被 except 吞掉，标题永不更新。
    try:
        from app.services.session_service import session_service as _ss
        sess = _ss.get_session(body.session_id)
        if sess and sess.title in ("新对话", ""):
            title = ""
            # 本地分析有备选结果时用故障类型做标题
            if local_result:
                fault_match = re.search(r'### \d+\. (.+)', local_result)
                if fault_match:
                    title = fault_match.group(1)
            if not title:
                # fallback：取日志/消息中的关键故障词
                combined = f"{body.content} {log_snippet}"
                key_patterns = [
                    r'PCIe链路降宽', r'PCIe链路降速', r'HBA.*超时', r'SAS链路错误',
                    r'内存故障', r'CPU过热', r'SMART异常', r'网卡.*故障',
                    r'电源.*故障', r'风扇故障',
                ]
                for p in key_patterns:
                    m = re.search(p, combined, re.IGNORECASE)
                    if m:
                        title = m.group(0)
                        break
            if not title:
                title = body.content.strip().replace("\n", " ")[:20]
            if title:
                _ss.update_title(body.session_id, f"确认中 - {title}")
    except Exception as e:
        logger.debug(f"标题提取失败: {e}")

    # 4. 智能知识反哺：搜索知识库注入历史案例
    knowledge_context = ""
    refs = []
    try:
        from app.services.knowledge_feedback import knowledge_feedback
        from app.services.obsidian_service import obsidian_service
        knowledge_context, refs = await knowledge_feedback.search_and_inject(
            body.content, obsidian_service
        )
    except Exception as e:
        logger.debug(f"知识反哺跳过: {e}")

    # 合并日志摘要和知识反哺
    full_context = log_summary or ""
    if knowledge_context:
        full_context = (full_context + "\n\n" + knowledge_context).strip()

    # 5. 获取历史消息
    recent = message_service.get_recent_messages(body.session_id, limit=31)
    history = recent[:-1]

    # 6. 组装上下文
    context_manager = get_context_manager()

    # 7. 流式返回
    async def generate():
        full_response = ""

        # 参考案例（RAG 命中），在内容流之前发给前端展示
        if refs:
            yield _sse_event({"refs": refs})

        # 本地兜底：流式输出 local_result 并累积到 full_response
        async def _emit_local(reason: str):
            nonlocal full_response
            yield _sse_event({"status": "thinking", "message": reason})
            for char in local_result:
                full_response += char
                yield _sse_event({"content": char})
                if char in "\n":
                    await _asyncio.sleep(0.005)
                else:
                    await _asyncio.sleep(0.0005)

        def _save_and_feed():
            message_service.create_message(
                session_id=body.session_id,
                role=MessageRole.ASSISTANT,
                content=full_response,
            )
            try:
                feed_known_pattern(log_snippet, body.session_id)
            except Exception:
                pass

        try:
            # ── AI 优先：先调 AI，AI 在产出前失败/空回复才回退本地 ──
            yield _sse_event({
                "status": "thinking",
                "message": "正在调用 AI 分析...",
            })

            messages = await context_manager.build_messages(
                log_summary=full_context,
                history=history,
                current_query=body.content,
            )

            yield _sse_event({
                "status": "thinking",
                "message": "🤖 AI 正在生成分析结果...",
            })

            ai_tag = "\n> 🤖 以下为 AI 分析结果\n\n"
            stream = ai_service.chat_stream(messages)
            got_content = False
            try:
                async for chunk in stream:
                    if not got_content:
                        # 首个真实 chunk：先发 AI 标记，再发内容
                        full_response += ai_tag
                        yield _sse_event({"content": ai_tag})
                        got_content = True
                    full_response += chunk
                    yield _sse_event({"content": chunk})
            except Exception as ai_err:
                logger.warning(f"AI 流式调用失败: {ai_err}")
                try:
                    await stream.aclose()
                except Exception:
                    pass
                # AI 在产出任何内容前失败 -> 本地兜底
                if not got_content and local_result:
                    async for ev in _emit_local("🖥️ AI 不可用，使用本地分析兜底..."):
                        yield ev
                    _save_and_feed()
                    yield _sse_event({
                        "done": True, "source": "本地分析(兜底)",
                        "session_title": _get_session_title(body.session_id),
                    })
                    return
                # 已产出部分内容（无法干净回退）或无本地结果 -> 报错
                raise AIError("AI 调用失败，请检查 AI 配置或稍后重试") from ai_err

            # AI 正常结束但无任何内容 -> 本地兜底
            if not got_content:
                if local_result:
                    async for ev in _emit_local("🖥️ AI 未返回内容，使用本地分析兜底..."):
                        yield ev
                    _save_and_feed()
                    yield _sse_event({
                        "done": True, "source": "本地分析(兜底)",
                        "session_title": _get_session_title(body.session_id),
                    })
                    return
                raise AIError("AI 返回空内容，且本地无匹配结果")

            # AI 成功：保存回复并提取错误模式
            _save_and_feed()

            yield _sse_event({
                "done": True, "source": "AI 分析",
                "session_title": _get_session_title(body.session_id),
            })

        except Exception as e:
            logger.exception(f"流式响应异常: {e}")
            error_msg = "分析服务异常，请稍后重试"
            message_service.create_message(
                session_id=body.session_id,
                role=MessageRole.ASSISTANT,
                content=error_msg,
            )
            yield _sse_event({"error": error_msg})
            yield _sse_event({"done": True})

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


def _get_session_title(session_id: str) -> str:
    try:
        from app.repositories.session_repository import session_repository
        s = session_repository.get_by_id(session_id)
        return s.title if s else ""
    except Exception:
        return ""
