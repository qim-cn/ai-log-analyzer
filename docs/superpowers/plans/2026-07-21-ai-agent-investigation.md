# AI Agent 自主排查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ai-log-analyzer 增加 AI Agent 自主排查功能 —— 5 步固定流水线（错误定位→相似案例→批次检测→知识库→根因报告），双入口 SSE 实时流式展示，报告存为会话消息。

**Architecture:** 后端新增 `agent_steps.py`（5 个独立步骤函数，通过 `InvestigationContext` 传递证据）+ `agent_service.py`（流水线 runner，asyncio.Queue 实时转发进度事件）+ `agent_routes.py`（SSE 端点）；前端新增 `agentService.ts` + `investigationStore.ts` + `InvestigationView.tsx`，在 ChatPanel/LogPanel 加入口。全程复用现有服务（向量库、错误聚类、知识库、维修模板、AI 服务）。

**Tech Stack:** FastAPI + asyncio + SSE（后端），React + zustand + tailwind（前端），pytest + pytest-asyncio（测试）。

**Spec:** `docs/superpowers/specs/2026-07-21-ai-agent-investigation-design.md`

## Global Constraints

- Python ≥ 3.11（`str | None` 语法可用）；pytest-asyncio 已配置 `asyncio_mode = "auto"`，async 测试直接写 `async def test_...`
- **不新增任何依赖**（前后端都不加包）
- 后端风格：模块级中文 docstring；重依赖（chromadb、obsidian）用函数级懒加载 import；服务用模块级单例 `xxx_service`
- SSE 事件格式：`data: {json.dumps(data, ensure_ascii=False)}\n\n`；前端统一经 `http.stream` 消费
- 报告必须通过 `message_service.create_message(session_id, MessageRole.ASSISTANT, content)` 存为会话消息
- 证据截断上限：相似案例 Top-5（每条预览 ≤500 字符）、知识库 ≤3 条（snippet ≤300 字符）、维修模板 ≤5 条、对话上下文 ≤1500 字符
- 单步超时 30s，整体超时 180s；每用户同时最多 1 个排查
- 前端无测试框架：验证方式为 `cd frontend && npm run build`（tsc + vite）通过
- 前端样式只用现有 tailwind token：`border-border`、`bg-card`、`text-primary`、`text-success`、`text-warning`、`text-destructive`、`text-muted-foreground`
- git 提交信息：中文，conventional 前缀（`feat:` / `test:` / `docs:`）

---

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

### Task 2: 步骤 2（相似案例检索）

**Files:**
- Modify: `backend/app/services/agent_steps.py`（追加函数）
- Test: `backend/tests/test_agent_steps.py`

**Interfaces:**
- Consumes: `vector_store.search_similar(text, limit, exclude_id) -> list[{log_id, similarity, metadata, preview}]`（async，全局 ChromaDB 单例）；Task 1 的 `InvestigationContext` / `StepResult`
- Produces: `async run_similar_cases(ctx, emit) -> StepResult`；填充 `ctx.similar_cases: list[{log_id, similarity, preview}]`（preview ≤500 字符）

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_agent_steps.py` 末尾追加：

```python
# ---- 步骤 2：相似案例检索 ----

import sys
from types import SimpleNamespace

from app.services.agent_steps import run_similar_cases


class _FakeVectorStore:
    """假向量库：search_similar 返回固定结果"""

    def __init__(self, results):
        self._results = results

    async def search_similar(self, text, limit=5, exclude_id=None):
        return self._results[:limit]


def _patch_vector_store(monkeypatch, results):
    """用 sys.modules 注入假模块，避免真 import chromadb"""
    monkeypatch.setitem(
        sys.modules,
        "app.services.vector_store",
        SimpleNamespace(vector_store=_FakeVectorStore(results)),
    )


async def test_similar_cases_found(monkeypatch):
    _patch_vector_store(monkeypatch, [
        {"log_id": "old-1", "similarity": 0.92, "metadata": {}, "preview": "x" * 600},
        {"log_id": "old-2", "similarity": 0.71, "metadata": {}, "preview": "short"},
    ])
    ctx = _ctx(content="ERROR DIMM A2 training failed\n")
    ctx.top_patterns = ["ERROR DIMM A2 training failed"]
    messages, emit = _collector()

    result = await run_similar_cases(ctx, emit)

    assert result.status == "ok"
    assert len(ctx.similar_cases) == 2
    assert ctx.similar_cases[0]["similarity"] == 0.92
    # 预览截断到 500 字符
    assert len(ctx.similar_cases[0]["preview"]) == 500
    assert any("0.92" in m for m in messages)


async def test_similar_cases_empty(monkeypatch):
    _patch_vector_store(monkeypatch, [])
    ctx = _ctx(content="ERROR x\n")
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_similar_cases(ctx, emit)

    assert result.status == "ok"
    assert ctx.similar_cases == []
    assert "无相似" in result.summary


async def test_similar_cases_skipped_without_patterns():
    ctx = _ctx(content="INFO ok\n")
    ctx.top_patterns = []
    messages, emit = _collector()

    result = await run_similar_cases(ctx, emit)

    assert result.status == "skipped"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v -k similar`
Expected: FAIL — `ImportError: cannot import name 'run_similar_cases'`

- [ ] **Step 3: 实现步骤 2**

在 `backend/app/services/agent_steps.py` 末尾追加：

```python
async def run_similar_cases(ctx: InvestigationContext, emit: Emit) -> StepResult:
    """步骤 2：相似案例检索 —— 全局向量库找相似历史日志"""
    from app.services.vector_store import vector_store  # 懒加载（chromadb 重）

    if not ctx.top_patterns:
        return StepResult(status="skipped", summary="无错误模式，跳过相似案例检索")

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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v`
Expected: 6 passed

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/services/agent_steps.py backend/tests/test_agent_steps.py
git commit -m "feat: 自主排查相似案例检索步骤"
```

---

### Task 3: 步骤 3（同批次模式检测）

**Files:**
- Modify: `backend/app/services/agent_steps.py`（追加函数）
- Test: `backend/tests/test_agent_steps.py`

**Interfaces:**
- Consumes: `session_repository.list_all(model=..., limit=...) -> list[Session]`（`Session` 有 `id/title/model/sn` 字段）；`log_repository.get_by_session(session_id) -> list[LogFile]`；`error_cluster_service` 模块级函数 `is_error_line(line) -> bool`、`normalize_line(line) -> str`；Task 1 的 `log_service.get_log_content`
- Produces: `async run_batch_pattern(ctx, emit) -> StepResult`；填充 `ctx.batch_result: {model, checked_sessions, matched_count, matched_machines: list[str], is_batch: bool}`（`is_batch = matched_count >= 1`，即除本机外另有 ≥1 台相同模式 → 连本机 ≥2 台，符合升级 WWWTE 条件）

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_agent_steps.py` 末尾追加：

```python
# ---- 步骤 3：同批次模式检测 ----

