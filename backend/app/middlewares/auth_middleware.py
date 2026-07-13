"""
JWT 认证中间件

拦截所有 /api/* 请求（除 /api/auth/login），验证 JWT token。
"""

import logging
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.services.auth_service import auth_service

logger = logging.getLogger(__name__)

# 不需要认证的路径
PUBLIC_PATHS = {
    "/api/auth/login",
    "/api/auth/setup",
    "/api/health",
    "/metrics",
}


class AuthMiddleware(BaseHTTPMiddleware):
    """JWT 认证中间件"""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        # 公开路径不需要认证
        if path in PUBLIC_PATHS:
            return await call_next(request)

        # OPTIONS 请求不需要认证
        if request.method == "OPTIONS":
            return await call_next(request)

        # 非 API 路径不需要认证
        if not path.startswith("/api/"):
            return await call_next(request)

        # 获取 Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return JSONResponse(
                status_code=401,
                content={"code": 401, "message": "未登录", "data": None},
            )

        # 解析 Bearer token
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"code": 401, "message": "无效的认证格式", "data": None},
            )

        token = auth_header[7:]  # 去掉 "Bearer "

        # 验证 token
        user = auth_service.get_user_from_token(token)
        if user is None:
            return JSONResponse(
                status_code=401,
                content={"code": 401, "message": "登录已过期，请重新登录", "data": None},
            )

        # 将用户信息存入 request.state
        request.state.user = user

        return await call_next(request)
