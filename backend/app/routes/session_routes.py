"""
Session 路由定义

会话与用户关联，普通用户只能访问自己的会话。
"""

from fastapi import APIRouter, Request

from app.models.user import UserRole
from app.services.session_service import session_service
from app.types.session_types import (
    CreateSessionRequest,
    SessionListResponse,
    SessionResponse,
)

router = APIRouter()


def _to_response(s) -> SessionResponse:
    """Session -> SessionResponse（含机型/SN/状态）"""
    return SessionResponse(
        id=s.id,
        title=s.title,
        created_at=s.created_at,
        updated_at=s.updated_at,
        user_id=s.user_id,
        model=s.model,
        sn=s.sn,
        status=s.status,
    )


@router.post("", response_model=dict)
async def create_session(body: CreateSessionRequest, request: Request):
    """创建新会话（自动关联当前用户，可带机型/SN）"""
    user = request.state.user
    session = session_service.create_session(
        title=body.title, user_id=user.id, model=body.model, sn=body.sn
    )
    return {"code": 0, "message": "success", "data": _to_response(session)}


@router.get("", response_model=dict)
async def list_sessions(
    request: Request,
    limit: int = 100,
    offset: int = 0,
    model: str | None = None,
    status: str | None = None,
    q: str | None = None,
):
    """获取会话列表（普通用户只看自己的，管理员看所有），支持机型/状态/关键字筛选"""
    user = request.state.user
    if user.role == UserRole.ADMIN:
        sessions = session_service.list_sessions(
            limit=limit, offset=offset, model=model, status=status, q=q
        )
    else:
        sessions = session_service.list_sessions_by_user(
            user_id=user.id, limit=limit, offset=offset, model=model, status=status, q=q
        )
    return {
        "code": 0,
        "message": "success",
        "data": SessionListResponse(sessions=[_to_response(s) for s in sessions]),
    }


@router.get("/{session_id}", response_model=dict)
async def get_session(session_id: str, request: Request):
    """获取单个会话"""
    user = request.state.user
    session = session_service.get_session(session_id)

    # 权限检查：普通用户只能访问自己的会话
    if user.role != UserRole.ADMIN and session.user_id != user.id:
        from app.middlewares.error_handler import ValidationError
        raise ValidationError("无权访问此会话")

    return {"code": 0, "message": "success", "data": _to_response(session)}


@router.put("/{session_id}/rename", response_model=dict)
async def rename_session(session_id: str, body: dict, request: Request):
    """重命名会话"""
    user = request.state.user
    session = session_service.get_session(session_id)

    if user.role != UserRole.ADMIN and session.user_id != user.id:
        from app.middlewares.error_handler import ValidationError
        raise ValidationError("无权修改此会话")

    title = body.get("title", "").strip()
    if not title:
        from app.middlewares.error_handler import ValidationError
        raise ValidationError("标题不能为空")

    session_service.update_title(session_id, title)
    return {"code": 0, "message": "重命名成功", "data": None}


@router.delete("/{session_id}", response_model=dict)
async def delete_session(session_id: str, request: Request):
    """删除会话"""
    user = request.state.user
    session = session_service.get_session(session_id)

    if user.role != UserRole.ADMIN and session.user_id != user.id:
        from app.middlewares.error_handler import ValidationError
        raise ValidationError("无权删除此会话")

    session_service.delete_session(session_id)
    return {"code": 0, "message": "删除成功", "data": None}