from app.models.session import Session
from app.services.agent_steps import run_batch_pattern


def _session(sid: str, model: str | None, sn: str | None = None) -> Session:
    return Session(
        id=sid,
        title=f"会话-{sid}",
        created_at="2026-07-21T00:00:00Z",
        updated_at="2026-07-21T00:00:00Z",
        user_id="u1",
        model=model,
        sn=sn,
        status="open",
    )


def _patch_batch_repos(monkeypatch, sessions, logs_by_session):
    """假 session/log 仓库（函数级 import，sys.modules 注入）"""
    monkeypatch.setitem(
        sys.modules,
        "app.repositories.session_repository",
        SimpleNamespace(
            session_repository=SimpleNamespace(
                list_all=lambda model=None, limit=100: [
                    s for s in sessions if model is None or s.model == model
                ][:limit]
            )
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.repositories.log_repository",
        SimpleNamespace(
            log_repository=SimpleNamespace(
                get_by_session=lambda sid: logs_by_session.get(sid, [])
            )
        ),
    )


async def test_batch_pattern_detects_batch(monkeypatch):
    """同机型另一台机器出现相同归一化错误模式 → 批次判定"""
    error_log = _log(log_id="l-cur", session_id="sess-1",
                     content="2024-01-15 10:30:01 ERROR DIMM A2 training failed\n")
    other_log = _log(log_id="l-other", session_id="sess-2",
                     content="2024-01-16 09:00:01 ERROR DIMM A2 training failed\n")
    clean_log = _log(log_id="l-clean", session_id="sess-3", content="INFO ok\n")

    _patch_batch_repos(
        monkeypatch,
        sessions=[
            _session("sess-1", "7500S", sn="SN001"),
            _session("sess-2", "7500S", sn="SN002"),
            _session("sess-3", "7500S", sn="SN003"),
        ],
        logs_by_session={"sess-1": [error_log], "sess-2": [other_log], "sess-3": [clean_log]},
    )

    ctx = _ctx(content=error_log.content, model="7500S")
    ctx.top_patterns = ["ERROR DIMM A<NUM> training failed"]  # 归一化后形态
    # 用真实归一化保证测试与实现对齐
    from app.services.error_cluster_service import normalize_line
    ctx.top_patterns = [normalize_line("2024-01-15 10:30:01 ERROR DIMM A2 training failed")]

    messages, emit = _collector()
    result = await run_batch_pattern(ctx, emit)

    assert result.status == "ok"
    assert ctx.batch_result["matched_count"] == 1
    assert ctx.batch_result["is_batch"] is True
    assert "SN002" in ctx.batch_result["matched_machines"]
    assert "同批次" in result.summary


async def test_batch_pattern_single_occurrence(monkeypatch):
    """同机型其他会话都没有相同模式 → 单台偶发"""
    error_log = _log(log_id="l-cur", session_id="sess-1",
                     content="ERROR unique failure xyz\n")
    clean_log = _log(log_id="l-clean", session_id="sess-2", content="INFO ok\n")
    _patch_batch_repos(
        monkeypatch,
        sessions=[_session("sess-1", "7500S"), _session("sess-2", "7500S", sn="SN002")],
        logs_by_session={"sess-1": [error_log], "sess-2": [clean_log]},
    )

    ctx = _ctx(content=error_log.content, model="7500S")
    ctx.top_patterns = ["ERROR unique failure xyz"]
    messages, emit = _collector()

    result = await run_batch_pattern(ctx, emit)

    assert result.status == "ok"
    assert ctx.batch_result["matched_count"] == 0
    assert ctx.batch_result["is_batch"] is False
    assert "单台偶发" in result.summary


async def test_batch_pattern_skipped_without_model():
    ctx = _ctx(content="ERROR x\n", model=None)
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_batch_pattern(ctx, emit)

    assert result.status == "skipped"
    assert "机型" in result.summary
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v -k batch`
Expected: FAIL — `ImportError: cannot import name 'run_batch_pattern'`

- [ ] **Step 3: 实现步骤 3**

在 `backend/app/services/agent_steps.py` 末尾追加：

```python
async def run_batch_pattern(ctx: InvestigationContext, emit: Emit) -> StepResult:
    """步骤 3：同批次模式检测 —— 同机型其他机器是否出现相同失败模式

    产线逻辑（对齐 system prompt）：单台故障优先硬件/装配/配置；
    同机型多台出现完全相同模式 → 疑似 testcode/批次问题，建议升级 WWWTE。
    """
    from app.repositories.log_repository import log_repository
    from app.repositories.session_repository import session_repository
    from app.services.error_cluster_service import is_error_line, normalize_line

    if not ctx.session_model:
        return StepResult(status="skipped", summary="会话未设置机型，跳过批次检测")
    if not ctx.top_patterns:
        return StepResult(status="skipped", summary="无错误模式，跳过批次检测")

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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v`
Expected: 9 passed

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/services/agent_steps.py backend/tests/test_agent_steps.py
git commit -m "feat: 自主排查同批次模式检测步骤"
```

---

### Task 4: 步骤 4（知识库与维修模板）

**Files:**
- Modify: `backend/app/services/agent_steps.py`（追加函数）
- Test: `backend/tests/test_agent_steps.py`

**Interfaces:**
- Consumes: `knowledge_feedback.search_and_inject(query, obsidian_service) -> (str, list[{filename, title, snippet}])`（async，失败返回 `("", [])`）；`repair_template_service.list(model, limit) -> list[{text, model, count}]`（同步）
- Produces: `async run_knowledge_lookup(ctx, emit) -> StepResult`；填充 `ctx.knowledge_refs: list[{filename, title, snippet}]`（≤3 条，snippet ≤300 字符）与 `ctx.repair_templates: list[{text, count}]`（≤5 条）

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_agent_steps.py` 末尾追加：

```python
# ---- 步骤 4：知识库与维修模板 ----

from app.services.agent_steps import run_knowledge_lookup


class _FakeKnowledgeFeedback:
    def __init__(self, refs):
        self._refs = refs

    async def search_and_inject(self, query, obsidian_service):
        return ("注入文本", self._refs)


def _patch_knowledge(monkeypatch, refs, templates):
    monkeypatch.setitem(
        sys.modules,
        "app.services.knowledge_feedback",
        SimpleNamespace(knowledge_feedback=_FakeKnowledgeFeedback(refs)),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.services.obsidian_service",
        SimpleNamespace(obsidian_service=object()),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.services.repair_template_service",
        SimpleNamespace(
            repair_template_service=SimpleNamespace(
                list=lambda model=None, limit=50: templates[:limit]
            )
        ),
    )


async def test_knowledge_lookup_hits(monkeypatch):
    _patch_knowledge(
        monkeypatch,
        refs=[{"filename": "case1.md", "title": "DIMM 故障案例", "snippet": "s" * 400}],
        templates=[{"text": "重插拔内存条", "model": "7500S", "count": 3}],
    )
    ctx = _ctx(content="ERROR x\n", model="7500S")
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_knowledge_lookup(ctx, emit)

    assert result.status == "ok"
    assert len(ctx.knowledge_refs) == 1
    assert ctx.knowledge_refs[0]["title"] == "DIMM 故障案例"
    # snippet 截断到 300 字符
    assert len(ctx.knowledge_refs[0]["snippet"]) == 300
    assert ctx.repair_templates == [{"text": "重插拔内存条", "count": 3}]


async def test_knowledge_lookup_no_hits(monkeypatch):
    _patch_knowledge(monkeypatch, refs=[], templates=[])
    ctx = _ctx(content="ERROR x\n")
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_knowledge_lookup(ctx, emit)

    assert result.status == "ok"
    assert "均无命中" in result.summary
    assert ctx.knowledge_refs == []
    assert ctx.repair_templates == []


async def test_knowledge_lookup_kb_failure_still_gets_templates(monkeypatch):
    """知识库抛异常不阻断：模板照常查询，步骤整体 ok"""

    class _FailKF:
        async def search_and_inject(self, query, obsidian_service):
            raise RuntimeError("WebDAV down")

    monkeypatch.setitem(
        sys.modules,
        "app.services.knowledge_feedback",
        SimpleNamespace(knowledge_feedback=_FailKF()),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.services.obsidian_service",
        SimpleNamespace(obsidian_service=object()),
    )
    monkeypatch.setitem(
        sys.modules,
        "app.services.repair_template_service",
        SimpleNamespace(
            repair_template_service=SimpleNamespace(
                list=lambda model=None, limit=50: [{"text": "重插拔内存条", "model": "", "count": 1}]
            )
        ),
    )
    ctx = _ctx(content="ERROR x\n")
    ctx.top_patterns = ["ERROR x"]
    messages, emit = _collector()

    result = await run_knowledge_lookup(ctx, emit)

    assert result.status == "ok"
    assert ctx.knowledge_refs == []
    assert len(ctx.repair_templates) == 1
    assert any("不可用" in m for m in messages)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v -k knowledge`
Expected: FAIL — `ImportError: cannot import name 'run_knowledge_lookup'`

- [ ] **Step 3: 实现步骤 4**

在 `backend/app/services/agent_steps.py` 末尾追加：

```python
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v`
Expected: 12 passed

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/services/agent_steps.py backend/tests/test_agent_steps.py
git commit -m "feat: 自主排查知识库与维修模板步骤"
```

---

### Task 5: 报告 prompt 构建器 + 兜底报告构建器

**Files:**
- Modify: `backend/app/services/agent_steps.py`（追加两个同步函数）
- Test: `backend/tests/test_agent_steps.py`

**Interfaces:**
- Consumes: `app.services.context_manager.SYSTEM_PROMPT`（现有产线诊断 system prompt，直接复用）；`InvestigationContext` 全部证据字段
- Produces: `build_report_prompt(ctx) -> list[dict]`（OpenAI messages 格式：`[system, user]`）；`build_fallback_report(ctx) -> str`（AI 不可用时直接拼装证据的 markdown 报告）

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_agent_steps.py` 末尾追加：

```python
# ---- 报告 prompt / 兜底报告 ----

from app.services.agent_steps import build_fallback_report, build_report_prompt


def _rich_ctx() -> InvestigationContext:
    """填满证据的上下文"""
    ctx = _ctx(content="ERROR DIMM A2 training failed\n", model="7500S", history="用户: 帮忙看下\nAI: 初步看是内存")
    ctx.error_clusters = {
        "total_error_lines": 3,
        "clusters": [
            {"pattern": "ERROR DIMM A<NUM> training failed", "count": 3, "first_seen": None,
             "last_seen": None, "sample": "ERROR DIMM A2 training failed", "ratio": 1.0},
        ],
    }
    ctx.top_patterns = ["ERROR DIMM A<NUM> training failed"]
    ctx.similar_cases = [{"log_id": "old-1", "similarity": 0.92, "preview": "历史案例预览"}]
    ctx.batch_result = {
        "model": "7500S", "checked_sessions": 5, "matched_count": 1,
        "matched_machines": ["SN002"], "is_batch": True,
    }
    ctx.knowledge_refs = [{"filename": "case1.md", "title": "DIMM 故障案例", "snippet": "换内存解决"}]
    ctx.repair_templates = [{"text": "重插拔内存条", "count": 3}]
    return ctx


def test_build_report_prompt_contains_all_evidence():
    ctx = _rich_ctx()

    messages = build_report_prompt(ctx)

    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[0]["content"]  # 复用现有产线 system prompt
    user = messages[1]["content"]
    # 四段输出指令
    assert "🎯 故障部件定位" in user
    assert "🔍 根因判定" in user
    assert "🛠️ 维修动作" in user
    assert "⚠️ 是否需升级 WWWTE" in user
    # 证据全部带入
    assert "DIMM" in user                      # 错误聚类
    assert "历史案例预览" in user                # 相似案例
    assert "SN002" in user                     # 批次检测
    assert "DIMM 故障案例" in user               # 知识库
    assert "重插拔内存条" in user                # 维修模板
    assert "初步看是内存" in user                # 对话上下文


def test_build_report_prompt_without_optional_evidence():
    """只有错误聚类时 prompt 仍完整（可选证据段不出现）"""
    ctx = _ctx(content="ERROR x\n")
    ctx.error_clusters = {
        "total_error_lines": 1,
        "clusters": [{"pattern": "ERROR x", "count": 1, "first_seen": None,
                      "last_seen": None, "sample": "ERROR x", "ratio": 1.0}],
    }

    messages = build_report_prompt(ctx)

    user = messages[1]["content"]
    assert "证据 1" in user
    assert "证据 2" not in user   # 无相似案例
    assert "证据 3" not in user   # 无批次结果


def test_build_fallback_report_structure():
    ctx = _rich_ctx()

    report = build_fallback_report(ctx)

    assert "本地兜底" in report
    assert "🎯 故障部件定位" in report
    assert "🔍 根因判定" in report
    assert "🛠️ 维修动作" in report
    assert "⚠️ 是否需升级 WWWTE" in report
    assert "DIMM" in report
    assert "SN002" in report
    assert "重插拔内存条" in report
    # 批次判定结论体现在升级段
    assert "反馈 WWWTE" in report


def test_build_fallback_report_single_machine():
    ctx = _ctx(content="ERROR x\n")
    ctx.error_clusters = {"total_error_lines": 1, "clusters": [
        {"pattern": "ERROR x", "count": 1, "first_seen": None,
         "last_seen": None, "sample": "ERROR x", "ratio": 1.0}]}
    ctx.batch_result = {
        "model": "7500S", "checked_sessions": 3, "matched_count": 0,
        "matched_machines": [], "is_batch": False,
    }

    report = build_fallback_report(ctx)

    assert "单台偶发" in report
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v -k "report_prompt or fallback"`
Expected: FAIL — `ImportError: cannot import name 'build_report_prompt'`

- [ ] **Step 3: 实现两个构建器**

在 `backend/app/services/agent_steps.py` 末尾追加：

```python
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v`
Expected: 16 passed

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/services/agent_steps.py backend/tests/test_agent_steps.py
git commit -m "feat: 自主排查报告 prompt 与兜底报告构建器"
```

---

### Task 6: agent_service 流水线 runner

**Files:**
- Create: `backend/app/services/agent_service.py`
- Test: `backend/tests/test_agent_service.py`

**Interfaces:**
- Consumes: Task 1-5 的全部步骤函数与构建器；`log_service.get_logs_by_session(session_id) -> list[LogFile]`；`session_service.get_session(session_id) -> Session`；`message_service.get_recent_messages(session_id, limit=10) -> list[Message]` 和 `message_service.create_message(session_id, role, content) -> Message`；`ai_service.chat_stream(messages, temperature) -> AsyncIterator[str]`
- Produces: `agent_service` 单例：`is_active(user_id: str) -> bool`；`investigate(session_id: str, user_id: str) -> AsyncIterator[dict]`（yield SSE 事件 dict：`step_start/step_progress/step_done/report_chunk/done/error`）；模块常量 `STEPS: list[tuple[int, str, Callable]]`、`STEP_TIMEOUT = 30`、`TOTAL_TIMEOUT = 180`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_agent_service.py`：

```python
"""
agent_service 流水线 runner 单元测试
"""

import sys
from types import SimpleNamespace

import pytest

from app.services import agent_service as agent_module
from app.services.agent_service import AgentService
from app.services.agent_steps import InvestigationContext, StepResult


def _ctx() -> InvestigationContext:
    return InvestigationContext(session_id="sess-1", logs=[], session_model="7500S")


def _patch_common(monkeypatch, ai):
    """假上下文构建 + 假 AI + 假消息服务"""
    monkeypatch.setattr(AgentService, "_build_context", lambda self, sid: _ctx())
    monkeypatch.setitem(
        sys.modules, "app.services.ai_service", SimpleNamespace(ai_service=ai)
    )
    saved: list[str] = []
    monkeypatch.setattr(
        agent_module,
        "message_service",
        SimpleNamespace(
            create_message=lambda session_id, role, content: saved.append(content)
            or SimpleNamespace(id="msg-1")
        ),
    )
    return saved


class _OkAI:
    def chat_stream(self, messages, temperature=0.7):
        async def gen():
            yield "## 🎯 故障部件定位\n内存条 A2"
        return gen()


class _FailAI:
    def chat_stream(self, messages, temperature=0.7):
        async def gen():
            raise RuntimeError("AI down")
            yield  # pragma: no cover  # 使其成为 async generator
        return gen()


async def _ok_step(ctx, emit):
    emit("进度消息")
    return StepResult(status="ok", summary="完成")


async def _boom_step(ctx, emit):
    raise RuntimeError("step exploded")


async def _collect(service: AgentService) -> list[dict]:
    return [e async for e in service.investigate("sess-1", "u1")]


async def test_pipeline_event_sequence(monkeypatch):
    saved = _patch_common(monkeypatch, _OkAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "步骤一", _ok_step), (2, "步骤二", _ok_step)])
    service = AgentService()

    events = await _collect(service)

    types = [e["type"] for e in events]
    # 两个步骤各 start/done 一次，进度消息在 start 之后
    assert types[0] == "step_start"
    assert "step_progress" in types
    assert types.count("step_start") == 3      # 2 个证据步骤 + 报告步骤
    assert types.count("step_done") == 3
    assert "report_chunk" in types
    assert types[-1] == "done"
    # 报告落库为 assistant 消息
    assert saved and "自主排查报告" in saved[0]
    # 并发锁已释放
    assert not service.is_active("u1")


