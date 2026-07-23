"""
维修 SOP 自动生成 —— 3 步流水线

1. 知识检索：顺序查 4 个数据源（已解决案例/维修模板/Linux 命令/历史会话）
2. 证据聚合：去重 + 排序 + 截断
3. LLM 合成：流式生成结构化 SOP + 兜底模板
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator

from app.models.message import MessageRole
from app.services.message_service import message_service

logger = logging.getLogger(__name__)

STEP_TIMEOUT = 20       # 单步超时（秒）
TOTAL_TIMEOUT = 60      # 整体超时（秒）

STEPS: list[tuple[int, str, str]] = [
    (1, "知识检索", "_run_knowledge_search"),
    (2, "证据聚合", "_run_aggregation"),
]

EVIDENCE_LIMIT = {
    "resolved_cases": 5,       # 已解决案例最多 5 条
    "repair_templates": 5,     # 维修模板最多 5 条
    "linux_commands": 3,       # Linux 命令最多 3 条
    "history_sessions": 5,     # 历史会话最多 5 条
    "snippet_chars": 200,      # 每条摘要截断
}


class SopService:
    """SOP 生成服务"""

    async def generate_sop(
        self, model: str, fault: str, session_id: str
    ) -> AsyncIterator[dict]:
        """执行 SOP 流水线，逐步 yield SSE 事件 dict"""
        started = time.monotonic()

        # 步骤 1：知识检索（并行 4 源）
        results = {"model": model, "fault": fault}
        if time.monotonic() - started > TOTAL_TIMEOUT:
            yield {"type": "error", "message": "SOP 生成超时"}
            return

        for num, title, step_fn_name in STEPS:
            fn = getattr(self, step_fn_name)
            async for event in self._run_step(num, title, fn, results, started):
                yield event

        # 步骤 3：LLM 合成
        async for event in self._synthesize(results, session_id):
            yield event

    async def _run_step(self, num, title, fn, results, t0) -> AsyncIterator[dict]:
        yield {"type": "step_start", "step": num, "title": title}
        msgs: list[str] = []

        def emit(message: str):
            msgs.append(message)
            # 异步进度：不实时 yield（简化，等步骤完成一次性吐）
            pass

        try:
            await asyncio.wait_for(fn(results, emit, t0), timeout=STEP_TIMEOUT)
            status = "ok"
            summary = msgs[-1] if msgs else "完成"
        except asyncio.TimeoutError:
            status = "failed"
            summary = f"步骤超时（>{STEP_TIMEOUT}s）"
        except Exception as e:
            logger.exception(f"SOP 步骤 {num} 失败: {e}")
            status = "failed"
            summary = f"步骤失败: {str(e)[:80]}"

        for m in msgs:
            yield {"type": "step_progress", "step": num, "message": m}
        yield {"type": "step_done", "step": num, "status": status, "summary": summary}

    async def _run_knowledge_search(self, results, emit, t0):
        """步骤 1：并行检索 4 个数据源"""
        from app.services.obsidian_service import obsidian_service
        from app.services.repair_template_service import repair_template_service
        from app.services.linux_knowledge_service import search_linux_knowledge
        from app.repositories.session_repository import session_repository

        model = results["model"]
        fault = results["fault"]

        # 已解决案例（异步 WebDAV）
        cases = []
        try:
            raw = await obsidian_service.search_notes(f"{model} {fault}")
            cases = [
                {"title": r.get("title", ""), "snippet": (r.get("snippet") or "")[:EVIDENCE_LIMIT["snippet_chars"]]}
                for r in raw[:EVIDENCE_LIMIT["resolved_cases"]]
            ]
        except Exception as e:
            logger.warning(f"知识库检索失败: {e}")
        results["resolved_cases"] = cases

        # 维修模板（同步 SQLite）
        templates = []
        try:
            templates = repair_template_service.list(model=model, limit=EVIDENCE_LIMIT["repair_templates"])
            templates = [{"text": t["text"], "count": t["count"]} for t in templates]
        except Exception as e:
            logger.warning(f"维修模板查询失败: {e}")
        results["repair_templates"] = templates

        # Linux 知识库（同步 SQLite）
        linux = []
        try:
            linux = search_linux_knowledge(fault, limit=EVIDENCE_LIMIT["linux_commands"])
            linux = [{"title": r["title"], "content": r["content"][:EVIDENCE_LIMIT["snippet_chars"]]} for r in linux[:EVIDENCE_LIMIT["linux_commands"]]]
        except Exception as e:
            logger.warning(f"Linux 知识库检索失败: {e}")
        results["linux_commands"] = linux

        # 历史会话（同步 SQLite）
        sessions = []
        try:
            raw_sessions = session_repository.list_all(model=model, limit=20)
            sessions = [
                {"title": s.title, "status": s.status}
                for s in raw_sessions[:EVIDENCE_LIMIT["history_sessions"]]
            ]
        except Exception as e:
            logger.warning(f"历史会话查询失败: {e}")
        results["history_sessions"] = sessions

        parts = []
        if cases: parts.append(f"已解决案例 {len(cases)} 条")
        if templates: parts.append(f"维修模板 {len(templates)} 条")
        if linux: parts.append(f"Linux 命令 {len(linux)} 条")
        if sessions: parts.append(f"历史会话 {len(sessions)} 个")
        emit(f"检索完成：{' / '.join(parts)}" if parts else "未命中任何数据源")

    async def _run_aggregation(self, results, emit, t0):
        """步骤 2：去重 + 排序（维修模板按频次；案例按相关性保持原序）"""
        # 去重：同名模板合并计数
        seen = {}
        deduped = []
        for t in results.get("repair_templates", []):
            key = t["text"]
            if key in seen:
                seen[key]["count"] += t["count"]
            else:
                seen[key] = dict(t)
                deduped.append(seen[key])
        deduped.sort(key=lambda x: -x["count"])
        results["repair_templates"] = deduped[:EVIDENCE_LIMIT["repair_templates"]]

        total = len(results.get("resolved_cases", [])) + len(deduped) + len(results.get("linux_commands", []))
        emit(f"聚合完成：共 {total} 条有效证据")
        # steps 2 实际只有一步聚合逻辑，直接同步完成
        return None  # 直接返回，不走 wait_for

    async def _synthesize(self, results, session_id) -> AsyncIterator[dict]:
        """步骤 3：LLM 流式合成 SOP + 兜底模板"""
        from app.services.ai_service import ai_service

        yield {"type": "step_start", "step": 3, "title": "SOP 合成"}
        messages = self._build_sop_prompt(results)
        full_report = ""
        got_content = False
        stream = None
        try:
            stream = ai_service.chat_stream(messages, temperature=0.3)
            async for chunk in stream:
                if not got_content:
                    got_content = True
                    header = "📋 **维修 SOP**\n\n"
                    full_report += header
                    yield {"type": "report_chunk", "content": header}
                full_report += chunk
                yield {"type": "report_chunk", "content": chunk}
        except Exception as e:
            logger.warning(f"SOP AI 流失败: {e}")
            if stream is not None:
                try:
                    await stream.aclose()
                except Exception:
                    pass
            if got_content:
                note = "\n\n> ⚠️ AI 生成中断，报告不完整"
                full_report += note
                yield {"type": "report_chunk", "content": note}

        if not full_report.strip():
            full_report = self._build_fallback_sop(results)
            yield {"type": "report_chunk", "content": full_report}

        try:
            message = message_service.create_message(
                session_id=session_id,
                role=MessageRole.ASSISTANT,
                content=full_report,
            )
            yield {"type": "step_done", "step": 3, "status": "ok", "summary": "SOP 已生成"}
            yield {"type": "done", "message_id": message.id}
        except Exception as e:
            logger.exception(f"SOP 消息保存失败: {e}")
            yield {"type": "error", "message": "SOP 已生成但保存失败"}
            yield {"type": "done"}

    def _build_sop_prompt(self, results) -> list[dict]:
        """构建 SOP 合成 prompt"""
        sections = [f"## 请求\n机型：{results['model']}\n故障：{results['fault']}\n"]

        if results.get("resolved_cases"):
            lines = ["## 已解决历史案例"]
            for c in results["resolved_cases"]:
                lines.append(f"- {c['title']}: {c['snippet']}")
            sections.append("\n".join(lines))

        if results.get("repair_templates"):
            lines = ["## 维修操作模板（按使用频次）"]
            for t in results["repair_templates"]:
                lines.append(f"- {t['text']}（历史使用 {t['count']} 次）")
            sections.append("\n".join(lines))

        if results.get("linux_commands"):
            lines = ["## Linux 诊断命令参考"]
            for c in results["linux_commands"]:
                lines.append(f"- {c['title']}: `{c['content']}`")
            sections.append("\n".join(lines))

        if results.get("history_sessions"):
            lines = ["## 同机型历史会话"]
            for s in results["history_sessions"]:
                status = "已解决" if s["status"] == "resolved" else "未解决"
                lines.append(f"- {s['title']}（{status}）")
            sections.append("\n".join(lines))

        evidence = "\n\n".join(sections)
        user_content = (
            "基于以上证据生成一份维修 SOP，严格按以下四段结构：\n\n"
            "## 🎯 故障概述\n故障现象和可能影响范围（1-2 句）。\n\n"
            "## 🔍 诊断步骤\n按优先级列出检查命令，每条标注来源（Linux 知识库 / 历史案例）。\n\n"
            "## 🛠️ 维修流程\n按历史成功率排序的维修动作，标注引用案例数和来源。"
            "优先推荐高频使用的维修模板。\n\n"
            "## ⚠️ 注意事项\n常见坑 + 升级条件（单台偶发 vs 批次问题）。\n\n"
            f"{evidence}"
        )
        return [
            {"role": "system", "content": "你是一个服务器产线维修 SOP 编写专家。输出简洁、可执行的操作步骤。"},
            {"role": "user", "content": user_content},
        ]

    def _build_fallback_sop(self, results) -> str:
        """AI 不可用时的兜底 SOP：直接拼装证据"""
        parts = ["📋 **维修 SOP（本地兜底）**\n"]
        parts.append("## 🎯 故障概述\n")
        parts.append(f"机型 {results['model']}，故障类型 {results['fault']}。\n")

        parts.append("\n## 🔍 诊断步骤\n")
        if results.get("linux_commands"):
            for c in results["linux_commands"]:
                parts.append(f"- `{c['content']}`（{c['title']}）")
        else:
            parts.append("- 无匹配诊断命令，请根据经验排查")

        parts.append("\n## 🛠️ 维修流程\n")
        if results.get("repair_templates"):
            for t in results["repair_templates"]:
                parts.append(f"- {t['text']}（历史使用 {t['count']} 次）")
        if results.get("resolved_cases"):
            for c in results["resolved_cases"]:
                parts.append(f"- {c['title']}")

        parts.append("\n## ⚠️ 注意事项\n")
        if results.get("history_sessions"):
            resolved_count = sum(1 for s in results["history_sessions"] if s["status"] == "resolved")
            parts.append(f"- 同机型历史 {len(results['history_sessions'])} 个会话，其中 {resolved_count} 个已解决")
        parts.append("- 如维修后仍复现，请升级 WWWTE")
        return "\n".join(parts)


sop_service = SopService()
