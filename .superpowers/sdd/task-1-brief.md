### Task 1: 后端请求类型 + agent_steps 骨架与步骤 1（错误定位）

**Files:**
- Create: `backend/app/types/agent_types.py`
- Create: `backend/app/services/agent_steps.py`
- Test: `backend/tests/test_agent_steps.py`

**Interfaces:**
- Consumes: `log_service.get_log_content(log_file, max_chars=50000) -> str`；`error_cluster_service.cluster_errors(content, limit=10) -> {"total_error_lines": int, "clusters": [{pattern, count, first_seen, last_seen, sample, ratio}]}`；`LogFile` dataclass（`app/models/log_file.py`）
- Produces: `InvestigateRequest(session_id: str|None, log_id: str|None)`；`InvestigationContext` dataclass（字段：`session_id: str`、`logs: list[LogFile]`、`session_model: str|None = None`、`history_text: str = ""`、`error_clusters: dict`、`top_patterns: list[str]`、`similar_cases: list[dict]`、`batch_result: dict`、`knowledge_refs: list[dict]`、`repair_templates: list[dict]`）；`StepResult(status: str, summary: str, error: str|None = None)`；`async run_error_extraction(ctx, emit) -> StepResult`（`emit: Callable[[str], None]`）

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_agent_steps.py`：

```python
"""
agent_steps 排查步骤单元测试
"""

from app.models.log_file import LogFile, LogFileType
from app.services.agent_steps import (
    InvestigationContext,
    run_error_extraction,
)


def _log(log_id: str = "log-1", session_id: str = "sess-1", content: str = "") -> LogFile:
    """构造内存态 LogFile（content 直存，不触 DB/磁盘）"""
    return LogFile(
        id=log_id,
        session_id=session_id,
        filename=f"{log_id}.log",
        file_type=LogFileType.LOG,
        file_size=len(content),
        line_count=content.count("\n") + 1,
        content=content,
        disk_path=None,
        summary=None,
        created_at="2026-07-21T00:00:00Z",
    )


def _ctx(content: str = "", model: str | None = None, history: str = "") -> InvestigationContext:
    return InvestigationContext(
        session_id="sess-1",
        logs=[_log(content=content)],
        session_model=model,
        history_text=history,
    )


def _collector():
    """收集 emit 的进度消息"""
    messages: list[str] = []
    return messages, messages.append


# ---- 步骤 1：错误定位 ----

async def test_error_extraction_clusters_errors():
    content = (
        "2024-01-15 10:30:00 INFO boot\n"
        "2024-01-15 10:30:01 ERROR DIMM A2 training failed\n"
        "2024-01-15 10:30:02 ERROR DIMM A2 training failed\n"
        "2024-01-15 10:30:03 ERROR PCIe link down\n"
    )
    ctx = _ctx(content=content)
    messages, emit = _collector()

    result = await run_error_extraction(ctx, emit)

    assert result.status == "ok"
    assert ctx.error_clusters["total_error_lines"] == 3
    assert len(ctx.top_patterns) >= 1
    assert any("DIMM" in p for p in ctx.top_patterns)
    assert messages  # 有进度消息


async def test_error_extraction_no_error_lines():
    ctx = _ctx(content="2024-01-15 10:30:00 INFO all good\nINFO nothing wrong\n")
    messages, emit = _collector()

    result = await run_error_extraction(ctx, emit)

    assert result.status == "ok"
    assert "未发现错误行" in result.summary
    assert ctx.top_patterns == []


async def test_error_extraction_empty_content_fails():
    ctx = _ctx(content="")
    messages, emit = _collector()

    result = await run_error_extraction(ctx, emit)

    assert result.status == "failed"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.agent_steps'`

- [ ] **Step 3: 实现请求类型 + 步骤骨架 + 步骤 1**

创建 `backend/app/types/agent_types.py`：

```python
"""
Agent 自主排查相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class InvestigateRequest(BaseModel):
    """启动排查请求：session_id 与 log_id 二选一"""
    session_id: str | None = None
    log_id: str | None = None
```

创建 `backend/app/services/agent_steps.py`：

```python
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
        if content:
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v`
Expected: 3 passed

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/types/agent_types.py backend/app/services/agent_steps.py backend/tests/test_agent_steps.py
git commit -m "feat: 自主排查步骤骨架与错误定位步骤"
```

---

