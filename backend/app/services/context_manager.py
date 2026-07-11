"""
上下文管理器

实现滑动窗口 + 自动摘要压缩，控制发送给 AI 的 token 数量。
超过 10 轮自动摘要旧消息，日志只注入错误行 + 统计。
"""

import logging
from typing import TYPE_CHECKING

from app.config.settings import settings
from app.models.message import Message, MessageRole

if TYPE_CHECKING:
    from app.services.ai_service import AIService

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是一个专业的服务器硬件诊断助手，专门服务于服务器批量生产工厂的产线维修人员。

## 你的背景
- 用户是服务器产线的维修工程师，在测试过程中发现报错后维修机器
- 日志来自工厂批量生产的服务器，大部分是硬件相关问题
- 少部分是软件/固件/配置问题，需要按工厂测试流程处理

## 你的专业能力
1. **硬件故障识别**：CPU、内存、硬盘、网卡、电源、风扇、主板、BIOS/BMC 等硬件报错
2. **测试流程判断**：识别是硬件故障还是软件/固件问题
3. **错误模式分析**：识别批量性问题 vs 个例
4. **维修建议**：给出具体的维修/更换/升级操作建议

## 回复规范
- 使用中文回答
- 引用具体的日志行时使用代码块
- 先判断是硬件问题还是软件问题
- 给出明确的维修/处理建议"""


def estimate_tokens(text: str) -> int:
    """估算 token 数量（保守估计 3 字符/token）"""
    return len(text) // 3 + 1


class ContextManager:
    """上下文管理器"""

    def __init__(self, ai_service: "AIService"):
        self._ai_service = ai_service

    async def build_messages(
        self,
        log_summary: str,
        history: list[Message],
        current_query: str,
    ) -> list[dict]:
        """
        组装发送给 AI 的 messages 数组

        策略：
        1. system prompt + 日志摘要（只含错误行+统计）
        2. 超过 10 轮自动压缩旧消息
        3. 当前提问
        """
        messages: list[dict] = []

        # 1. 系统提示 + 日志摘要
        system_content = SYSTEM_PROMPT
        if log_summary:
            log_tokens = estimate_tokens(log_summary)
            max_log_tokens = settings.max_context_tokens * 0.4
            if log_tokens > max_log_tokens:
                char_limit = int(max_log_tokens * 3)
                half = char_limit // 2
                log_summary = log_summary[:half] + "\n... (截断) ...\n" + log_summary[-half:]
            system_content += f"\n\n{log_summary}"

        messages.append({"role": "system", "content": system_content})

        # 2. 处理历史消息
        if history:
            compressed = await self._compress_history(history)
            messages.extend(compressed)

        # 3. 当前提问
        messages.append({"role": "user", "content": current_query})

        total_tokens = sum(estimate_tokens(m["content"]) for m in messages)
        logger.info(f"上下文: {len(messages)} 条, 约 {total_tokens}/{settings.max_context_tokens} tokens")

        return messages

    async def _compress_history(self, history: list[Message]) -> list[dict]:
        """
        压缩历史消息

        超过 10 轮（20 条消息）自动压缩旧消息为摘要
        """
        formatted = [
            {"role": msg.role.value, "content": msg.content}
            for msg in history
        ]

        total_tokens = sum(estimate_tokens(m["content"]) for m in formatted)

        # 未超限，直接返回
        if total_tokens <= settings.max_context_tokens * 0.6:
            return formatted

        # 保留最近 10 轮
        keep_count = 20  # 10 轮 × 2 条

        if len(formatted) <= keep_count:
            return self._truncate_long_messages(formatted)

        # 分离旧消息和新消息
        old_messages = formatted[:-keep_count]
        new_messages = formatted[-keep_count:]

        # 压缩旧消息为摘要
        summary = await self._generate_summary(old_messages)
        logger.info(f"压缩 {len(old_messages)} 条 → 1 条摘要")

        result = [{"role": "assistant", "content": f"[历史摘要] {summary}"}]
        result.extend(new_messages)
        return result

    def _truncate_long_messages(self, messages: list[dict]) -> list[dict]:
        """截断单条过长消息"""
        result = []
        max_single = settings.max_context_tokens * 0.3
        for msg in messages:
            if estimate_tokens(msg["content"]) > max_single:
                char_limit = int(max_single * 3)
                half = char_limit // 2
                truncated = msg["content"][:half] + "\n... (截断) ...\n" + msg["content"][-half:]
                result.append({"role": msg["role"], "content": truncated})
            else:
                result.append(msg)
        return result

    async def _generate_summary(self, messages: list[dict]) -> str:
        """生成对话摘要"""
        conversation = "\n".join(
            f"[{m['role']}] {m['content'][:300]}" for m in messages
        )
        if len(conversation) > 8000:
            conversation = conversation[:8000] + "\n..."

        prompt = [
            {"role": "user", "content": f"用 150 字以内总结以下对话要点：\n\n{conversation}"}
        ]

        try:
            return await self._ai_service.chat(prompt, temperature=0.3)
        except Exception as e:
            logger.warning(f"摘要生成失败: {e}")
            return self._fallback_summary(messages)

    def _fallback_summary(self, messages: list[dict]) -> str:
        """降级摘要"""
        user_qs = [m["content"][:100] for m in messages if m["role"] == "user"][:3]
        return f"历史对话 {len(messages)} 条，用户关注: {'; '.join(user_qs)}"


_context_manager: ContextManager | None = None


def get_context_manager() -> ContextManager:
    global _context_manager
    if _context_manager is None:
        from app.services.ai_service import ai_service
        _context_manager = ContextManager(ai_service)
    return _context_manager