async def test_pipeline_step_failure_isolated(monkeypatch):
    saved = _patch_common(monkeypatch, _OkAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "爆炸步骤", _boom_step), (2, "步骤二", _ok_step)])
    service = AgentService()

    events = await _collect(service)

    failed = [e for e in events if e["type"] == "step_done" and e["status"] == "failed"]
    assert len(failed) == 1 and failed[0]["step"] == 1
    # 后续步骤照常执行
    ok_done = [e for e in events if e["type"] == "step_done" and e["step"] == 2]
    assert ok_done and ok_done[0]["status"] == "ok"
    assert events[-1]["type"] == "done"
    assert not service.is_active("u1")


async def test_pipeline_ai_failure_fallback_report(monkeypatch):
    saved = _patch_common(monkeypatch, _FailAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "步骤一", _ok_step)])
    service = AgentService()

    events = await _collect(service)

    report_text = "".join(e.get("content", "") for e in events if e["type"] == "report_chunk")
    assert "本地兜底" in report_text
    assert events[-1]["type"] == "done"
    assert saved and "本地兜底" in saved[0]


async def test_pipeline_concurrent_user_rejected(monkeypatch):
    _patch_common(monkeypatch, _OkAI())
    monkeypatch.setattr(agent_module, "STEPS", [(1, "步骤一", _ok_step)])
    service = AgentService()
    service._active_users.add("u1")

    events = await _collect(service)

    assert events == [{"type": "error", "message": "已有排查进行中，请稍后再试"}]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.agent_service'`

