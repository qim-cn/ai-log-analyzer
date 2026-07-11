"""
认证相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class LoginRequest(BaseModel):
    """登录请求"""
    username: str
    password: str


class UserResponse(BaseModel):
    """用户响应"""
    id: str
    username: str
    role: str
    created_at: str


class LoginResponse(BaseModel):
    """登录响应"""
    token: str
    user: UserResponse


class CreateUserRequest(BaseModel):
    """创建用户请求"""
    username: str
    password: str
    role: str = "user"
