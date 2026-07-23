# Task 7 报告：agent_routes + main.py 注册

## What I Implemented

Task 7 将 Task 1-6 构建的排查流水线接到 HTTP，提供 SSE 流式端点。

1. **新建 `backend/app/routes/agent_routes.py`**：`POST /investigate` 路由。
   - 从 `request.state.user` 取用户（由 AuthMiddleware 注入）。
   - 校验 `session_id`/`log_id` 二选一，否则 `ValidationError`。
   - `session_id` 入口调 `require_session_owner`；`log_id` 入口调 `require_log_owner` 并经 `log_repository.get_by_id` 解析出 `session_id`。
   - 校验会话下日志非空（`log_service.get_logs_by_session`），否则 `ValidationError`。
   - 经 `agent_service.is_active` 做并发互斥，否则 `ValidationError`。
   - `generate()` 异步生成器消费 `agent_service.investigate`，逐事件用 `_sse_event` 格式化；异常兜底发 `error` + `done`。
   - 返回 `StreamingResponse`，`media_type="text/event-stream"` + 缓冲禁用相关 headers。
   - SSE 格式：`f"data: {json.dumps(data, ensure_ascii=False)}\n\n"`，与 chat 路由一致。

2. **修改 `backend/app/main.py`**（2 处精确插入，均位于 `anomaly_*` 之前以保持字母序）：
   - 第 174 行：`from app.routes.agent_routes import router as agent_router`
   - 第 196 行：`app.include_router(agent_router, prefix="/api/agent", tags=["AI 自主排查"])`

3. **新建 `backend/tests/test_agent_routes.py`**：5 个测试，按 brief 给定代码（含一处最小修复，见下）。

## What I Tested and Test Results

- 聚焦测试（5 项）：全部通过。
- 全量后端测试：91 passed, 1 failed。唯一的失败是预先存在、与本次无关的 `tests/test_resolved_path.py::test_rebuild_scans_configured_path`（brief 明确要求忽略）。无回归。

## TDD Evidence

### RED

命令：
```
cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_routes.py -v
```

输出（关键行）：
```
tests/test_agent_routes.py:14: in <module>
    from app.routes import agent_routes
E   ImportError: cannot import name 'agent_routes' from 'app.routes'
=========================== short test summary info ============================
ERROR tests/test_agent_routes.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
=============================== 1 error in 0.32s ===============================
```

为什么是预期的：路由模块尚未创建，测试模块导入即失败（与 brief 预期的 `ModuleNotFoundError` 等价——同为模块不存在导致的导入错误）。

### GREEN

命令：
```
cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_routes.py -v
```

输出：
```
tests/test_agent_routes.py::test_investigate_requires_one_id PASSED      [ 20%]
tests/test_agent_routes.py::test_investigate_rejects_when_active PASSED  [ 40%]
tests/test_agent_routes.py::test_investigate_rejects_without_logs PASSED [ 60%]
tests/test_agent_routes.py::test_investigate_streams_sse_by_session_id PASSED [ 80%]
tests/test_agent_routes.py::test_investigate_accepts_log_id PASSED       [100%]
============================== 5 passed in 0.31s ===============================
```

## Files Changed

- `backend/app/routes/agent_routes.py`（新建，95 行）
- `backend/app/main.py`（+2 行）：
  - 第 174 行：`from app.routes.agent_routes import router as agent_router`
  - 第 196 行：`app.include_router(agent_router, prefix="/api/agent", tags=["AI 自主排查"])`
- `backend/tests/test_agent_routes.py`（新建，含一处最小修复）

## Self-Review Findings

- **main.py 插入位置正确**：import 行与 include_router 行均紧贴 `anomaly_*` 之前，保持字母序（agent < anomaly）；两行各出现一次，无重复。
- **路由校验完整**：二选一入口校验、归属校验（session/log 两条路径）、日志存在校验、并发互斥校验均落实。
- **SSE 格式匹配**：`data: {json.dumps(data, ensure_ascii=False)}\n\n`，与 brief 及 chat 路由一致；测试断言 `text.startswith("data: ")` 与 `text.endswith("\n\n")` 通过。
- **TDD 流程**：先写测试 → 确认 RED → 实现 + 注册 → 确认 GREEN → 全量回归。
- **约束遵守**：Python ≥ 3.11；pytest-asyncio auto；未新增依赖；中文模块 docstring；中文 conventional 提交（feat:）；工作分支 `feat/agent-investigation`。

## Issues or Concerns

### 一处 verbatim 测试缺陷的最小修复（已按 brief 授权处理并标记）

`test_investigate_accepts_log_id`（brief 原文）断言 `used["session_id"] == "sess-1"`，但从未消费 `resp.body_iterator`。由于 `generate()` 是惰性异步生成器，`agent_service.investigate()`（在 `_RecordingAgent` 内同步记录 `session_id`）只有在迭代 body 时才会被调用，因此 `used` 永远为空，测试必然以 `KeyError` 失败。

实测验证了这一点：未修改前该测试报 `KeyError: 'session_id'`（4 passed, 1 failed）。

最小修复（保留测试意图，仅触发生成器执行）：在断言前加一行消费 body 迭代器：
```python
    # generate() 是惰性异步生成器，需消费 body_iterator 才会触发
    # agent_service.investigate() 调用并记录 session_id
    _ = [c async for c in resp.body_iterator]
    assert used["session_id"] == "sess-1"   # 来自 fake log_repository
```

修复后 5 项全部通过。该修复仅作用于测试自身，不改变路由实现或测试的断言语义。
