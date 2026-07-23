# 维修 SOP 自动生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 输入机型号+故障描述，自动搜索知识库（已解决案例/维修模板/Linux命令/历史会话），LLM 合成标准维修 SOP，SSE 流式返回。

**Architecture:** 后端 `sop_service.py`（3 步流水线：并行检索→证据聚合→LLM 合成）+ `sop_routes.py`（SSE 端点）；前端复用 InvestigationView 组件（不改），ChatPanel 加 `/sop` 命令，KnowledgePage 加「生成 SOP」按钮。

**Tech Stack:** FastAPI + asyncio + SSE（后端），React + zustand（前端），pytest + pytest-asyncio（测试）。

**Spec:** `docs/superpowers/specs/2026-07-23-sop-generation-design.md`

## Global Constraints

- Python ≥ 3.11；pytest-asyncio 已配置 `asyncio_mode = "auto"`，async 测试直接写 `async def test_...`
- **不新增任何依赖**（前后端都不加包）
- 后端风格：模块级中文 docstring；重依赖函数级懒加载；服务用模块级单例
- SSE 事件格式：`data: {json.dumps(data, ensure_ascii=False)}\n\n`（与 Agent 排查一致）
- SOP 报告通过 `message_service.create_message(session_id, MessageRole.ASSISTANT, content)` 存为会话消息
- 超时：单步 20s / 整体 60s
- 前端复用 InvestigationView 组件（不改），investigationStore 增加 `startSOP` action
- 前端无需测试框架：验证方式 `cd frontend && npm run build`（tsc + vite）通过
- 后端测试在 `backend/tests/` 下新增
- git 提交信息：中文，conventional 前缀（`feat:` / `test:` / `docs:`）

---

### Task 1: sop_service.py（3 步流水线 + LLM 合成）

**Files:**
- Create: `backend/app/services/sop_service.py`
- Test: `backend/tests/test_sop_service.py`

**Interfaces:**
- Consumes: `obsidian_service.search_notes(query) -> list[{filename, title, snippet}]`（async）；`repair_template_service.list(model, limit) -> list[{text, model, count}]`（sync）；`search_linux_knowledge(query, limit) -> list[{title, content, category}]`（sync）；`session_repository.list_all(model=..., limit=...) -> list[Session]`（sync）；`ai_service.chat_stream(messages, temperature) -> AsyncIterator[str]`（async）；`message_service.create_message(session_id, role, content) -> Message`（sync）
- Produces: `sop_service` 单例：`generate_sop(model: str, fault: str, session_id: str) -> AsyncIterator[dict]`（yield SSE 事件 dict：`step_start/step_progress/step_done/report_chunk/done`）；内部常量 `STEPS: list[tuple[int, str, Callable]]`、`STEP_TIMEOUT = 20`、`TOTAL_TIMEOUT = 60`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_sop_service.py`：

```python
"""
sop_service 流水线单元测试
"""

import sys
from types import SimpleNamespace

import pytest

from app.services import sop_service as sop_module
from app.services.sop_service import SopService


def _patch_all(monkeypatch, fake_obsidian, fake_templates, fake_linux, fake_sessions, fake_ai):
    """假数据源 + 假 AI + 假消息服务"""
    monkeypatch.setitem(sys.modules, "app.services.obsidian_service", SimpleNamespace(
        obsidian_service=SimpleNamespace(search_notes=fake_obsidian)
    ))
    monkeypatch.setitem(sys.modules, "app.services.repair_template_service", SimpleNamespace(
        repair_template_service=SimpleNamespace(list=fake_templates)
    ))
    monkeypatch.setitem(sys.modules, "app.services.linux_knowledge_service", SimpleNamespace(
        search_linux_knowledge=fake_linux
    ))
    monkeypatch.setitem(sys.modules, "app.repositories.session_repository", SimpleNamespace(
        session_repository=SimpleNamespace(list_all=fake_sessions)
    ))
    monkeypatch.setitem(sys.modules, "app.services.ai_service", SimpleNamespace(
        ai_service=fake_ai
    ))
    saved: list[str] = []
    monkeypatch.setattr(sop_module, "message_service", SimpleNamespace(
        create_message=lambda session_id, role, content: saved.append(content) or SimpleNamespace(id="msg-1")
    ))
    return saved