- [ ] **Step 3: 实现流水线 runner**

创建 `backend/app/services/agent_service.py`：

```python
"""
AI Agent 自主排查 —— 固定流水线 runner

按预定顺序执行排查步骤，通过 asyncio.Queue 把步骤内的进度事件
实时转发给调用方（SSE 路由）。设计原则：
- 单步失败不中断流水线（step_done status=failed，继续后续步骤）
- AI 不可用时用兜底模板生成报告
- 每用户同时最多 1 个排查（内存锁）
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable

from app.models.message import MessageRole
from app.services.agent_steps import (
    InvestigationContext,
    StepResult,
    build_fallback_report,
    build_report_prompt,
    run_batch_pattern,
    run_error_extraction,
    run_knowledge_lookup,
    run_similar_cases,
)
from app.services.log_service import log_service
from app.services.message_service import message_service

logger = logging.getLogger(__name__)

STEP_TIMEOUT = 30       # 单步超时（秒）
TOTAL_TIMEOUT = 180     # 整体超时（秒）

# (步骤号, 中文标题, 步骤函数)；报告生成是特殊的最后一步，不在此表
STEPS: list[tuple[int, str, Callable]] = [
    (1, "错误定位", run_error_extraction),
    (2, "相似案例检索", run_similar_cases),
    (3, "同批次模式检测", run_batch_pattern),
    (4, "知识库与维修模板", run_knowledge_lookup),
]


class AgentService:
    """自主排查服务（固定流水线）"""

    def __init__(self) -> None:
        self._active_users: set[str] = set()

    def is_active(self, user_id: str) -> bool:
        return user_id in self._active_users

    async def investigate(
        self, session_id: str, user_id: str
    ) -> AsyncIterator[dict]:
        """执行排查流水线，逐步 yield SSE 事件 dict"""
        if user_id in self._active_users:
            yield {"type": "error", "message": "已有排查进行中，请稍后再试"}
            return
        self._active_users.add(user_id)
        started = time.monotonic()
        try:
            ctx = self._build_context(session_id)
            for num, title, step_fn in STEPS:
                if time.monotonic() - started > TOTAL_TIMEOUT:
                    yield {"type": "error", "message": "排查整体超时，已终止"}
                    return
                async for event in self._run_step(ctx, num, title, step_fn):
                    yield event
            async for event in self._generate_report(ctx):
                yield event
        finally:
            self._active_users.discard(user_id)

    def _build_context(self, session_id: str) -> InvestigationContext:
        """收集流水线输入：会话日志、机型、已有对话上下文"""
        from app.services.session_service import session_service

        logs = log_service.get_logs_by_session(session_id)
        session = session_service.get_session(session_id)
        recent = message_service.get_recent_messages(session_id, limit=10)
        history_text = "\n".join(
            f"{'用户' if m.role == MessageRole.USER else 'AI'}: {m.content[:300]}"
            for m in recent
        )
        return InvestigationContext(
            session_id=session_id,
            logs=logs,
            session_model=session.model,
            history_text=history_text,
        )

    async def _call_step(self, step_fn, ctx, emit) -> StepResult:
        """调用单个步骤，统一兜底异常与超时"""
        try:
            return await asyncio.wait_for(step_fn(ctx, emit), timeout=STEP_TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning(f"排查步骤超时: {step_fn.__name__}")
            return StepResult(
                status="failed", summary=f"步骤超时（>{STEP_TIMEOUT}s）", error="timeout"
            )
        except Exception as e:
            logger.exception(f"排查步骤失败: {step_fn.__name__}: {e}")
            return StepResult(
                status="failed", summary=f"步骤失败: {str(e)[:80]}", error=str(e)[:200]
            )

    async def _run_step(self, ctx, num, title, step_fn) -> AsyncIterator[dict]:
        """运行单个步骤并实时转发其进度事件"""
        yield {"type": "step_start", "step": num, "title": title}
        queue: asyncio.Queue = asyncio.Queue()

        def emit(message: str) -> None:
            queue.put_nowait({"type": "step_progress", "step": num, "message": message})

        task = asyncio.create_task(self._call_step(step_fn, ctx, emit))
        try:
            while not task.done():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.05)
                    yield event
                except asyncio.TimeoutError:
                    continue
            while not queue.empty():
                yield queue.get_nowait()
            result = task.result()
        except BaseException:
            # 客户端断开（GeneratorExit/CancelledError）：取消步骤任务并向上传播
            task.cancel()
            raise
        yield {
            "type": "step_done",
            "step": num,
            "status": result.status,
            "summary": result.summary,
        }

    async def _generate_report(self, ctx) -> AsyncIterator[dict]:
        """步骤 5：LLM 流式生成根因报告；失败/空回复降级为兜底报告"""
        from app.services.ai_service import ai_service

        yield {"type": "step_start", "step": 5, "title": "根因报告生成"}
        messages = build_report_prompt(ctx)
        full_report = ""
        got_content = False
        stream = None
        try:
            stream = ai_service.chat_stream(messages, temperature=0.3)
            async for chunk in stream:
                if not got_content:
                    got_content = True
                    header = "🔬 **自主排查报告**\n\n"
                    full_report += header
                    yield {"type": "report_chunk", "content": header}
                full_report += chunk
                yield {"type": "report_chunk", "content": chunk}
        except Exception as e:
            logger.warning(f"AI 报告流失败: {e}")
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
            full_report = build_fallback_report(ctx)
            yield {"type": "report_chunk", "content": full_report}

        # 报告存为会话消息：保存知识库/导出/历史回看零改动直接可用
        message = message_service.create_message(
            session_id=ctx.session_id,
            role=MessageRole.ASSISTANT,
            content=full_report,
        )
        yield {"type": "step_done", "step": 5, "status": "ok", "summary": "报告已生成"}
        yield {"type": "done", "message_id": message.id}


# 全局单例
agent_service = AgentService()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_service.py -v`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/services/agent_service.py backend/tests/test_agent_service.py
git commit -m "feat: 自主排查流水线 runner"
```

---

### Task 7: agent_routes + main.py 注册

**Files:**
- Create: `backend/app/routes/agent_routes.py`
- Modify: `backend/app/main.py`（import 区 + include_router 区各加一行）
- Test: `backend/tests/test_agent_routes.py`

**Interfaces:**
- Consumes: `InvestigateRequest`（Task 1）；`agent_service`（Task 6）；`require_session_owner(session_id, user)` / `require_log_owner(log_id, user)`（`app/utils/auth.py`，失败抛 `ValidationError`）；`log_repository.get_by_id(log_id) -> LogFile`；`log_service.get_logs_by_session(session_id) -> list`
- Produces: `POST /api/agent/investigate`（SSE）。鉴权经现有 `AuthMiddleware`，`request.state.user` 有 `id`/`role`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_agent_routes.py`：

