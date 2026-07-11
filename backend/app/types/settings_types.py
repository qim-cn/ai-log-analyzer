"""
Settings 相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class AISettingsResponse(BaseModel):
    """AI 配置响应"""
    base_url: str
    api_key_set: bool  # 不返回真实 key，只返回是否已设置
    model: str
    ollama_base_url: str


class UpdateAISettingsRequest(BaseModel):
    """更新 AI 配置请求"""
    provider: str  # "openai" 或 "ollama"
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None


class ModelsResponse(BaseModel):
    """可用模型列表响应"""
    openai_models: list[str]
    ollama_models: list[str]


class EmbeddingSettingsResponse(BaseModel):
    """嵌入模型配置响应"""
    provider: str  # "openai" / "deepseek" / "ollama"
    model: str
    base_url: str
    api_key_set: bool


class UpdateEmbeddingSettingsRequest(BaseModel):
    """更新嵌入模型配置请求"""
    provider: str | None = None
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
