"""
维修 SOP 生成路由

POST /api/sop/generate —— 输入机型号 + 故障描述，SSE 流式返回标准维修 SOP。
"""

import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.middlewares.error_handler import ValidationError
from app.services.sop_service import sop_service

logger = logging.getLogger(__name__)

router = APIRouter()


class GenerateSopRequest(BaseModel):
    model: str
    fault: str


@router.post("/generate")
async def generate_sop(body: GenerateSopRequest, request: Request):
    if not body.model.strip() or not body.fault.strip():
        raise ValidationError("机型号和故障描述都不能为空")

    user_id = request.state.user.id

    async def generate():
        try:
            async for event in sop_service.generate_sop(
                model=body.model.strip(),
                fault=body.fault.strip(),
                session_id=None,  # SOP 不绑定会话
            ):
                yield _sse_event(event)
        except Exception as e:
            logger.exception(f"SOP 生成异常: {e}")
            yield _sse_event({"type": "error", "message": "SOP 生成服务异常，请稍后重试"})
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
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
