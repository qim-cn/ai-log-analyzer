"""
AI Agent 自主排查 —— 排查流水线步骤

每个步骤是一个 async 函数：接收 InvestigationContext 和 emit 回调，
把发现的证据写回 context，返回 StepResult。
步骤之间只通过 context 传递证据，互不依赖内部实现；
重依赖（chromadb / obsidian）在步骤函数内懒加载。
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

from app.models.log_file import LogFile
from app.services.error_cluster_service import error_cluster_service
from app.services.log_service import log_service

logger = logging.getLogger(__name__)

# 证据截断上限（控制发给 LLM 的 token）
SIMILAR_CASES_LIMIT = 5
SIMILAR_PREVIEW_CHARS = 500
KNOWLEDGE_REFS_LIMIT = 3
REPAIR_TEMPLATES_LIMIT = 5
BATCH_SESSIONS_LIMIT = 20
HISTORY_CHARS = 1500

Emit = Callable[[str], None]

# log_service.get_log_content 在内容不可用时的兜底占位串（与 log_service 保持一致，
# 视为"无内容"，否则占位串会被当成真实日志参与聚类）
UNAVAILABLE_PLACEHOLDER = "(文件内容不可用)"


@dataclass
class StepResult:
    """单个步骤的执行结果"""
    status: str            # "ok" | "failed" | "skipped"
    summary: str           # 一行中文摘要（step_done 事件用）
    error: str | None = None


@dataclass
class InvestigationContext:
    """排查上下文：输入 + 各步骤产出的证据"""
    session_id: str
    logs: list[LogFile]
    session_model: str | None = None
    history_text: str = ""
    # 步骤 1 产出
    error_clusters: dict = field(default_factory=dict)
    top_patterns: list[str] = field(default_factory=list)
    # 步骤 2 产出
    similar_cases: list[dict] = field(default_factory=list)
    # 步骤 3 产出
    batch_result: dict = field(default_factory=dict)
    # 步骤 4 产出
    knowledge_refs: list[dict] = field(default_factory=list)
    repair_templates: list[dict] = field(default_factory=list)


async def run_error_extraction(ctx: InvestigationContext, emit: Emit) -> StepResult:
    """步骤 1：错误定位 —— 提取错误行并聚类，产出错误签名（top_patterns）"""
    contents = []
    for lf in ctx.logs[:5]:
        content = log_service.get_log_content(lf, max_chars=50000)
        if content and content.strip() != UNAVAILABLE_PLACEHOLDER:
            contents.append(content)
    merged = "\n".join(contents)[:100000]
    if not merged.strip():
        return StepResult(status="failed", summary="日志内容不可用", error="empty content")

    result = error_cluster_service.cluster_errors(merged, limit=10)
    ctx.error_clusters = result
    ctx.top_patterns = [c["pattern"] for c in result["clusters"][:3]]

    total = result["total_error_lines"]
    n_clusters = len(result["clusters"])
    emit(f"共 {total} 行错误，归并为 {n_clusters} 个错误模式")
    for c in result["clusters"][:3]:
        emit(f"TOP 模式：{c['pattern'][:80]}（{c['count']} 次）")
    if total == 0:
        return StepResult(status="ok", summary="未发现错误行，将生成日志概况报告")
    return StepResult(status="ok", summary=f"{total} 行错误 / {n_clusters} 个模式")


async def run_similar_cases(ctx: InvestigationContext, emit: Emit) -> StepResult:
    """步骤 2：相似案例检索 —— 全局向量库找相似历史日志"""
    if not ctx.top_patterns:
        return StepResult(status="skipped", summary="无错误模式，跳过相似案例检索")

    from app.services.vector_store import vector_store  # 懒加载（chromadb 重）

    query = "\n".join(ctx.top_patterns)
    exclude_id = ctx.logs[0].id if ctx.logs else None
    results = await vector_store.search_similar(
        query, limit=SIMILAR_CASES_LIMIT, exclude_id=exclude_id
    )

    ctx.similar_cases = [
        {
            "log_id": r["log_id"],
            "similarity": r["similarity"],
            "preview": (r.get("preview") or "")[:SIMILAR_PREVIEW_CHARS],
        }
        for r in results[:SIMILAR_CASES_LIMIT]
    ]

    if not ctx.similar_cases:
        emit("向量库中没有相似历史日志")
        return StepResult(status="ok", summary="无相似历史案例")

    top = ctx.similar_cases[0]["similarity"]
    emit(f"找到 {len(ctx.similar_cases)} 个相似案例，最高相似度 {top:.2f}")
    return StepResult(
        status="ok",
        summary=f"{len(ctx.similar_cases)} 个相似案例（最高 {top:.2f}）",
    )


async def run_batch_pattern(ctx: InvestigationContext, emit: Emit) -> StepResult:
    """步骤 3：同批次模式检测 —— 同机型其他机器是否出现相同失败模式

    产线逻辑（对齐 system prompt）：单台故障优先硬件/装配/配置；
    同机型多台出现完全相同模式 → 疑似 testcode/批次问题，建议升级 WWWTE。
    """
    if not ctx.session_model:
        return StepResult(status="skipped", summary="会话未设置机型，跳过批次检测")
    if not ctx.top_patterns:
        return StepResult(status="skipped", summary="无错误模式，跳过批次检测")

    from app.repositories.log_repository import log_repository
    from app.repositories.session_repository import session_repository
    from app.services.error_cluster_service import is_error_line, normalize_line

    target = set(ctx.top_patterns)
    sessions = session_repository.list_all(model=ctx.session_model, limit=50)
    others = [s for s in sessions if s.id != ctx.session_id][:BATCH_SESSIONS_LIMIT]

    matched_machines: list[str] = []
    for i, s in enumerate(others, 1):
        hit = False
        for lf in log_repository.get_by_session(s.id):
            content = log_service.get_log_content(lf, max_chars=50000)
            patterns_in_log = {
                normalize_line(line)
                for line in content.split("\n")
                if line.strip() and is_error_line(line)
            }
            if patterns_in_log & target:
                hit = True
                break
        if hit:
            matched_machines.append(s.sn or s.title or s.id[:8])
        if i % 5 == 0:
            emit(f"已检查 {i}/{len(others)} 个同机型会话...")

    ctx.batch_result = {
        "model": ctx.session_model,
        "checked_sessions": len(others),
        "matched_count": len(matched_machines),
        "matched_machines": matched_machines[:10],
        # 其他机器 ≥1 台相同 → 连本机 ≥2 台，构成"同批次多台相同模式"
        "is_batch": len(matched_machines) >= 1,
    }

    if matched_machines:
        emit(
            f"⚠️ 同机型另有 {len(matched_machines)} 台机器出现相同失败模式："
            f"{', '.join(matched_machines[:5])}"
        )
        return StepResult(
            status="ok",
            summary=f"同批次 {len(matched_machines) + 1} 台相同模式（含本机）",
        )
    emit(f"检查了 {len(others)} 个同机型会话，未发现相同失败模式")
    return StepResult(status="ok", summary=f"单台偶发（检查 {len(others)} 个同机型会话）")


async def run_knowledge_lookup(ctx: InvestigationContext, emit: Emit) -> StepResult:
    """步骤 4：知识库与维修模板 —— 查历史案例 + 匹配维修操作模板

    两个数据源各自独立容错：一个失败不影响另一个，步骤整体不 failed。
    """
    from app.services.knowledge_feedback import knowledge_feedback
    from app.services.obsidian_service import obsidian_service  # 懒加载
    from app.services.repair_template_service import repair_template_service

    # 知识库历史案例（按错误模式检索）
    if ctx.top_patterns:
        try:
            query = " ".join(p[:60] for p in ctx.top_patterns[:2])
            _text, refs = await knowledge_feedback.search_and_inject(
                query, obsidian_service
            )
            ctx.knowledge_refs = [
                {
                    "filename": r.get("filename", ""),
                    "title": r.get("title", ""),
                    "snippet": (r.get("snippet") or "")[:300],
                }
                for r in (refs or [])[:KNOWLEDGE_REFS_LIMIT]
            ]
            if ctx.knowledge_refs:
                emit(f"知识库命中 {len(ctx.knowledge_refs)} 条历史案例")
            else:
                emit("知识库未命中相关案例")
        except Exception as e:
            logger.warning(f"知识库检索失败: {e}")
            ctx.knowledge_refs = []
            emit("知识库检索不可用，已跳过")

    # 维修操作模板（按机型过滤，含通用模板）
    try:
        templates = repair_template_service.list(
            model=ctx.session_model, limit=REPAIR_TEMPLATES_LIMIT
        )
        ctx.repair_templates = [
            {"text": t["text"], "count": t["count"]} for t in templates
        ]
        if ctx.repair_templates:
            emit(f"匹配到 {len(ctx.repair_templates)} 条维修操作模板")
    except Exception as e:
        logger.warning(f"维修模板查询失败: {e}")
        ctx.repair_templates = []
        emit("维修模板查询不可用，已跳过")

    if not ctx.knowledge_refs and not ctx.repair_templates:
        return StepResult(status="ok", summary="知识库与模板均无命中")
    return StepResult(
        status="ok",
        summary=f"知识库 {len(ctx.knowledge_refs)} 条 / 模板 {len(ctx.repair_templates)} 条",
    )


def build_report_prompt(ctx: InvestigationContext) -> list[dict]:
    """步骤 5：汇总证据，构建根因报告 prompt（复用产线 system prompt）"""
    from app.services.context_manager import SYSTEM_PROMPT

    sections: list[str] = []

    # 证据 1：错误聚类
    clusters = ctx.error_clusters.get("clusters", [])
    if clusters:
        lines = [
            "## 证据 1：错误聚类（当前日志）",
            f"共 {ctx.error_clusters.get('total_error_lines', 0)} 行错误，TOP 模式：",
        ]
        for i, c in enumerate(clusters[:5], 1):
            lines.append(f"{i}. {c['pattern'][:120]}（{c['count']} 次，占比 {c['ratio']:.0%}）")
            if c.get("sample"):
                lines.append(f"   样例: {c['sample'][:200]}")
        sections.append("\n".join(lines))
    else:
        sections.append("## 证据 1：错误聚类\n当前日志未发现明显错误行。")

    # 证据 2：相似历史案例
    if ctx.similar_cases:
        lines = ["## 证据 2：相似历史案例（向量检索）"]
        for i, c in enumerate(ctx.similar_cases, 1):
            lines.append(f"{i}. 相似度 {c['similarity']:.2f}：{c['preview']}")
        sections.append("\n".join(lines))

    # 证据 3：同批次模式检测
    if ctx.batch_result:
        b = ctx.batch_result
        lines = [
            "## 证据 3：同批次模式检测",
            f"机型: {b['model']}，检查了 {b['checked_sessions']} 个同机型会话",
        ]
        if b["matched_count"] > 0:
            lines.append(
                f"⚠️ 另有 {b['matched_count']} 台机器出现相同失败模式: "
                f"{', '.join(b['matched_machines'])}"
            )
            lines.append("判定: 同批次多台相同模式（连本机 >=2 台），符合升级 WWWTE 的条件")
        else:
            lines.append("判定: 单台偶发，优先按硬件/装配/本机配置排查")
        sections.append("\n".join(lines))

    # 证据 4：知识库案例与维修模板
    if ctx.knowledge_refs:
        lines = ["## 证据 4a：知识库历史案例"]
        for r in ctx.knowledge_refs:
            lines.append(f"- {r['title'] or r['filename']}: {r['snippet']}")
        sections.append("\n".join(lines))
    if ctx.repair_templates:
        lines = ["## 证据 4b：维修操作模板（按使用频次）"]
        for t in ctx.repair_templates:
            lines.append(f"- {t['text']}（历史使用 {t['count']} 次）")
        sections.append("\n".join(lines))

    # 已有对话上下文（聊天入口触发时）
    if ctx.history_text:
        sections.append(f"## 已有对话上下文（节选）\n{ctx.history_text[:HISTORY_CHARS]}")

    evidence = "\n\n".join(sections)
    user_content = (
        "以下是 Agent 自主排查收集到的结构化证据。请基于证据输出一份完整的根因报告，"
        "严格按以下四段结构（保留 emoji 标题）：\n\n"
        "## 🎯 故障部件定位\n明确指出故障物理部件。\n\n"
        "## 🔍 根因判定\n按证据强弱排序候选根因，每条标注依据来源（错误聚类/相似案例/批次检测/知识库）。\n\n"
        "## 🛠️ 维修动作\n给出工位可执行的动作（换件/重插拔/刷固件/改配置），优先参考命中的维修模板。\n\n"
        "## ⚠️ 是否需升级 WWWTE\n"
        "引用批次检测结论：单台偶发 → 工位解决；同批次多台相同模式 → 建议升级，并列出需收集的反馈信息。\n\n"
        f"{evidence}"
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def build_fallback_report(ctx: InvestigationContext) -> str:
    """AI 不可用时的兜底报告：直接拼装结构化证据（不走 AI）"""
    parts = ["🔬 **自主排查报告（本地兜底模式，AI 不可用）**\n"]

    clusters = ctx.error_clusters.get("clusters", [])
    parts.append("## 🎯 故障部件定位\n")
    if clusters:
        top = clusters[0]
        parts.append(
            f"最高频错误模式：**{top['pattern'][:150]}**"
            f"（{top['count']} 次，占比 {top['ratio']:.0%}）\n"
        )
        parts.append("\n全部错误模式：")
        for c in clusters[:5]:
            parts.append(f"- {c['pattern'][:120]}（{c['count']} 次）")
    else:
        parts.append("当前日志未发现明显错误行。")

    parts.append("\n## 🔍 根因判定（证据汇总）\n")
    if ctx.batch_result:
        b = ctx.batch_result
        if b["matched_count"] > 0:
            parts.append(
                f"- ⚠️ 批次检测：同机型另有 {b['matched_count']} 台出现相同模式"
                f"（{', '.join(b['matched_machines'][:5])}），疑似批次性问题"
            )
        else:
            parts.append(f"- 批次检测：单台偶发（检查 {b['checked_sessions']} 个同机型会话）")
    if ctx.similar_cases:
        parts.append(
            f"- 相似案例：{len(ctx.similar_cases)} 条"
            f"（最高相似度 {ctx.similar_cases[0]['similarity']:.2f}）"
        )
    if ctx.knowledge_refs:
        parts.append("- 知识库命中：")
        for r in ctx.knowledge_refs:
            parts.append(f"  - {r['title'] or r['filename']}")

    parts.append("\n## 🛠️ 维修动作（参考模板）\n")
    if ctx.repair_templates:
        for t in ctx.repair_templates:
            parts.append(f"- {t['text']}（历史使用 {t['count']} 次）")
    else:
        parts.append("暂无维修模板命中，请根据错误模式人工判断。")

    parts.append("\n## ⚠️ 是否需升级 WWWTE\n")
    if ctx.batch_result.get("matched_count", 0) > 0:
        parts.append("同批次多台出现相同失败模式，建议收集本机日志、SN、错误截图反馈 WWWTE。")
    else:
        parts.append("单台偶发，建议在工位完成维修；如维修后仍复现再升级。")
    return "\n".join(parts)
