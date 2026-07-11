"""
AI 调用服务

统一使用 OpenAI 兼容的 /v1/chat/completions 接口。
支持 OpenAI 和 Ollama（相同接口格式）。
所有调用均为异步，使用 httpx AsyncClient。
"""

import json
import logging
import time
from collections.abc import AsyncIterator

import httpx

from app.config.database import get_connection
from app.config.settings import settings
from app.middlewares.error_handler import AIError

logger = logging.getLogger(__name__)

# 默认超时配置
TIMEOUT_STREAM = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
TIMEOUT_NORMAL = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
TIMEOUT_SHORT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)


class AIService:
    """AI 调用服务（全异步）"""

    def _get_runtime_config(self) -> dict:
        """
        从数据库获取运行时配置

        优先级：SQLite ai_settings > 环境变量 > 默认值
        """
        try:
            conn = get_connection()
            rows = conn.execute("SELECT key, value FROM ai_settings").fetchall()
            config = {row["key"]: row["value"] for row in rows}
        except Exception:
            config = {}

        return {
            "base_url": config.get("base_url") or settings.ai_base_url,
            "api_key": config.get("api_key") or settings.ai_api_key,
            "model": config.get("model") or settings.ai_model,
            "ollama_base_url": (
                config.get("ollama_base_url") or settings.ollama_base_url
            ),
        }

    def _build_headers(self, api_key: str) -> dict[str, str]:
        """构建请求头"""
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    async def chat_stream(
        self,
        messages: list[dict],
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """
        流式调用 AI 接口

        使用 httpx AsyncClient 流式读取 SSE 响应，
        逐 chunk yield 文本片段。
        """
        config = self._get_runtime_config()
        base_url = config["base_url"].rstrip("/")
        api_key = config["api_key"]
        model = config["model"]

        headers = self._build_headers(api_key)
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }

        url = f"{base_url}/chat/completions"

        start_time = time.time()
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_STREAM) as client:
                async with client.stream(
                    "POST", url, json=payload, headers=headers
                ) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        error_text = error_body.decode("utf-8", errors="replace")
                        logger.error(
                            f"AI API 错误: {response.status_code} - {error_text}"
                        )
                        raise AIError(
                            f"AI API 返回 {response.status_code}: "
                            f"{error_text[:200]}"
                        )

                    async for line in response.aiter_lines():
                        # SSE 格式：data: {...}
                        if not line.startswith("data: "):
                            continue

                        data = line[6:].strip()
                        if data == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data)
                            choices = chunk.get("choices", [])
                            if not choices:
                                continue

                            delta = choices[0].get("delta", {})
                            content = delta.get("content")
                            if content:
                                yield content

                        except json.JSONDecodeError:
                            logger.debug(f"SSE JSON 解析跳过: {data[:100]}")
                            continue

        except httpx.TimeoutException as e:
            logger.error(f"AI API 超时: {e}")
            raise AIError("AI 调用超时，请稍后重试")
        except httpx.ConnectError as e:
            logger.error(f"AI API 连接失败: {e}")
            raise AIError(f"无法连接到 AI 服务: {base_url}")
        except AIError:
            raise
        except Exception as e:
            logger.exception(f"AI 流式调用异常: {e}")
            raise AIError(f"AI 调用失败: {str(e)}")
        finally:
            # 记录调用统计
            from app.services.stats_service import stats_service
            duration_ms = int((time.time() - start_time) * 1000)
            stats_service.record_call(
                success=True,
                duration_ms=duration_ms,
                model=config["model"],
            )

    async def chat(self, messages: list[dict], temperature: float = 0.7) -> str:
        """
        非流式调用 AI 接口（用于摘要等内部任务）

        Args:
            messages: OpenAI 格式的消息数组
            temperature: 温度参数

        Returns:
            AI 回复的完整文本

        Raises:
            AIError: 调用失败时抛出
        """
        config = self._get_runtime_config()
        base_url = config["base_url"].rstrip("/")
        api_key = config["api_key"]
        model = config["model"]

        headers = self._build_headers(api_key)
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        }

        url = f"{base_url}/chat/completions"
        start_time = time.time()

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_NORMAL) as client:
                response = await client.post(url, json=payload, headers=headers)

                if response.status_code != 200:
                    logger.error(
                        f"AI API 错误: {response.status_code} - {response.text}"
                    )
                    raise AIError(f"AI API 返回 {response.status_code}")

                data = response.json()
                return data["choices"][0]["message"]["content"]

        except httpx.TimeoutException:
            raise AIError("AI 调用超时")
        except httpx.ConnectError:
            raise AIError(f"无法连接到 AI 服务: {base_url}")
        except AIError:
            raise
        except Exception as e:
            logger.exception(f"AI 调用异常: {e}")
            raise AIError(f"AI 调用失败: {str(e)}")
        finally:
            # 记录调用统计
            from app.services.stats_service import stats_service
            duration_ms = int((time.time() - start_time) * 1000)
            stats_service.record_call(
                success=True,
                duration_ms=duration_ms,
                model=model,
            )

    async def get_available_models(self) -> dict[str, list[str]]:
        """
        获取可用模型列表（OpenAI + Ollama）

        Returns:
            {"openai_models": [...], "ollama_models": [...]}
        """
        config = self._get_runtime_config()
        openai_models: list[str] = []
        ollama_models: list[str] = []

        # 获取 OpenAI 兼容模型列表
        try:
            base_url = config["base_url"].rstrip("/")
            api_key = config["api_key"]
            headers = self._build_headers(api_key)

            async with httpx.AsyncClient(timeout=TIMEOUT_SHORT) as client:
                resp = await client.get(f"{base_url}/models", headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    openai_models = [m["id"] for m in data.get("data", [])]
        except Exception as e:
            logger.warning(f"获取 OpenAI 模型列表失败: {e}")

        # 获取 Ollama 模型列表
        try:
            ollama_url = config["ollama_base_url"].rstrip("/")
            async with httpx.AsyncClient(timeout=TIMEOUT_SHORT) as client:
                resp = await client.get(f"{ollama_url}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    ollama_models = [m["name"] for m in data.get("models", [])]
        except Exception as e:
            logger.warning(f"获取 Ollama 模型列表失败: {e}")

        return {
            "openai_models": openai_models,
            "ollama_models": ollama_models,
        }


# 全局实例
ai_service = AIService()
