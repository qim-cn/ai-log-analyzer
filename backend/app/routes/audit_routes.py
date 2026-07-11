"""
审计日志路由

GET /api/audit?page=1&limit=50 → 分页查询（管理员专属）
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.services.audit_service import audit_service

router = APIRouter()


@router.get("", response_model=dict)
async def list_audit_logs(
    request: Request,
    page: int = 1,
    limit: int = 50,
    user_id: str = None,
):
    """
    分页查询审计日志（管理员专属）

    Query Params:
        page: 页码（默认 1）
        limit: 每页数量（默认 50）
        user_id: 按用户筛选（可选）
    """
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可查看")

    result = audit_service.list_logs(page=page, limit=limit, user_id=user_id)

    return {
        "code": 0,
        "message": "success",
        "data": result,
    }
