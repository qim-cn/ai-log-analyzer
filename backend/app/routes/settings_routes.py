"""
Settings 路由定义

支持运行时切换 AI 配置，无需重启服务。
"""

from fastapi import APIRouter, Request

from app.config.database import get_connection, mark_user_set, reset_user_settings
from app.config.settings import settings
from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.services.ai_service import ai_service
from app.types.settings_types import (
    AISettingsResponse,
    EmbeddingSettingsResponse,
    ModelsResponse,
    UpdateAISettingsRequest,
    UpdateEmbeddingSettingsRequest,
)

router = APIRouter()


def _require_admin(user) -> None:
    """写配置类操作仅限管理员，防止普通用户篡改 base_url 触发 SSRF / 泄露 API key"""
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")


@router.get("/ai", response_model=dict)
async def get_ai_settings():
    """获取当前 AI 配置"""
    conn = get_connection()
    rows = conn.execute("SELECT key, value FROM ai_settings").fetchall()
    config = {row["key"]: row["value"] for row in rows}

    return {
        "code": 0,
        "message": "success",
        "data": AISettingsResponse(
            base_url=config.get("base_url", settings.ai_base_url),
            api_key_set=bool(config.get("api_key")),
            model=config.get("model", settings.ai_model),
            ollama_base_url=config.get("ollama_base_url", settings.ollama_base_url),
        ),
    }


@router.put("/ai", response_model=dict)
async def update_ai_settings(body: UpdateAISettingsRequest, request: Request):
    """更新 AI 配置（运行时生效，仅管理员）"""
    _require_admin(request.state.user)
    conn = get_connection()

    updated_keys = []

    if body.provider == "ollama":
        # 切换到 Ollama
        ollama_url = body.base_url or settings.ollama_base_url
        conn.execute(
            "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
            ("base_url", ollama_url),
        )
        conn.execute(
            "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
            ("api_key", ""),  # Ollama 不需要 key
        )
        updated_keys.extend(["base_url", "api_key"])
        if body.model:
            conn.execute(
                "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
                ("model", body.model),
            )
            updated_keys.append("model")
    else:
        # 切换到 OpenAI 兼容 API
        if body.base_url:
            conn.execute(
                "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
                ("base_url", body.base_url),
            )
            updated_keys.append("base_url")
        if body.api_key:
            conn.execute(
                "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
                ("api_key", body.api_key),
            )
            updated_keys.append("api_key")
        if body.model:
            conn.execute(
                "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
                ("model", body.model),
            )
            updated_keys.append("model")

    conn.commit()

    # 标记为用户手动设置
    for key in updated_keys:
        mark_user_set(key)

    # 返回更新后的配置
    rows = conn.execute("SELECT key, value FROM ai_settings").fetchall()
    config = {row["key"]: row["value"] for row in rows}

    return {
        "code": 0,
        "message": "配置已更新",
        "data": AISettingsResponse(
            base_url=config.get("base_url", ""),
            api_key_set=bool(config.get("api_key")),
            model=config.get("model", ""),
            ollama_base_url=config.get("ollama_base_url", ""),
        ),
    }


@router.post("/ai/reset", response_model=dict)
async def reset_ai_settings(request: Request):
    """重置 AI 配置为环境变量默认值（仅管理员）"""
    _require_admin(request.state.user)
    reset_user_settings()

    # 返回重置后的配置
    conn = get_connection()
    rows = conn.execute("SELECT key, value FROM ai_settings").fetchall()
    config = {row["key"]: row["value"] for row in rows}

    return {
        "code": 0,
        "message": "配置已重置为环境变量",
        "data": AISettingsResponse(
            base_url=config.get("base_url", ""),
            api_key_set=bool(config.get("api_key")),
            model=config.get("model", ""),
            ollama_base_url=config.get("ollama_base_url", ""),
        ),
    }


@router.get("/models", response_model=dict)
async def list_models():
    """获取可用模型列表（含 Ollama）"""
    # 从环境变量读取预设模型列表
    import os
    env_models = os.getenv("AI_MODELS", "")
    preset_models = [m.strip() for m in env_models.split(",") if m.strip()] if env_models else []

    # 从 API 获取实际可用模型
    models = await ai_service.get_available_models()

    # 合并预设和实际模型
    all_openai = list(set(preset_models + models["openai_models"]))

    return {
        "code": 0,
        "message": "success",
        "data": ModelsResponse(
            openai_models=sorted(all_openai),
            ollama_models=models["ollama_models"],
        ),
    }


@router.put("/model", response_model=dict)
async def switch_model(body: dict, request: Request):
    """
    切换当前使用的模型（运行时生效，仅管理员）

    请求：{"model": "gpt-4o"}
    """
    _require_admin(request.state.user)
    model = body.get("model")
    if not model:
        raise ValidationError("模型名称不能为空")

    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
        ("model", model),
    )
    mark_user_set("model")
    conn.commit()

    return {
        "code": 0,
        "message": f"已切换到模型: {model}",
        "data": {"model": model},
    }


@router.get("/embedding", response_model=dict)
async def get_embedding_settings():
    """获取嵌入模型配置"""
    conn = get_connection()
    keys = ["embedding_provider", "embedding_model", "embedding_base_url", "embedding_api_key"]
    config = {}

    for key in keys:
        row = conn.execute(
            "SELECT value FROM ai_settings WHERE key = ?", (key,)
        ).fetchone()
        config[key] = row["value"] if row else getattr(settings, key, "")

    return {
        "code": 0,
        "message": "success",
        "data": EmbeddingSettingsResponse(
            provider=config.get("embedding_provider", "openai"),
            model=config.get("embedding_model", "text-embedding-3-small"),
            base_url=config.get("embedding_base_url", "https://api.openai.com/v1"),
            api_key_set=bool(config.get("embedding_api_key")),
        ),
    }


@router.put("/embedding", response_model=dict)
async def update_embedding_settings(body: UpdateEmbeddingSettingsRequest, request: Request):
    """更新嵌入模型配置（运行时生效，仅管理员）"""
    _require_admin(request.state.user)
    conn = get_connection()
    updated_keys = []

    if body.provider:
        conn.execute(
            "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
            ("embedding_provider", body.provider),
        )
        updated_keys.append("embedding_provider")

    if body.model:
        conn.execute(
            "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
            ("embedding_model", body.model),
        )
        updated_keys.append("embedding_model")

    if body.base_url:
        conn.execute(
            "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
            ("embedding_base_url", body.base_url),
        )
        updated_keys.append("embedding_base_url")

    if body.api_key:
        conn.execute(
            "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
            ("embedding_api_key", body.api_key),
        )
        updated_keys.append("embedding_api_key")

    conn.commit()

    # 标记为用户手动设置
    for key in updated_keys:
        mark_user_set(key)

    # 返回更新后的配置
    config = {}
    for key in ["embedding_provider", "embedding_model", "embedding_base_url", "embedding_api_key"]:
        row = conn.execute(
            "SELECT value FROM ai_settings WHERE key = ?", (key,)
        ).fetchone()
        config[key] = row["value"] if row else getattr(settings, key, "")

    return {
        "code": 0,
        "message": "嵌入模型配置已更新",
        "data": EmbeddingSettingsResponse(
            provider=config.get("embedding_provider", "openai"),
            model=config.get("embedding_model", "text-embedding-3-small"),
            base_url=config.get("embedding_base_url", "https://api.openai.com/v1"),
            api_key_set=bool(config.get("embedding_api_key")),
        ),
    }
