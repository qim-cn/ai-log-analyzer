"""
AI Agent 自主排查路由

POST /api/agent/investigate -- 启动固定流水线排查，SSE 流式返回过程与报告。
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
