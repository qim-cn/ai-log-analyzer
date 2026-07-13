"""
认证相关的 Pydantic 类型定义
"""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """登录请求"""
    username: str = Field(..., min_length=1, max_length=50, description="用户名")
    password: str = Field(..., min_length=1, max_length=100, description="密码")


class SetupRequest(BaseModel):
    """首次设置管理员请求"""
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=6, max_length=100)


class ResetPasswordRequest(BaseModel):
    """重置密码请求（管理员）"""
    user_id: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6, max_length=100)



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
