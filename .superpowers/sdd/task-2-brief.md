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

