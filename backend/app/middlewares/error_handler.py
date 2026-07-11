"""
全局错误处理中间件
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    """应用自定义异常基类"""

    def __init__(self, message: str, code: int = 500):
        self.message = message
        self.code = code
        super().__init__(message)


class NotFoundError(AppError):
    """资源不存在"""

    def __init__(self, message: str = "资源不存在"):
        super().__init__(message, code=404)


class ValidationError(AppError):
    """参数校验错误"""

    def __init__(self, message: str = "参数校验失败"):
        super().__init__(message, code=400)


class AIError(AppError):
    """AI 调用错误"""

    def __init__(self, message: str = "AI 调用失败"):
        super().__init__(message, code=502)


def register_error_handlers(app: FastAPI) -> None:
    """注册全局错误处理器"""

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.code,
            content={
                "code": exc.code,
                "message": exc.message,
                "data": None,
            },
        )

    @app.exception_handler(Exception)
    async def general_error_handler(request: Request, exc: Exception):
        logger.exception(f"未处理的异常: {exc}")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": "服务器内部错误",
                "data": None,
            },
        )
