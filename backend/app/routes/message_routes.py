"""
Message 路由定义
"""

from fastapi import APIRouter, Request

from app.services.message_service import message_service
from app.utils.auth import require_session_owner as _require_session_owner
from app.types.message_types import MessageListResponse, MessageResponse

router = APIRouter()


@router.get("/{session_id}", response_model=dict)
async def list_messages(session_id: str, request: Request):
    """获取会话下的历史消息"""
    _require_session_owner(session_id, request.state.user)
    messages = message_service.get_messages(session_id)
    return {
        "code": 0,
        "message": "success",
        "data": MessageListResponse(
            messages=[
                MessageResponse(
                    id=m.id,
                    session_id=m.session_id,
                    role=m.role.value,
                    content=m.content,
                    created_at=m.created_at,
                )
                for m in messages
            ]
        ),
    }
