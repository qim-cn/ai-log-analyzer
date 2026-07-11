"""
Message 相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class SendMessageRequest(BaseModel):
    """发送消息请求"""
    session_id: str
    content: str


class MessageResponse(BaseModel):
    """消息响应"""
    id: str
    session_id: str
    role: str
    content: str
    created_at: str


class MessageListResponse(BaseModel):
    """消息列表响应"""
    messages: list[MessageResponse]