```python
"""
agent_routes 路由单元测试

无路由测试基建（无 TestClient/JWT fixture），按现有测试风格
直接调用 handler：fake request + monkeypatch 归属校验与服务。
"""

from types import SimpleNamespace

import pytest
from fastapi.responses import StreamingResponse

from app.middlewares.error_handler import ValidationError
from app.routes import agent_routes
from app.routes.agent_routes import investigate
from app.types.agent_types import InvestigateRequest


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(user=SimpleNamespace(id="u1", role="admin"))
    )


def _patch_happy(monkeypatch, events):
    """打通 handler 的所有外部依赖"""
    monkeypatch.setattr(agent_routes, "require_session_owner", lambda sid, user: None)
    monkeypatch.setattr(agent_routes, "require_log_owner", lambda lid, user: None)
    monkeypatch.setattr(
        agent_routes,
        "log_repository",
        SimpleNamespace(get_by_id=lambda lid: SimpleNamespace(session_id="sess-1")),
    )
    monkeypatch.setattr(
        agent_routes,
        "log_service",
        SimpleNamespace(get_logs_by_session=lambda sid: [object()]),
    )

    class _FakeAgent:
        def is_active(self, user_id):
            return False

        def investigate(self, session_id, user_id):
            async def gen():
                for e in events:
                    yield e
            return gen()

    monkeypatch.setattr(agent_routes, "agent_service", _FakeAgent())


async def test_investigate_requires_one_id():
    with pytest.raises(ValidationError, match="必须提供一个"):
        await investigate(InvestigateRequest(), _request())


async def test_investigate_rejects_when_active(monkeypatch):
    _patch_happy(monkeypatch, [])
    monkeypatch.setattr(
        agent_routes,
        "agent_service",
        SimpleNamespace(is_active=lambda uid: True),
    )
    with pytest.raises(ValidationError, match="已有排查进行中"):
        await investigate(InvestigateRequest(session_id="sess-1"), _request())


async def test_investigate_rejects_without_logs(monkeypatch):
    _patch_happy(monkeypatch, [])
    monkeypatch.setattr(
        agent_routes,
        "log_service",
        SimpleNamespace(get_logs_by_session=lambda sid: []),
    )
    with pytest.raises(ValidationError, match="还没有日志文件"):
        await investigate(InvestigateRequest(session_id="sess-1"), _request())


async def test_investigate_streams_sse_by_session_id(monkeypatch):
    _patch_happy(monkeypatch, [
        {"type": "step_start", "step": 1, "title": "错误定位"},
        {"type": "done", "message_id": "msg-1"},
    ])

    resp = await investigate(InvestigateRequest(session_id="sess-1"), _request())

    assert isinstance(resp, StreamingResponse)
    chunks = [c async for c in resp.body_iterator]
    text = "".join(chunks)
    assert text.startswith("data: ")
    assert '"step_start"' in text
    assert '"done"' in text
    assert text.endswith("\n\n")


async def test_investigate_accepts_log_id(monkeypatch):
    """log_id 入口：复用日志所属会话"""
    used = {}

    _patch_happy(monkeypatch, [{"type": "done", "message_id": "msg-1"}])

    class _RecordingAgent:
        def is_active(self, user_id):
            return False

        def investigate(self, session_id, user_id):
            used["session_id"] = session_id

            async def gen():
                yield {"type": "done", "message_id": "msg-1"}
            return gen()

    monkeypatch.setattr(agent_routes, "agent_service", _RecordingAgent())

    resp = await investigate(InvestigateRequest(log_id="log-9"), _request())

    assert isinstance(resp, StreamingResponse)
    assert used["session_id"] == "sess-1"   # 来自 fake log_repository
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routes.agent_routes'`

