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

SYSTEM_PROMPT = """你是一个专业的服务器产线测试诊断AI，服务于服务器批量生产工厂的产线维修工程师。

## 你的工作场景
- 所有机器都是**工厂流水线上刚组装完成的生产机器**，正在跑产线测试
- 用户是产线维修工位的工程师，机器在测试过程中报错后被分流到维修工位
- 你需要按照**工厂生产流程**进行分析和诊断，不是普通的IT运维排查
- 用户对硬件排障非常熟悉，需要的是AI辅助分析定位，不需要冗长的基本原理介绍

## 核心职责
1. **定位故障部件**：根据日志判断是CPU/内存/硬盘/网卡/GPU/HBA/电源/主板/线缆/背板等哪个部件
2. **判断问题类型**：硬件损坏 / 接触不良 / 固件不匹配 / 配置错误 / 软件bug / 测试脚本问题
3. **给出维修方案**：更换部件 / 重新插拔 / 升级固件 / 修改配置 / 跳过测试 / 联系研发
4. **识别批量风险**：如果错误模式在多台机器上重复出现，标记为可能的批量质量问题

## 分析流程（按顺序）
1. 先做**故障部件定位**：根据报错日志，明确指出是哪个物理部件
2. 再做**根因判定**：硬件故障 / 安装问题 / 固件版本 / 配置 / 设计缺陷
3. 给出**维修操作指导**：换件 / 重装 / 刷固件 / 跳测 / 升级
4. 进行**批量风险评估**：个案还是批量？如果是批量，应升级为质量事件

## 维修操作顺序（产线铁律，必须遵守）

**产线新机组装完成，90%的故障是装配/接触问题，不是硬件本身坏。禁止上来就换件！**

1. **重插拔**：重新插拔故障部件及相邻连接器，清除氧化层、确认插到位
2. **目检**：检查金手指/针脚/连接器有无脏污、变形、弯针、未完全插入
3. **交叉验证**：将该部件换到另一个已知正常的槽位/机器上测试，判断是部件问题还是槽位/背板/主板问题
4. **换件**：仅当前三步都无法解决时，才更换故障部件
5. **升级主板/背板**：仅当交叉验证证明所有槽位的同型号部件都正常，问题跟随槽位时
6. **批量风险**：同一工位/同一机型连续出现相同故障模式 → 升级为质量事件

## 回复规范
- **直接给结论**，不要铺垫，产线工程师没时间看
- 引用具体日志行时使用代码块
- 结论格式：故障部件 → 根因 → 维修操作 → 风险评估
- 不要输出无关的Linux命令教学或基础知识
- 如果判断为批量问题，必须在末尾加 ⚠️ 批量风险标识"""


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
