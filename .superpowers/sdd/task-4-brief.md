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