- [ ] **Step 3: 实现路由并注册**

创建 `backend/app/routes/agent_routes.py`：

```python
"""
AI Agent 自主排查路由

POST /api/agent/investigate —— 启动固定流水线排查，SSE 流式返回过程与报告。
归属校验/限流复用现有中间件；SSE 事件格式与 chat 路由一致。
"""

import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.middlewares.error_handler import ValidationError
from app.repositories.log_repository import log_repository
from app.services.agent_service import agent_service
from app.services.log_service import log_service
from app.types.agent_types import InvestigateRequest
from app.utils.auth import require_log_owner, require_session_owner

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/investigate")
async def investigate(body: InvestigateRequest, request: Request):
    """
    启动自主排查

    Body 二选一：
    - session_id：对指定会话排查（聊天中"深入调查"入口）
    - log_id：对该日志所属会话排查（上传后"深度排查"入口）
    """
    user = request.state.user

    if not body.session_id and not body.log_id:
        raise ValidationError("session_id 与 log_id 必须提供一个")

    if body.session_id:
        require_session_owner(body.session_id, user)
        session_id = body.session_id
    else:
        require_log_owner(body.log_id, user)
        lf = log_repository.get_by_id(body.log_id)
        session_id = lf.session_id

    if not log_service.get_logs_by_session(session_id):
        raise ValidationError("该会话还没有日志文件，请先上传日志")

    if agent_service.is_active(user.id):
        raise ValidationError("已有排查进行中，请稍后再试")

    async def generate():
        try:
            async for event in agent_service.investigate(session_id, user.id):
                yield _sse_event(event)
        except Exception as e:
            logger.exception(f"自主排查异常: {e}")
            yield _sse_event({"type": "error", "message": "排查服务异常，请稍后重试"})
            yield _sse_event({"type": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


def _sse_event(data: dict) -> str:
    """格式化 SSE 事件"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
```

修改 `backend/app/main.py`：在 import 区（`from app.routes.anomaly_routes import ...` 之前，保持字母序）加：

```python
from app.routes.agent_routes import router as agent_router
```

在 include_router 区（`app.include_router(anomaly_router, ...)` 之前）加：

```python
app.include_router(agent_router, prefix="/api/agent", tags=["AI 自主排查"])
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_routes.py -v`
Expected: 5 passed

- [ ] **Step 5: 跑后端全量测试确认无回归**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/ -v`
Expected: 全部通过（含既有测试）

- [ ] **Step 6: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/routes/agent_routes.py backend/app/main.py backend/tests/test_agent_routes.py
git commit -m "feat: 自主排查 SSE 路由与注册"
```

---

### Task 8: 前端 agentService + investigationStore + 导出线

**Files:**
- Create: `frontend/src/services/agentService.ts`
- Create: `frontend/src/stores/investigationStore.ts`
- Modify: `frontend/src/services/index.ts`（加一行导出）
- Modify: `frontend/src/stores/index.ts`（加一行导出）

**Interfaces:**
- Consumes: `http.stream(path, body, signal) -> AsyncGenerator`（`frontend/src/services/http.ts`）；`useChatStore.getState().fetchMessages(sessionId)`（`frontend/src/stores/chatStore.ts`）
- Produces: `agentService.investigate(sessionId: string, signal?: AbortSignal) -> AsyncGenerator<AgentEvent>`；`AgentEvent` 类型（`type: 'step_start'|'step_progress'|'step_done'|'report_chunk'|'done'|'error'`，可选字段 `step/title/message/status/summary/content/message_id`）；`useInvestigationStore`（state：`active/running/sessionId/steps/report/error`，actions：`start(sessionId)/cancel()/close()`）；`StepState` 类型（`step/title/status: 'running'|'ok'|'failed'|'skipped'/messages: string[]/summary?`）

- [ ] **Step 1: 创建 agentService.ts**

创建 `frontend/src/services/agentService.ts`：

```typescript
/**
 * AI Agent 自主排查 API（SSE 流式）
 */

import { http } from './http';

export interface AgentEvent {
  type: 'step_start' | 'step_progress' | 'step_done' | 'report_chunk' | 'done' | 'error';
  step?: number;
  title?: string;
  message?: string;
  status?: 'ok' | 'failed' | 'skipped';
  summary?: string;
  content?: string;
  message_id?: string;
}

/**
 * 启动自主排查并流式接收事件
 * @param signal 用于取消（AbortController）
 */
export async function* investigate(
  sessionId: string,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  // http.stream 的返回类型是通用 chunk 形状，与 AgentEvent 不兼容，需 as unknown 中转
  yield* http.stream('/agent/investigate', { session_id: sessionId }, signal) as unknown as AsyncGenerator<AgentEvent>;
}

export const agentService = { investigate };
```

- [ ] **Step 2: 创建 investigationStore.ts**

创建 `frontend/src/stores/investigationStore.ts`：

