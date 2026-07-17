"""
认证路由

POST /api/auth/login → 登录
POST /api/auth/setup → 首次设置管理员
POST /api/auth/reset-password → 管理员重置密码
GET  /api/auth/me    → 获取当前用户信息
"""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config.settings import settings
from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.repositories.user_repository import user_repository
from app.services.auth_service import auth_service
from app.types.auth_types import LoginRequest, LoginResponse, ResetPasswordRequest, SetupRequest, UserResponse
from app.utils.request import get_client_ip

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/login", response_model=dict)
async def login(request: Request, body: LoginRequest):
    """
    用户登录

    请求：{"username": "xxx", "password": "xxx"}
    响应：{"code": 0, "data": {"user": {...}}}
    token 经 httpOnly cookie 下发（Set-Cookie），不在响应体中出现。
    """
    # 调试日志：记录请求来源和 body 摘要
    client_ip = get_client_ip(request)
    logger.info(f"登录请求 from {client_ip}: username={body.username!r}")

    try:
        result = auth_service.login(body.username, body.password)
    except ValueError as e:
        # 记录登录失败
        from app.services.audit_service import audit_service
        audit_service.log(user_id="unknown", username=body.username, action="login_failed", detail=str(e))
        raise ValidationError(str(e))

    # 记录登录成功
    from app.services.audit_service import audit_service
    audit_service.log(user_id=result.user.id, username=result.user.username, action="login")

    # token 通过 httpOnly cookie 下发，不再放入响应体（防 XSS 读取 localStorage）
    response = JSONResponse(
        status_code=200,
        content={
            "code": 0,
            "message": "登录成功",
            "data": LoginResponse(
                user=UserResponse(**result.user.to_safe_dict()),
            ).model_dump(),
        },
    )
    response.set_cookie(
        key="token",
        value=result.token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return response


@router.post("/logout", response_model=dict)
async def logout():
    """
    登出：清除 token cookie

    无需鉴权即可调用（cookie 已过期时也能清除）。
    """
    response = JSONResponse(
        status_code=200,
        content={"code": 0, "message": "已登出", "data": None},
    )
    response.delete_cookie(key="token", path="/")
    return response


@router.get("/setup")
async def get_setup_status():
    """
    检查是否需要首次设置管理员

    返回：{ "needsSetup": true | false }
    """
    count = user_repository.count()
    return {
        "code": 0,
        "message": "ok",
        "data": {"needsSetup": count == 0},
    }


@router.post("/setup", response_model=dict)
async def setup(request: Request, body: SetupRequest):
    """
    首次安装：创建第一个管理员账号

    仅当用户表为空时才允许调用。
    """
    client_ip = get_client_ip(request)
    logger.info(f"首次设置管理员请求 from {client_ip}: username={body.username!r}")

    if user_repository.count() > 0:
        raise ValidationError("管理员账号已存在，请通过登录页面访问")

    password_hash = auth_service.hash_password(body.password)
    user = user_repository.create(
        username=body.username,
        password_hash=password_hash,
        role=UserRole.ADMIN,
    )

    from app.services.audit_service import audit_service
    audit_service.log(user_id=user.id, username=user.username, action="setup_admin")

    return {
        "code": 0,
        "message": "管理员账号创建成功",
        "data": UserResponse(**user.to_safe_dict()),
    }


@router.post("/reset-password", response_model=dict)
async def reset_password(request: Request, body: ResetPasswordRequest):
    """
    管理员重置任意用户密码
    """
    current_user = request.state.user
    if current_user.role != UserRole.ADMIN:
        raise ValidationError("仅管理员可重置密码")

    password_hash = auth_service.hash_password(body.new_password)
    ok = user_repository.update_password(body.user_id, password_hash)
    if not ok:
        raise ValidationError("用户不存在")

    return {
        "code": 0,
        "message": "密码重置成功",
        "data": None,
    }


@router.get("/me", response_model=dict)
async def get_me(request: Request):
    """
    获取当前用户信息

    需要 Authorization: Bearer <token>
    """
    user = request.state.user
    return {
        "code": 0,
        "message": "success",
        "data": UserResponse(**user.to_safe_dict()),
    }
