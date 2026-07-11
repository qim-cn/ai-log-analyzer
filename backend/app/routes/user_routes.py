"""
用户管理路由（仅管理员）

GET    /api/users       → 用户列表
POST   /api/users       → 创建用户
DELETE /api/users/:id   → 删除用户
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.repositories.user_repository import user_repository
from app.services.auth_service import auth_service
from app.types.auth_types import CreateUserRequest, UserResponse

router = APIRouter()


def _require_admin(request: Request) -> None:
    """检查当前用户是否是管理员"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")


@router.get("", response_model=dict)
async def list_users(request: Request):
    """获取用户列表（仅管理员）"""
    _require_admin(request)

    users = user_repository.list_all()
    return {
        "code": 0,
        "message": "success",
        "data": {
            "users": [UserResponse(**u.to_safe_dict()) for u in users]
        },
    }


@router.post("", response_model=dict)
async def create_user(request: Request, body: CreateUserRequest):
    """创建用户（仅管理员）"""
    _require_admin(request)

    if not body.username or not body.password:
        raise ValidationError("用户名和密码不能为空")

    if len(body.password) < 6:
        raise ValidationError("密码长度不能少于 6 位")

    # 检查用户名是否已存在
    existing = user_repository.get_by_username(body.username)
    if existing:
        raise ValidationError(f"用户名 {body.username} 已存在")

    # 创建用户
    password_hash = auth_service.hash_password(body.password)
    role = UserRole(body.role) if body.role in ("admin", "user") else UserRole.USER
    user = user_repository.create(
        username=body.username,
        password_hash=password_hash,
        role=role,
    )

    return {
        "code": 0,
        "message": "用户创建成功",
        "data": UserResponse(**user.to_safe_dict()),
    }


@router.delete("/{user_id}", response_model=dict)
async def delete_user(request: Request, user_id: str):
    """删除用户（仅管理员）"""
    _require_admin(request)

    # 不能删除自己
    current_user = request.state.user
    if current_user.id == user_id:
        raise ValidationError("不能删除当前登录的用户")

    # 检查用户是否存在
    user = user_repository.get_by_id(user_id)
    if user is None:
        raise ValidationError("用户不存在")

    user_repository.delete(user_id)
    return {"code": 0, "message": "用户已删除", "data": None}