```typescript
/**
 * AI Agent 自主排查状态管理
 *
 * 流水线事件驱动 steps 时间线与流式报告；
 * 报告在后端落库为 assistant 消息，结束后刷新消息列表即可在聊天历史看到。
 */

import { create } from 'zustand';
import { agentService } from '@/services/agentService';
import { useChatStore } from './chatStore';

export interface StepState {
  step: number;
  title: string;
  status: 'running' | 'ok' | 'failed' | 'skipped';
  messages: string[];
  summary?: string;
}

interface InvestigationState {
  active: boolean; // 是否显示排查视图（运行中或查看结果）
  running: boolean; // 流水线是否在跑
  sessionId: string | null;
  steps: StepState[];
  report: string;
  error: string | null;

  start: (sessionId: string) => Promise<void>;
  cancel: () => void;
  close: () => void;
}

// 当前排查的 AbortController；重复触发/取消时 abort 旧的
let controller: AbortController | null = null;

export const useInvestigationStore = create<InvestigationState>((set, get) => ({
  active: false,
  running: false,
  sessionId: null,
  steps: [],
  report: '',
  error: null,

  start: async (sessionId) => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    set({ active: true, running: true, sessionId, steps: [], report: '', error: null });

    const updateStep = (num: number, patch: Partial<StepState>) =>
      set((s) => ({
        steps: s.steps.map((st) => (st.step === num ? { ...st, ...patch } : st)),
      }));

    const appendStepMessage = (num: number, message: string) =>
      set((s) => ({
        steps: s.steps.map((st) =>
          st.step === num ? { ...st, messages: [...st.messages, message] } : st
        ),
      }));

    try {
      for await (const event of agentService.investigate(sessionId, signal)) {
        switch (event.type) {
          case 'step_start':
            set((s) => ({
              steps: [
                ...s.steps,
                {
                  step: event.step!,
                  title: event.title || '',
                  status: 'running',
                  messages: [],
                },
              ],
            }));
            break;
          case 'step_progress':
            appendStepMessage(event.step!, event.message || '');
            break;
          case 'step_done':
            updateStep(event.step!, {
              status: event.status || 'ok',
              summary: event.summary,
            });
            break;
          case 'report_chunk':
            set((s) => ({ report: s.report + (event.content || '') }));
            break;
          case 'error':
            set({ error: event.message || '排查失败' });
            break;
          case 'done':
            break;
        }
      }
    } catch (err: unknown) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      set({ running: false });
      if (aborted) return;
      set({ error: (err as Error)?.message || '连接失败' });
      return;
    }

    // 流正常结束（done 或 error 事件都可能）
    set({ running: false });

    // 报告已落库为 assistant 消息：刷新消息列表，聊天历史里能看到
    const sid = get().sessionId;
    if (sid) {
      useChatStore
        .getState()
        .fetchMessages(sid)
        .catch(() => {
          /* 刷新失败不影响排查结果展示 */
        });
    }
  },

  cancel: () => {
    controller?.abort();
    controller = null;
    set({ running: false });
  },

  close: () => {
    get().cancel();
    set({ active: false, steps: [], report: '', error: null, sessionId: null });
  },
}));
```

- [ ] **Step 3: 加导出线**

修改 `frontend/src/services/index.ts`，在末尾追加：

```typescript
export * from './agentService';
```

修改 `frontend/src/stores/index.ts`，在末尾追加：

```typescript
export * from './investigationStore';
```

- [ ] **Step 4: 构建验证**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: tsc + vite build 通过，无类型错误

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add frontend/src/services/agentService.ts frontend/src/stores/investigationStore.ts frontend/src/services/index.ts frontend/src/stores/index.ts
git commit -m "feat: 前端自主排查服务与状态管理"
```

---

### Task 9: InvestigationView 组件

**Files:**
- Create: `frontend/src/components/agent/InvestigationView.tsx`

**Interfaces:**
- Consumes: `useInvestigationStore`（Task 8）：`steps/report/running/error/cancel/close`；`MarkdownRenderer`（`@/components/knowledge/MarkdownRenderer`，props `{ content: string }`）；lucide-react 图标（0.378 版本含 `Microscope/Loader2/CheckCircle2/XCircle/SkipForward/ChevronDown/ChevronUp/X`）
- Produces: `InvestigationView` 组件（无 props，直接从 store 读状态）

- [ ] **Step 1: 创建组件**

创建 `frontend/src/components/agent/InvestigationView.tsx`：

```tsx
/**
 * AI Agent 自主排查视图
 * 上半部分：步骤时间线（可折叠卡片，状态图标 + 进度消息）
 * 下半部分：流式根因报告（MarkdownRenderer 渲染）
 */

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Microscope,
  SkipForward,
  X,
  XCircle,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/knowledge/MarkdownRenderer';
import { useInvestigationStore, type StepState } from '@/stores/investigationStore';
import { cn } from '@/utils';

function StepIcon({ status }: { status: StepState['status'] }) {
  if (status === 'running') {
    return <Loader2 size={15} className="animate-spin text-primary shrink-0" />;
  }
  if (status === 'ok') {
    return <CheckCircle2 size={15} className="text-success shrink-0" />;
  }
  if (status === 'skipped') {
    return <SkipForward size={15} className="text-muted-foreground shrink-0" />;
  }
  return <XCircle size={15} className="text-warning shrink-0" />;
}

