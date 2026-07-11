"""
规则相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class CreateRuleRequest(BaseModel):
    """创建规则请求"""
    name: str
    condition: str
    time_window: str = "5m"
    action: str = "auto_analyze"