class _OkAI:
    def chat_stream(self, messages, temperature=0.7):
        async def gen():
            yield "## 🎯 故障概述\n内存ECC 是 DDR5 常见可纠正错误"
        return gen()


async def _collect(svc: SopService, model="7500S", fault="内存ECC", session_id="sess-1"):
    return [e async for e in svc.generate_sop(model, fault, session_id)]


async def _async_search(query):
    return [{"filename": "case1.md", "title": "DIMM 故障", "snippet": "换内存解决"}]


async def test_sop_event_sequence(monkeypatch):
    saved = _patch_all(
        monkeypatch,
        fake_obsidian=_async_search,
        fake_templates=lambda model=None, limit=50: [{"text": "重插拔内存条", "model": "7500S", "count": 3}],
        fake_linux=lambda query, limit=5: [{"title": "内存ECC检查", "content": "dmesg | grep ECC", "category": "内存"}],
        fake_sessions=lambda model=None, limit=100, offset=0, status=None, q=None: [],
        fake_ai=_OkAI(),
    )
    svc = SopService()
    events = await _collect(svc)

    types = [e["type"] for e in events]
    assert types[0] == "step_start"
    assert types.count("step_start") == 3   # 知识检索 + 证据聚合 + SOP 合成
    assert types.count("step_done") == 3
    assert "report_chunk" in types
    assert types[-1] == "done"
    assert saved and "故障概述" in saved[0]


async def test_sop_ai_failure_fallback(monkeypatch):
    class _FailAI:
        def chat_stream(self, messages, temperature=0.7):
            async def gen():
                raise RuntimeError("AI down")
                yield  # pragma: no cover
            return gen()

    saved = _patch_all(
        monkeypatch,
        fake_obsidian=_async_search,
        fake_templates=lambda model=None, limit=50: [{"text": "重插拔", "model": "7500S", "count": 1}],
        fake_linux=lambda query, limit=5: [],
        fake_sessions=lambda **kw: [],
        fake_ai=_FailAI(),
    )
    svc = SopService()
    events = await _collect(svc)

    report = "".join(e.get("content", "") for e in events if e["type"] == "report_chunk")
    assert "兜底" in report or "SOP" in report  # fallback 报告
    assert saved
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_sop_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.sop_service'`

- [ ] **Step 3: 实现 sop_service.py**

创建 `backend/app/services/sop_service.py`：

```python
"""
维修 SOP 自动生成 —— 3 步流水线

1. 知识检索：并行查 4 个数据源（已解决案例/维修模板/Linux 命令/历史会话）
2. 证据聚合：去重 + 排序 + 截断
3. LLM 合成：流式生成结构化 SOP + 兜底模板
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable

from app.models.message import MessageRole
from app.services.message_service import message_service

logger = logging.getLogger(__name__)

STEP_TIMEOUT = 20       # 单步超时（秒）
TOTAL_TIMEOUT = 60      # 整体超时（秒）

STEPS: list[tuple[int, str, Callable]] = [
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
                for s in raw_sessions[:EVIDENCE_LIMIT["history_sessions"]] if s.id != results.get("_exclude_session_id")
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

        message = message_service.create_message(
            session_id=session_id,
            role=MessageRole.ASSISTANT,
            content=full_report,
        )
        yield {"type": "step_done", "step": 3, "status": "ok", "summary": "SOP 已生成"}
        yield {"type": "done", "message_id": message.id}

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
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_sop_service.py -v`
Expected: 2 passed

- [ ] **Step 5: 跑全量后端测试确认无回归**

Run: `cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/ -q 2>&1 | tail -2`
Expected: 1 failed（既有 test_resolved_path）+ N passed

- [ ] **Step 6: 提交**