function StepCard({ step }: { step: StepState }) {
  const [expanded, setExpanded] = useState(step.status === 'running');

  return (
    <div className="border border-border rounded-lg bg-card/60 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <StepIcon status={step.status} />
        <span className="text-xs font-medium flex-1 whitespace-nowrap">
          步骤 {step.step} · {step.title}
        </span>
        {step.summary && (
          <span className="text-[11px] text-muted-foreground truncate max-w-[45%]">
            {step.summary}
          </span>
        )}
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {expanded && step.messages.length > 0 && (
        <div className="px-3 pb-2 pt-1.5 space-y-0.5 border-t border-border/50">
          {step.messages.map((m, i) => (
            <div key={i} className="text-[11px] text-muted-foreground leading-relaxed">
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function InvestigationView() {
  const { steps, report, running, error, cancel, close } = useInvestigationStore();

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="max-w-2xl mx-auto space-y-3">
        {/* 标题栏 */}
        <div className="flex items-center gap-2">
          <Microscope size={16} className="text-primary" />
          <span className="text-sm font-semibold flex-1">AI 自主排查</span>
          {running ? (
            <button
              onClick={cancel}
              className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-muted transition-colors"
            >
              取消
            </button>
          ) : (
            <button
              onClick={close}
              className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-muted transition-colors inline-flex items-center gap-1"
            >
              <X size={12} /> 关闭
            </button>
          )}
        </div>

        {/* 步骤时间线 */}
        <div className="space-y-2">
          {steps.map((s) => (
            <StepCard key={s.step} step={s} />
          ))}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* 流式报告 */}
        {report && (
          <div className="border border-border rounded-lg bg-card p-4">
            <MarkdownRenderer content={report} />
            {running && (
              <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 构建验证**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: 构建通过

- [ ] **Step 3: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add frontend/src/components/agent/InvestigationView.tsx
git commit -m "feat: 自主排查步骤时间线与报告视图组件"
```

---

### Task 10: ChatPanel + LogPanel 入口集成

**Files:**
- Modify: `frontend/src/components/chat/ChatPanel.tsx`
- Modify: `frontend/src/components/log/LogPanel.tsx`

**Interfaces:**
- Consumes: `useInvestigationStore`（Task 8，经 `@/stores` 导出）；`InvestigationView`（Task 9）；`useLogStore` 的 `logFiles`（现有）
- Produces: ChatPanel 头部"自主排查"按钮 + `/investigate` 输入命令 + 排查视图切换；LogPanel 上传区下方"深度排查"按钮

- [ ] **Step 1: 修改 ChatPanel.tsx**

在 `frontend/src/components/chat/ChatPanel.tsx` 中做 4 处修改：

(a) import 区，把 lucide-react 的 import 行：

```tsx
import { Copy, Check, Paperclip, FileText, GitCompareArrows } from 'lucide-react';
```

改为：

```tsx
import { Copy, Check, Paperclip, FileText, GitCompareArrows, Microscope } from 'lucide-react';
```

并在组件 import 区追加：

```tsx
import { InvestigationView } from '@/components/agent/InvestigationView';
import { useInvestigationStore } from '@/stores/investigationStore';
```

(b) 在 `const [showCompare, setShowCompare] = useState(false);` 之后加：

```tsx
  const investActive = useInvestigationStore((s) => s.active);
  const startInvestigation = useInvestigationStore((s) => s.start);
```

(c) `handleSend` 函数改为（加 `/investigate` 命令拦截）：

```tsx
  const handleSend = async (content: string) => {
    // /investigate 命令：触发 AI 自主排查
    if (content.trim() === '/investigate') {
      if (logFiles.length > 0 && !streaming) {
        await startInvestigation(sessionId);
      }
      return;
    }
    try {
      await sendMessage(sessionId, content);
    } catch (error) {
      console.error('发送失败:', error);
    }
  };
```

(d) header 按钮区，在 `<ExportButton sessionId={sessionId} />` 之后加：

```tsx
          <button
            onClick={() => startInvestigation(sessionId)}
            disabled={logFiles.length === 0 || streaming}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors disabled:opacity-30"
            title="AI 自主排查"
          >
            <Microscope size={15} />
          </button>
```

(e) 消息列表区，把：

```tsx
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
```

改为：

```tsx
      {/* Messages / 自主排查视图 */}
      {investActive ? (
        <InvestigationView />
      ) : (
      <div className="flex-1 overflow-y-auto">
```

并把该区块对应的闭合 `</div>`（在 `<div ref={messagesEndRef} />` 之后的那个）后加 `)}`，即：

```tsx
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
      )}
```

注意：改动后 JSX 结构为 `{investActive ? <InvestigationView /> : (<div className="flex-1 overflow-y-auto">...原内容...</div>)}`，保持原缩进不强制重排。

- [ ] **Step 2: 修改 LogPanel.tsx**

在 `frontend/src/components/log/LogPanel.tsx` 中做 3 处修改：

(a) import 区，把：

```tsx
import {
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
```

改为：

```tsx
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Microscope,
} from 'lucide-react';
```

并追加：

```tsx
import { useInvestigationStore } from '@/stores/investigationStore';
```

(b) 组件内 `const [showSimilar, setShowSimilar] = useState(false);` 之后加：

```tsx
  const startInvestigation = useInvestigationStore((s) => s.start);
```

(c) 上传区，把：

```tsx
          {/* Upload */}
          <div className="p-3 border-b border-border">
            <LogUploader sessionId={sessionId} />
          </div>
```

改为：

```tsx
          {/* Upload + 深度排查入口 */}
          <div className="p-3 border-b border-border space-y-2">
            <LogUploader sessionId={sessionId} />
            {logFiles.length > 0 && (
              <button
                onClick={() => startInvestigation(sessionId)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Microscope size={13} />
                深度排查
              </button>
            )}
          </div>
```

- [ ] **Step 3: 构建验证**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add frontend/src/components/chat/ChatPanel.tsx frontend/src/components/log/LogPanel.tsx
git commit -m "feat: 聊天面板与日志面板接入自主排查入口"
```

---

### Task 11: README 更新 + 全量验证

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 更新 README 功能特性**

在 `README.md` 的 `## 功能特性` 列表中，在 `- 🎯 **快捷分析**` 一行之后插入：

```markdown
- 🕵️ **AI Agent 自主排查**：一键触发固定流水线排查（错误定位 → 相似案例 → 同批次模式检测 → 知识库/维修模板 → 根因报告），过程实时流式可见；报告自动存入会话，可保存知识库/导出
```

- [ ] **Step 2: 后端全量测试**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/ -v`
Expected: 全部通过（21 个新测试 + 既有测试）

- [ ] **Step 3: 前端构建**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: 构建通过

- [ ] **Step 4: 手动冒烟（需 docker compose 环境，可选）**

```bash
cd /home/qim/code/ai-log-analyzer && docker compose up -d
```

- 访问 http://localhost:8880，登录后上传一份含错误的日志
- 点击日志面板"深度排查"：步骤时间线逐步亮起，进度消息实时出现，最终报告流式输出
- 关闭排查视图：报告作为最新一条 AI 消息出现在聊天历史
- 聊天输入 `/investigate` 发送：同样触发排查
- 排查中点"取消"：流水线停止，无报告写入会话

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add README.md
git commit -m "docs: README 增加 AI Agent 自主排查功能说明"
```

---

## Self-Review 记录

**1. Spec 覆盖检查：**
- 5 步流水线 → Task 1-5 ✅；流水线 runner（单步失败隔离/超时/取消/并发锁/兜底报告）→ Task 6 ✅；SSE 端点（双入参/归属校验/限流复用）→ Task 7 ✅；前端流式视图/双入口/取消 → Task 8-10 ✅；报告存为消息（复用保存/导出）→ Task 6 `_generate_report` ✅；README → Task 11 ✅
- Spec 中"每用户同时最多 1 个排查" → `AgentService._active_users` 内存锁 ✅（单容器部署与现有限流器 sqlite 后端一致；多副本场景的超用户并发属既有架构限制，不在本计划范围）
- Spec 中"单步 30s/整体 180s/证据截断" → Task 6 常量 + Task 1 常量 ✅

**2. 占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码。

**3. 类型一致性：**
- `StepResult.status` 取值 `ok/failed/skipped` 在步骤实现、runner、前端 `StepState` 三处一致 ✅
- SSE 事件字段（`type/step/title/message/status/summary/content/message_id`）后端 yield 与前端 `AgentEvent` 一致 ✅
- `AgentService._active_users` 被 Task 6 测试直接操作（`service._active_users.add("u1")`）✅
- 前端 store 的 `start/cancel/close` 与 Task 9/10 的消费点一致 ✅
