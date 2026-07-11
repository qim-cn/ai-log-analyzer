"""
Chat 路由定义

处理聊天消息的发送和流式响应。
使用 SSE (Server-Sent Events) 实现流式输出。

SSE 事件格式：
- data: {"status": "thinking", "message": "正在分析日志..."}
- data: {"status": "thinking", "message": "正在组织回复..."}
- data: {"content": "片段文本"}
- data: {"content": "片段文本"}
- ...
- data: {"done": true}
"""

import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.middlewares.error_handler import ValidationError
from app.models.message import MessageRole
from app.services.ai_service import ai_service
from app.services.context_manager import get_context_manager
from app.services.log_service import log_service
from app.services.message_service import message_service
from app.types.message_types import SendMessageRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("")
async def send_message(body: SendMessageRequest):
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

    # 1. 保存用户消息
    message_service.create_message(
        session_id=body.session_id,
        role=MessageRole.USER,
        content=body.content,
    )

    # 2. 获取日志摘要
    log_summary = log_service.get_logs_summary_for_session(body.session_id)

    # 3. 智能知识反哺：搜索知识库注入历史案例
    knowledge_context = ""
    try:
        from app.services.knowledge_feedback import knowledge_feedback
        from app.services.obsidian_service import obsidian_service
        knowledge_context = await knowledge_feedback.search_and_inject(
            body.content, obsidian_service
        )
    except Exception as e:
        logger.debug(f"知识反哺跳过: {e}")

    # 合并日志摘要和知识反哺
    full_context = log_summary
    if knowledge_context:
        full_context = (full_context + "\n\n" + knowledge_context).strip()

    # 4. 获取历史消息
    recent = message_service.get_recent_messages(body.session_id, limit=31)
    history = recent[:-1]

    # 5. 组装上下文
    context_manager = get_context_manager()

    # 5. 流式返回
    async def generate():
        full_response = ""
        try:
            # 思考阶段 1：正在分析日志
            yield _sse_event({
                "status": "thinking",
                "message": "正在分析日志内容..."
            })

            messages = await context_manager.build_messages(
                log_summary=full_context,
                history=history,
                current_query=body.content,
            )

            # 思考阶段 2：正在生成回复
            yield _sse_event({
                "status": "thinking",
                "message": "正在生成分析结果..."
            })

            # 开始流式输出
            async for chunk in ai_service.chat_stream(messages):
                full_response += chunk
                yield _sse_event({"content": chunk})

            # 6. 保存 AI 回复
            if full_response:
                message_service.create_message(
                    session_id=body.session_id,
                    role=MessageRole.ASSISTANT,
                    content=full_response,
                )

            yield _sse_event({"done": True})

        except Exception as e:
            logger.exception(f"流式响应异常: {e}")
            error_msg = f"AI 响应异常: {str(e)}"
            message_service.create_message(
                session_id=body.session_id,
                role=MessageRole.ASSISTANT,
                content=error_msg,
            )
            yield _sse_event({"error": error_msg})

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
