"""
应用配置模块

优先级：环境变量 > SQLite ai_settings 表 > 默认值
"""

import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    """应用配置（单例）"""

    # 数据库
    database_path: str = field(
        default_factory=lambda: os.getenv("DATABASE_PATH", "/data/app.db")
    )

    # AI 配置（默认值，会被 SQLite 运行时配置覆盖）
    ai_base_url: str = field(
        default_factory=lambda: os.getenv("AI_BASE_URL", "https://api.openai.com/v1")
    )
    ai_api_key: str = field(default_factory=lambda: os.getenv("AI_API_KEY", ""))
    ai_model: str = field(default_factory=lambda: os.getenv("AI_MODEL", "gpt-4o"))

    # Ollama 配置
    ollama_base_url: str = field(
        default_factory=lambda: os.getenv(
            "OLLAMA_BASE_URL", "http://host.docker.internal:11434"
        )
    )

    # 嵌入模型配置
    embedding_provider: str = field(
        default_factory=lambda: os.getenv("EMBEDDING_PROVIDER", "openai")
    )
    embedding_model: str = field(
        default_factory=lambda: os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    )
    embedding_base_url: str = field(
        default_factory=lambda: os.getenv("EMBEDDING_BASE_URL", "https://api.openai.com/v1")
    )
    embedding_api_key: str = field(
        default_factory=lambda: os.getenv("EMBEDDING_API_KEY", "")
    )

    # ChromaDB 配置
    chroma_persist_dir: str = field(
        default_factory=lambda: os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
    )

    # 文件限制（最大 50MB）
    max_file_size_mb: int = field(
        default_factory=lambda: int(os.getenv("MAX_FILE_SIZE_MB", "50"))
    )
    max_file_size_bytes: int = field(init=False)

    # 分块处理阈值（超过此大小使用流式分块解析）
    chunk_threshold_mb: int = 10
    chunk_threshold_bytes: int = field(init=False)

    # 每个分块的大小
    chunk_size_bytes: int = 1024 * 1024  # 1MB

    # 上下文限制
    max_context_tokens: int = field(
        default_factory=lambda: int(os.getenv("MAX_CONTEXT_TOKENS", "8000"))
    )

    # CORS 允许的源
    allowed_origins: list[str] = field(
        default_factory=lambda: [
            origin.strip()
            for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
            if origin.strip()
        ]
    )

    # 日志存储路径
    log_storage_path: str = "/data/logs"

    def __post_init__(self):
        self.max_file_size_bytes = self.max_file_size_mb * 1024 * 1024
        self.chunk_threshold_bytes = self.chunk_threshold_mb * 1024 * 1024


# 全局配置实例
settings = Settings()