```bash
git -C /home/qim/code/ai-log-analyzer add backend/app/services/sop_service.py backend/tests/test_sop_service.py
git -C /home/qim/code/ai-log-analyzer commit -m "feat: SOP 生成服务——3步流水线（检索/聚合/合成）"
```

---

### Task 2: sop_routes + main.py 注册

**Files:**
- Create: `backend/app/routes/sop_routes.py`
- Modify: `backend/app/main.py`（2 行插入）
- Test: `backend/tests/test_sop_routes.py`

**Interfaces:**
- Consumes: `sop_service.generate_sop(model, fault, session_id) -> AsyncIterator[dict]`（Task 1）；`app.middlewares.error_handler.ValidationError`（FastAPI）
- Produces: `POST /api/sop/generate`（SSE）；请求体 `{model: str, fault: str}`

- [ ] **Step 1-3: TDD 测试 → RED → 实现**

创建 `backend/app/routes/sop_routes.py`：

```python
"""
维修 SOP 生成路由

POST /api/sop/generate —— 输入机型号 + 故障描述，SSE 流式返回标准维修 SOP。
"""

import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.middlewares.error_handler import ValidationError
from app.services.sop_service import sop_service

logger = logging.getLogger(__name__)

router = APIRouter()


class GenerateSopRequest(BaseModel):
    model: str
    fault: str


@router.post("/generate")
async def generate_sop(body: GenerateSopRequest, request: Request):
    if not body.model.strip() or not body.fault.strip():
        raise ValidationError("机型号和故障描述都不能为空")

    user_id = request.state.user.id

    async def generate():
        try:
            async for event in sop_service.generate_sop(
                model=body.model.strip(),
                fault=body.fault.strip(),
                session_id=None,  # SOP 不绑定会话
            ):
                yield _sse_event(event)
        except Exception as e:
            logger.exception(f"SOP 生成异常: {e}")
            yield _sse_event({"type": "error", "message": "SOP 生成服务异常，请稍后重试"})
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
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
```

修改 `backend/app/main.py`：

在 import 区（`from app.routes.anomaly_routes import ...` 之前）加：
```python
from app.routes.sop_routes import router as sop_router
```

在 include_router 区（`app.include_router(anomaly_router, ...)` 之前）加：
```python
app.include_router(sop_router, prefix="/api/sop", tags=["SOP 生成"])
```

创建 `backend/tests/test_sop_routes.py`：

```python
"""
sop_routes 路由单元测试
"""

from types import SimpleNamespace

import pytest

from app.middlewares.error_handler import ValidationError
from app.routes.sop_routes import generate_sop, GenerateSopRequest


def _req():
    return SimpleNamespace(state=SimpleNamespace(user=SimpleNamespace(id="u1")))


async def test_empty_model_rejected():
    with pytest.raises(ValidationError, match="不能为空"):
        await generate_sop(GenerateSopRequest(model="", fault="内存ECC"), _req())


async def test_empty_fault_rejected():
    with pytest.raises(ValidationError, match="不能为空"):
        await generate_sop(GenerateSopRequest(model="7500S", fault=""), _req())
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_sop_routes.py -v`
Expected: 2 passed

- [ ] **Step 5: 全量测试 + 提交**

Run: `cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/ -q 2>&1 | tail -2`

```bash
git -C /home/qim/code/ai-log-analyzer add backend/app/routes/sop_routes.py backend/app/main.py backend/tests/test_sop_routes.py
git -C /home/qim/code/ai-log-analyzer commit -m "feat: SOP 生成路由与注册"
```

---

### Task 3: 前端 sopService.ts + investigationStore sop mode

**Files:**
- Create: `frontend/src/services/sopService.ts`
- Modify: `frontend/src/stores/investigationStore.ts`（加 `startSOP` action）
- Modify: `frontend/src/services/index.ts`（加导出线）

**Interfaces:**
- Consumes: `http.stream(path, body, signal)`（`frontend/src/services/http.ts`）；`useChatStore.getState().fetchMessages(sessionId)`（现有）
- Produces: `sopService.generate(model, fault, signal) -> AsyncGenerator<AgentEvent>`；`useInvestigationStore.startSOP(model, fault, sessionId)`（复用同样的 SSE 事件处理器）

