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

