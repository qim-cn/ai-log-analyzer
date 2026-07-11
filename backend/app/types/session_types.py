"""
Session 相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class CreateSessionRequest(BaseModel):
    """创建会话请求"""
    title: str | None = None


class SessionResponse(BaseModel):
    """会话响应"""
    id: str
    title: str
    created_at: str
    updated_at: str


class SessionListResponse(BaseModel):
    """会话列表响应"""
    sessions: list[SessionResponse]
