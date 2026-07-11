"""
认证路由

POST /api/auth/login → 登录
GET  /api/auth/me    → 获取当前用户信息
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.services.auth_service import auth_service
from app.types.auth_types import LoginRequest, LoginResponse, UserResponse

router = APIRouter()


@router.post("/login", response_model=dict)
async def login(body: LoginRequest):
    """
    用户登录

    请求：{"username": "xxx", "password": "xxx"}
    响应：{"code": 0, "data": {"token": "xxx", "user": {...}}}
    """
    if not body.username or not body.password:
        raise ValidationError("用户名和密码不能为空")

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

    return {
        "code": 0,
        "message": "登录成功",
        "data": LoginResponse(
            token=result.token,
            user=UserResponse(**result.user.to_safe_dict()),
        ),
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
