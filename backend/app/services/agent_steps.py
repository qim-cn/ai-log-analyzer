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
