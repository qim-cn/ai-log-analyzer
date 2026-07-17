"""
JWT 认证中间件

拦截所有 /api/* 请求（除 /api/auth/login），验证 JWT token。
"""

import logging
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config.settings import settings
from app.services.auth_service import auth_service

logger = logging.getLogger(__name__)

# 不需要认证的路径（前缀匹配）
PUBLIC_PATH_PREFIXES = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/setup",
    "/api/health",
    "/api/knowledge/linux",   # Linux 知识库公开
    "/metrics",
}


class AuthMiddleware(BaseHTTPMiddleware):
    """JWT 认证中间件"""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        # 完全公开路径
        if any(path.startswith(prefix) for prefix in PUBLIC_PATH_PREFIXES):
            return await call_next(request)

        # 公开 GET 端点（无需登录）：仅 Linux 知识库与批量风险评分。
        # Obsidian 相关端点一律需要登录，防止未授权读取知识库 / 路径穿越。
        if request.method == "GET":
            if path.startswith(("/api/knowledge/linux", "/api/knowledge/batch-risk")):
                return await call_next(request)

        # OPTIONS 请求不需要认证
        if request.method == "OPTIONS":
            return await call_next(request)

        # 非 API 路径不需要认证
        if not path.startswith("/api/"):
            return await call_next(request)

        # CSRF 防御（cookie 鉴权下）：非简单方法校验 Origin，作为 SameSite=Lax 之外的纵深防御。
        # 仅在 allowed_origins 显式配置（非 *）时启用，避免影响本地开发。
        if request.method not in ("GET", "OPTIONS", "HEAD"):
            origins = settings.allowed_origins
            if origins and "*" not in origins:
                origin = request.headers.get("origin", "")
                if origin and origin not in origins:
                    return JSONResponse(
                        status_code=403,
                        content={"code": 403, "message": "非法来源请求", "data": None},
                    )

        # 获取 token：优先 httpOnly cookie，兼容 Authorization header（API 客户端/过渡期）
        token = request.cookies.get("token")
        if not token:
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header[7:]
        if not token:
            return JSONResponse(
                status_code=401,
                content={"code": 401, "message": "未登录", "data": None},
            )

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
