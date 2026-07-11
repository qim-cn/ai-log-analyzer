"""
Embedding Service - 生成文本嵌入向量

统一接口，支持 OpenAI、DeepSeek、Ollama 三种后端。
配置优先级：SQLite ai_settings > 环境变量 > 默认值
"""

import logging
from typing import List

import httpx

from app.config.database import get_connection
from app.config.settings import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """嵌入向量生成服务"""

    def __init__(self, backend: str = "openai", api_key: str = None, base_url: str = None):
        self.backend = backend
        self.api_key = api_key
        self.base_url = base_url
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """获取 HTTP 客户端（懒加载）"""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    def _get_config(self) -> dict:
        """从数据库读取嵌入模型配置"""
        conn = get_connection()
        keys = [
            "embedding_provider",
            "embedding_model",
            "embedding_base_url",
            "embedding_api_key",
        ]
        config = {}

        for key in keys:
            row = conn.execute(
                "SELECT value FROM ai_settings WHERE key = ?", (key,)
            ).fetchone()
            config[key] = row["value"] if row else getattr(settings, key, "")

        # 如果数据库中没有 embedding_api_key，尝试使用主 AI 的 api_key
        if not config.get("embedding_api_key"):
            row = conn.execute(
                "SELECT value FROM ai_settings WHERE key = 'api_key'"
            ).fetchone()
            config["embedding_api_key"] = row["value"] if row else settings.ai_api_key

        return config

    async def get_embedding(self, text: str) -> List[float]:
        """
        统一接口，支持多后端

        Args:
            text: 要嵌入的文本

        Returns:
            嵌入向量（浮点数列表）
        """
        config = self._get_config()
        backend = self.backend or config.get("embedding_provider", "openai")

        if backend == "openai":
            return await self._openai_embedding(text, config)
        elif backend == "deepseek":
            return await self._deepseek_embedding(text, config)
        elif backend == "ollama":
            return await self._ollama_embedding(text, config)
        else:
            raise ValueError(f"Unknown backend: {backend}")

    async def get_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        批量生成嵌入，提高效率

        Args:
            texts: 文本列表

        Returns:
            嵌入向量列表
        """
        if not texts:
            return []

        config = self._get_config()
        backend = self.backend or config.get("embedding_provider", "openai")

        if backend == "openai":
            return await self._openai_batch_embedding(texts, config)
        elif backend == "deepseek":
            return await self._deepseek_batch_embedding(texts, config)
        elif backend == "ollama":
            return await self._ollama_batch_embedding(texts, config)
        else:
            raise ValueError(f"Unknown backend: {backend}")

    # ============================================================
    # OpenAI Embedding
    # ============================================================

    async def _openai_embedding(self, text: str, config: dict) -> List[float]:
        """OpenAI 单条嵌入"""
        results = await self._openai_batch_embedding([text], config)
        return results[0]

    async def _openai_batch_embedding(
        self, texts: List[str], config: dict
    ) -> List[List[float]]:
        """OpenAI 批量嵌入"""
        client = await self._get_client()

        base_url = self.base_url or config.get("embedding_base_url", "https://api.openai.com/v1")
        api_key = self.api_key or config.get("embedding_api_key", "")
        model = config.get("embedding_model", "text-embedding-3-small")

        # 确保 base_url 以 /v1 结尾
        if not base_url.endswith("/v1"):
            base_url = f"{base_url.rstrip('/')}/v1"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": model,
            "input": texts,
        }

        response = await client.post(
            f"{base_url}/embeddings",
            json=payload,
            headers=headers,
        )

        if response.status_code != 200:
            error_text = response.text
            logger.error(f"OpenAI Embedding API error: {response.status_code} - {error_text}")
            raise Exception(f"Embedding API error: {response.status_code}")

        data = response.json()

        # 按 index 排序，确保顺序正确
        embeddings_data = sorted(data["data"], key=lambda x: x["index"])
        return [item["embedding"] for item in embeddings_data]

    # ============================================================
    # DeepSeek Embedding
    # ============================================================

    async def _deepseek_embedding(self, text: str, config: dict) -> List[float]:
        """DeepSeek 单条嵌入（使用 OpenAI 兼容接口）"""
        results = await self._deepseek_batch_embedding([text], config)
        return results[0]

    async def _deepseek_batch_embedding(
        self, texts: List[str], config: dict
    ) -> List[List[float]]:
        """DeepSeek 批量嵌入"""
        # DeepSeek 使用 OpenAI 兼容接口，修改 base_url 即可
        deepseek_config = config.copy()
        deepseek_config["embedding_base_url"] = self.base_url or config.get(
            "embedding_base_url", "https://api.deepseek.com/v1"
        )
        return await self._openai_batch_embedding(texts, deepseek_config)

    # ============================================================
    # Ollama Embedding
    # ============================================================

    async def _ollama_embedding(self, text: str, config: dict) -> List[float]:
        """Ollama 单条嵌入"""
        results = await self._ollama_batch_embedding([text], config)
        return results[0]

    async def _ollama_batch_embedding(
        self, texts: List[str], config: dict
    ) -> List[List[float]]:
        """Ollama 批量嵌入"""
        client = await self._get_client()

        base_url = self.base_url or config.get(
            "embedding_base_url", settings.ollama_base_url
        )
        model = config.get("embedding_model", "nomic-embed-text")

        embeddings = []

        # Ollama 不支持批量，需要逐条调用
        for text in texts:
            response = await client.post(
                f"{base_url}/api/embeddings",
                json={
                    "model": model,
                    "prompt": text,
                },
            )

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"Ollama Embedding API error: {response.status_code} - {error_text}")
                raise Exception(f"Ollama Embedding API error: {response.status_code}")

            data = response.json()
            embeddings.append(data["embedding"])

        return embeddings

    async def close(self):
        """关闭 HTTP 客户端"""
        if self._client:
            await self._client.aclose()
            self._client = None


# 全局单例
embedding_service = EmbeddingService()
