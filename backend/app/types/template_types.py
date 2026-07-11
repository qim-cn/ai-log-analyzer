"""
模板相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class CreateTemplateRequest(BaseModel):
    """创建/更新模板请求"""
    name: str
    prompt: str