- [ ] **Step 1: 创建 sopService.ts**

```typescript
/**
 * 维修 SOP 生成 API（SSE 流式）
 */

import { http } from './http';
import type { AgentEvent } from './agentService';

/**
 * 生成维修 SOP
 * @param signal 用于取消（AbortController）
 */
export async function* generateSOP(
  model: string,
  fault: string,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  yield* http.stream('/sop/generate', { model, fault }, signal) as unknown as AsyncGenerator<AgentEvent>;
}

export const sopService = { generate: generateSOP };
```

- [ ] **Step 2: investigationStore 加 startSOP action**

在 `frontend/src/stores/investigationStore.ts` 中加：

(a) import 区追加（在 `import { agentService } from '@/services/agentService';` 之后）：
```typescript
import { sopService } from '@/services/sopService';
```

(b) 在 `start: async (sessionId) => { ... }` 之后，追加 `startSOP` action：

```typescript
  startSOP: async (model, fault, sessionId) => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    set({ active: true, running: true, sessionId, steps: [], report: '', error: null });

    const updateStep = (num: number, patch: Partial<StepState>) =>
      set((s) => ({ steps: s.steps.map((st) => (st.step === num ? { ...st, ...patch } : st)) }));

    const appendStepMessage = (num: number, message: string) =>
      set((s) => ({ steps: s.steps.map((st) => (st.step === num ? { ...st, messages: [...st.messages, message] } : st)) }));

    try {
      for await (const event of sopService.generate(model, fault, signal)) {
        switch (event.type) {
          case 'step_start':
            set((s) => ({ steps: [...s.steps, { step: event.step!, title: event.title || '', status: 'running', messages: [] }] }));
            break;
          case 'step_progress': appendStepMessage(event.step!, event.message || ''); break;
          case 'step_done': updateStep(event.step!, { status: event.status || 'ok', summary: event.summary }); break;
          case 'report_chunk': set((s) => ({ report: s.report + (event.content || '') })); break;
          case 'error': set({ error: event.message || 'SOP 生成失败' }); break;
          case 'done': break;
        }
      }
    } catch (err: unknown) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      set({ running: false });
      if (aborted) return;
      set({ error: (err as Error)?.message || '连接失败' });
      return;
    }
    set({ running: false });
    const sid = get().sessionId;
    if (sid) { useChatStore.getState().fetchMessages(sid).catch(() => {}); }
  },
```

(c) 在 interface `InvestigationState` 中加：
```typescript
  startSOP: (model: string, fault: string, sessionId: string) => Promise<void>;
```

(d) `frontend/src/services/index.ts` 追加：
```typescript
export * from './sopService';
```

- [ ] **Step 3: 构建验证**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: tsc + vite 通过

- [ ] **Step 4: 提交**

```bash
git -C /home/qim/code/ai-log-analyzer add frontend/src/services/sopService.ts frontend/src/stores/investigationStore.ts frontend/src/services/index.ts
git -C /home/qim/code/ai-log-analyzer commit -m "feat: 前端 SOP 服务与 store SOP mode"
```

---

### Task 4: ChatPanel /sop 命令

**Files:**
- Modify: `frontend/src/components/chat/ChatPanel.tsx`

**Changes:** 在 `handleSend` 中检测 `/sop` 前缀，提取机型号（第一个空格后的词）和故障描述（其余），调用 `startSOP`。

- [ ] **Step 1: 修改 ChatPanel**

在 `handleSend` 函数中，`/investigate` 检测之后加：

```typescript
  // /sop 命令：生成维修 SOP
  if (content.trim().startsWith('/sop ')) {
    const parts = content.trim().slice(5).trim();
    const spaceIdx = parts.indexOf(' ');
    const model = spaceIdx > 0 ? parts.slice(0, spaceIdx).trim() : parts.trim();
    const fault = spaceIdx > 0 ? parts.slice(spaceIdx + 1).trim() : '';
    if (model && fault && !streaming) {
      await startSOP(model, fault, sessionId);
    }
    return;
  }
```

