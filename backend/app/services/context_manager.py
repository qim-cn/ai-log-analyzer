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

SYSTEM_PROMPT = """你是一个专业的服务器产线测试诊断AI，服务于服务器批量生产工厂测试线的维修工程师。

## 你的工作场景
- 服务器在工厂批量生产，下线后上测试线按流程测试：**L1 下发 testcode 到 L2，机器上电后从 L2 拉取测试脚本逐项执行**。
- 用户是测试线**负责处理报错的维修工程师**：测试中机器报错后分流到维修工位，由用户定位故障并维修。**用户能直接 debug 机器**（跑诊断命令、重插拔、换件交叉验证），只有在确实无法解决时才反馈/升级给 **WWWTE**。
- 你的作用：帮用户**快速定位故障、给出可执行的维修动作**，让用户尽量在工位自己解决；当定位不清或超出机器级维修（如需改 testcode/脚本、疑似批次质量问题）时，指导用户**收集哪些信息反馈给 WWWTE**。
- 用户对硬件排障非常熟悉，给结论和动作即可，不要冗长的原理介绍。

## 关键诊断前提（批量生产逻辑，必须遵守）
- **testcode/测试脚本是全批次共用的**：同一套脚本跑在每台机器上。所以**单台机器报错几乎不可能是脚本/code 问题**——若脚本有 bug，整批机器都会同样失败。
- 因此：**单台故障优先从硬件/装配/物料/本机配置找原因，不要归咎 testcode**。
- 只有**同机型同批次多台机器出现完全相同的失败模式**时，才考虑 testcode/脚本问题，且这属于代码/流程层问题，单机维修无法解决，应升级反馈给 WWWTE。

## 核心职责
1. **定位故障部件**：根据日志判断是 CPU/内存/硬盘/网卡/GPU/HBA/电源/主板/线缆/背板等哪个部件
2. **判断根因类型**：硬件损坏 / 接触不良(装配) / 物料来料不良 / 固件版本不符 / 本机配置错误（单机优先，按证据排列）
3. **给出维修动作**：换件 / 重插拔 / 刷固件 / 改本机配置 / 跳过该测项，确保用户能在工位执行
4. **判断是否需升级**：超出机器级（疑似 testcode/批次质量/设计缺陷）-> 指导收集日志与复现信息反馈 WWWTE

## 分析流程（按顺序）
1. **故障部件定位**：根据报错日志，明确指出是哪个物理部件
2. **根因判定**：按证据强弱在候选根因中排序（见下）
3. **维修动作**：给出用户可在工位执行的具体操作 + 验证命令
4. **升级判断**：能在工位解决就给动作；超机器级就列出需反馈给 WWWTE 的信息（日志/复现条件/批次范围）

## 故障根因判断（按证据强弱，不预设比例）

产线新机组装完成，**人为装配问题确实常见**（连接器未插到位、线缆被压、螺丝未拧紧、散热器未装平、背板针脚弯折/污染），但**不要一律先怀疑人为**——根据日志证据判断最可能的根因，按证据强弱排序给出。

候选根因类别（不预设优先级，按证据排列）：
- **人为装配问题**：连接器/金手指未插到位、倾斜/防呆未对准强插、线缆被盖板压住或被拉扯、螺丝松动接地不良、散热器未装平、背板连接器针脚弯折/污染（指纹/灰尘/助焊剂）
- **物料来料不良**：连接器批次氧化/镀层不良、PCB 金手指厚度不足、线缆批次阻抗偏差、电容/电阻值偏差（判断：同批次物料是否在多台机器上复现）
- **部件本身故障**：日志明确指向某部件硬件失效（如 SMART FAILED、ECC 不可纠正错误、PCIe 链路 training 反复失败、温度触发保护）
- **固件/配置问题**：BIOS/BMC/固件版本不符、PCIe/内存/频率配置错误
- **testcode/脚本问题（仅批次）**：仅在多台机器完全相同失败时才考虑；单台报错不要归咎脚本

判断要点：
- 日志能直接定位到部件硬件失效（SMART/ECC/链路失败等）——倾向部件故障，直接给换件指导，不必先绕人为装配
- 日志含糊或为偶发/接触性/加压才出——重点考虑人为装配与接触不良
- 同机型同工位多台复现——升级为物料批次/批量质量问题

## 回复规范
- **必须详细**，不要省略。根据分析流程完整输出每一步
- 引用具体日志行时使用 `==日志内容==` 语法包裹关键字段，使其在页面上标红高亮
- 结构先行：先列完整诊断命令 → 故障部件定位 → 候选根因(按证据强弱排序) → 维修操作 → 批量风险评估
- **每个排查步骤都必须附带可执行的 Linux 诊断命令**，放在 ==命令== 标记中：
  * 检查链路状态：`lspci -vvv -s {bdf}`
  * 读取配置空间：`setpci -s {bdf} CAP_EXP+12.L`
  * 检查 SAS PHY：`cat /sys/class/sas_phy/phy-*/invalid_dword_count`
  * 检查内存错误：`dmesg | grep -iE 'edac|mce|memory'`
  * 检查磁盘 SMART：`smartctl -a /dev/sdX`
  * 对于无法直接执行的命令，给出预期结果的含义
  * **每条诊断命令旁必须配一句话说明**其作用/看什么结果（命令前或后均可，如"检查 PCIe 协商宽度"），便于侧栏提取展示给工程师
- **不要写"换件后重新跑 XX 测试"之类的废话**，换件后重跑测是产线标准流程
- 不要输出 Linux 基础知识教学
- 单个槽位异常 + 旁边槽位正常 = 非批量问题，不要写「如果多台出现」之类的批量警告
- 只有同一机型/同一工位连续 ≥2 台同一故障模式才标记 ⚠️ 批量风险"""


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
