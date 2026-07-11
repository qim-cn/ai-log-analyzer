"""
Webhook 相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class CreateWebhookRequest(BaseModel):
    """创建 Webhook 请求"""
    name: str
    type: str = "custom"  # wechat, dingtalk, feishu, custom
    url: str