(b) 同组件内取 `startSOP`：
```typescript
  const startSOP = useInvestigationStore((s) => s.startSOP);
```

- [ ] **Step 2: 构建验证**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git -C /home/qim/code/ai-log-analyzer add frontend/src/components/chat/ChatPanel.tsx
git -C /home/qim/code/ai-log-analyzer commit -m "feat: ChatPanel /sop 命令——输入机型+故障生成SOP"
```

---

### Task 5: KnowledgePage SOP 按钮 + 弹窗

**Files:**
- Modify: `frontend/src/pages/KnowledgePage.tsx`

**Changes:** Header 区加「生成 SOP」按钮 → 弹窗填机型+故障 → 点生成触发 `startSOP`。

- [ ] **Step 1: 修改 KnowledgePage**

(a) import 区追加：
```typescript
import { FileText as FileTextIcon } from 'lucide-react';
// 或直接用已有的 FileText 别名 import——已有 FileText，直接复用
import { useInvestigationStore } from '@/stores/investigationStore';
```

实际上 FileText 已被 import（line 9），不需要新加。

(b) 加 `SOPDialog` 子组件（在 KnowledgePage 文件内，仿 EmptyState 的 CreateSessionDialog 模式）：

在 `KnowledgePage` return 之前加：
```typescript
  const [sopOpen, setSopOpen] = useState(false);
  const [sopModel, setSopModel] = useState('');
  const [sopFault, setSopFault] = useState('');
  const startSOP = useInvestigationStore((s) => s.startSOP);
```

Header 区（return 按钮 + tab 行之后，refresh 按钮之前）加：
```tsx
<button
  onClick={() => setSopOpen(true)}
  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
>
  <ClipboardList size={13} /> 生成 SOP
</button>
```

(c) 弹窗（在 return 的三个 view tab 之前加）：
```tsx
{/* SOP 生成弹窗 */}
{sopOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSopOpen(false)} />
    <div className="relative bg-card border border-border rounded-2xl shadow-lg w-full max-w-md mx-4 p-5 space-y-4">
      <h3 className="font-semibold text-sm">生成维修 SOP</h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">机型</label>
          <input value={sopModel} onChange={e => setSopModel(e.target.value)}
            placeholder="如 7500S" list="model-suggestions"
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">故障描述</label>
          <input value={sopFault} onChange={e => setSopFault(e.target.value)}
            placeholder="如 内存ECC"
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => setSopOpen(false)}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80">取消</button>
        <button
          onClick={() => {
            if (sopModel.trim() && sopFault.trim()) {
              startSOP(sopModel.trim(), sopFault.trim(), '');
              setSopOpen(false);
            }
          }}
          disabled={!sopModel.trim() || !sopFault.trim()}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
          生成
        </button>
      </div>
    </div>
  </div>
)}
```

需要加 `ClipboardList` 到 import（从 lucide-react 现有 import 行追加 `ClipboardList`）。

- [ ] **Step 2: 构建验证**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git -C /home/qim/code/ai-log-analyzer add frontend/src/pages/KnowledgePage.tsx
git -C /home/qim/code/ai-log-analyzer commit -m "feat: KnowledgePage 生成SOP按钮+弹窗"
```

---

### Task 6: README 更新 + 全量验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 功能特性加一行**

在 `- 🕵️ **AI Agent 自主排查**` 之后插入：
```markdown
- 📋 **维修 SOP 自动生成**：输入机型号 + 故障描述，自动搜索知识库生成标准维修作业程序（诊断命令 → 维修流程 → 注意事项），聊天 `/sop` 命令或知识库页一键生成
```

- [ ] **Step 2: 后端全量测试**

Run: `cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/ -q 2>&1 | tail -2`
Expected: 新测试通过

- [ ] **Step 3: 前端构建**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git -C /home/qim/code/ai-log-analyzer add README.md
git -C /home/qim/code/ai-log-analyzer commit -m "docs: README 增加 维修SOP自动生成 功能说明"
```
