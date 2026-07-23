# Task 6 报告：agent_service 流水线 runner

## 实现内容

新建 `backend/app/services/agent_service.py`（自主排查流水线 orchestrator）与 `backend/tests/test_agent_service.py`。实现与测试均按 brief 逐字录入，无偏离。

`AgentService` 暴露：
- `is_active(user_id) -> bool`：查询每用户内存锁状态。
- `investigate(session_id, user_id) -> AsyncIterator[dict]`：async generator，按序 yield SSE 事件 dict（`step_start` / `step_progress` / `step_done` / `report_chunk` / `done` / `error`）。
- 模块常量 `STEPS`（4 个证据步骤元组）、`STEP_TIMEOUT = 30`、`TOTAL_TIMEOUT = 180`。
- 模块单例 `agent_service = AgentService()`。

流水线行为：
1. 并发检查：`user_id` 已在 `_active_users` 则立即 yield `error` 并 return（在 try 块之前，不会误释放既有锁）。
2. `_build_context`：拉取会话日志、机型、最近 10 条对话构建 `InvestigationContext`。
3. 依次跑 `STEPS` 中 4 个步骤，整体超时检查；每步 `_run_step` 转发进度。
4. `_generate_report`（步骤 5）：LLM 流式生成根因报告；失败或空回复降级为 `build_fallback_report`；报告存为 `MessageRole.ASSISTANT` 消息。
5. `finally` 释放用户锁。

异步进度转发核心：每个步骤在独立 `asyncio.Task` 中运行，`emit` 回调把进度 `put_nowait` 进 `asyncio.Queue`，主生成器以 50ms 轮询 `queue.get()` 实时 yield 进度事件，步骤结束后 drain 队列剩余项再 yield `step_done`。

## 测试与结果

聚焦测试（4 个，逐字照搬 brief）：
- `test_pipeline_event_sequence`：2 步骤 + 报告步骤，事件顺序、计数、报告落库、锁释放。
- `test_pipeline_step_failure_isolated`：步骤 1 抛异常不阻断步骤 2，failed step_done 精确归属。
- `test_pipeline_ai_failure_fallback_report`：AI 流抛错 -> 兜底报告，"本地兜底" 出现在 chunk 与落库内容。
- `test_pipeline_concurrent_user_rejected`：预占锁 -> 单个 error 事件。

### TDD 证据

**RED**

命令：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_service.py -v`

输出（节选）：
```
collected 0 items / 1 error
ERROR collecting tests/test_agent_service.py
tests/test_agent_service.py:10: in <module>
    from app.services import agent_service as agent_module
E   ImportError: cannot import name 'agent_service' from 'app.services'
1 error in 0.13s
```
原因：`agent_service.py` 尚未创建，模块不存在 —— 即 brief 预期的模块缺失失败（本机 Python 3.14 将其报为 `ImportError`，与 `ModuleNotFoundError` 同源，后者是前者的子类）。

**GREEN**

命令：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_service.py -v`

输出：
```
tests/test_agent_service.py::test_pipeline_event_sequence PASSED         [ 25%]
tests/test_agent_service.py::test_pipeline_step_failure_isolated PASSED  [ 50%]
tests/test_agent_service.py::test_pipeline_ai_failure_fallback_report PASSED  [ 75%]
tests/test_agent_service.py::test_pipeline_concurrent_user_rejected PASSED [100%]
4 passed in 0.32s
```

### 全量回归

命令：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest`

结果：`1 failed, 85 passed`。唯一失败为 `tests/test_resolved_path.py::test_rebuild_scans_configured_path`（`AttributeError: ... has no attribute 'get_resolved_base'`），即任务说明中标注的预存在无关失败，与本任务无关。新增 4 个用例全过，未影响其他用例。

## 改动文件

- 新增 `backend/app/services/agent_service.py`（184 行）
- 新增 `backend/tests/test_agent_service.py`（123 行）

提交：`b0d0974 feat: 自主排查流水线 runner`（分支 `feat/agent-investigation`）

## 自审：异步 / 取消 / 锁边界

逐项验证（结合代码静态推演 + 4 个测试覆盖）：

1. **事件顺序**（test_pipeline_event_sequence 覆盖）：每步 `step_start` -> 0..N 个 `step_progress`（emit 经 Queue 转发）-> `step_done`；报告步骤 `step_start(5)` -> `report_chunk`(s) -> `step_done(5)` -> `done`。`step_done` 前先 drain 队列（`while not queue.empty()`），保证进度不丢、不晚于 step_done。

2. **单步失败隔离**（test_pipeline_step_failure_isolated 覆盖）：`_call_step` 用 `try/except (asyncio.TimeoutError, Exception)` 兜住所有步骤异常，统一返回 `StepResult(status="failed", ...)`，永不向 `_run_step` 抛出。故 `task.result()` 恒返回 StepResult，`_run_step` 必 yield `step_done`（status=failed），`investigate` 主循环继续下一步。

3. **AI 失败兜底**（test_pipeline_ai_failure_fallback_report 覆盖）：`_generate_report` 以 `try/except Exception` 包住 `async for chunk in stream`。AI 抛错时 `got_content=False`、`full_report=""`，`if not full_report.strip()` 命中，改用 `build_fallback_report(ctx)` 并作为单个 `report_chunk` yield；兜底文案含"本地兜底"。stream 抛错后显式 `await stream.aclose()`（包在 try/except 内，二次失败不放大）。

4. **并发锁释放**（4 个测试均断言 `not service.is_active("u1")`，除并发拒绝用例外）：
   - 正常路径：`investigate` 的 `try/finally`，finally 执行 `discard`。
   - 步骤失败：异常在 `_call_step` 内被吞，不触发 finally 之外的抛出；finally 正常执行。
   - AI 失败：异常在 `_generate_report` 内被吞；finally 正常执行。
   - 并发拒绝：在 try 块之前 `yield error; return`，**不**进入 finally —— 这正是预期：被拒调用方从未获取锁，不应释放既有持有者的锁。test_pipeline_concurrent_user_rejected 预置 `service._active_users.add("u1")` 并断言仅返回 error 事件，验证了这一语义。
   - 整体超时 early-return：`yield error; return` 位于 try 块内，finally 执行释放锁。

5. **取消清理**（未被测试直接覆盖，静态推演）：`_run_step` 中 `except BaseException` 捕获 `GeneratorExit`/`CancelledError`，调用 `task.cancel()` 后 `raise` 向上传播；传播至 `investigate` 的 finally 释放锁。`task.cancel()` 对已完成任务是 no-op；对运行中任务调度取消，asyncio 事件循环持有 task 引用，不会被 GC 泄漏。

6. **进度 Queue 跨任务安全**：`asyncio.Queue` 支持跨 task `put_nowait` / `get`；`emit` 在步骤 task 内同步 put，主生成器 await get，无竞态。

### 已知次要边界（未修改，brief 逐字）

- `_generate_report` 中 `yield {"type": "report_chunk", ...}` 若在流式中途被消费方断开（`GeneratorExit`），`except Exception` 不捕获 `BaseException`，stream 不会被显式 `aclose()`。此时依赖外层 async generator 关闭时 Python 隐式清理 stream。仅影响"消费方在 AI 流式中途断连"这一未测试路径，正常 SSE 消费（含客户端取消经路由层取消整个 task）下由 `investigate` finally 释放锁、由 httpx 连接池回收连接，无资源硬泄漏。brief 指示逐字录入，未改动。
- 测试文件 `import pytest` 未被显式使用（无 mark/raises）。属 brief 原文，保留不动；不影响测试通过，ruff 不在测试链路。

## 结论

任务完成。4 个聚焦测试 RED->GREEN，全量套件仅余 1 个预存在无关失败。无偏离 brief 的改动，无需 NEEDS_CONTEXT。

## Fixes

针对 Task 6 review 发现的测试覆盖缺口，仅修改 `backend/tests/test_agent_service.py`（`agent_service.py` 未改动）。提交 `dc8397b test: 补充自主排查流水线中断路径与锁释放测试`。

### 改动内容（3 项）

1. **新增"AI 中途失败且已有部分内容 -> 追加'生成中断'提示"路径测试（Important）**
   - `test_agent_service.py:50-58` 新增 `_PartialFailAI` fake：`chat_stream` 先 `yield "## 🎯 故障部件定位\n部分内容"` 再 `raise RuntimeError("AI mid-stream down")`，与 `_FailAI`（抛错前不 yield 任何内容）形成互补。
   - `test_agent_service.py:126-140` 新增 `test_pipeline_ai_partial_failure_appends_interrupt_note`：经 `_patch_common(monkeypatch, _PartialFailAI())` + `STEPS=[(1, "步骤一", _ok_step)]` 驱动，拼接 `report_chunk` 内容后断言 `"生成中断" in report_text`、`"部分内容" in report_text`、`events[-1]["type"] == "done"`、`not service.is_active("u1")`。
   - 覆盖 `agent_service.py:164-167` 的 `if got_content:` 分支——此前 `_FailAI` 使 `got_content` 恒为 False，该分支从未被执行。

2. **为既有 AI 失败测试补锁释放断言（Important）**
   - `test_agent_service.py:122-123`：在 `test_pipeline_ai_failure_fallback_report` 末尾追加 `assert not service.is_active("u1")`，与其它用例一致，验证 AI 失败路径 `investigate` 的 `finally`（`agent_service.py:72-73`）释放了 per-user 锁。

3. **移除未使用的 `import pytest`（Minor）**
   - `test_agent_service.py:8`（原）：删除 `import pytest` 及其上方空行。该 import 无任何 mark/raises 引用。

### 测试结果

聚焦用例：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_service.py -v`

```
tests/test_agent_service.py::test_pipeline_event_sequence PASSED         [ 20%]
tests/test_agent_service.py::test_pipeline_step_failure_isolated PASSED  [ 40%]
tests/test_agent_service.py::test_pipeline_ai_failure_fallback_report PASSED  [ 60%]
tests/test_agent_service.py::test_pipeline_ai_partial_failure_appends_interrupt_note PASSED  [ 80%]
tests/test_agent_service.py::test_pipeline_concurrent_user_rejected PASSED [100%]
5 passed in 0.34s
```

全量回归：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/ -v` -> `1 failed, 86 passed`。唯一失败仍为预存在的 `tests/test_resolved_path.py::test_rebuild_scans_configured_path`（`AttributeError: 'module' object ... has no attribute 'get_resolved_base'`），与本任务无关。86 passed = 85（原）+ 1（新增用例）。

### 自审

- **"生成中断"路径是否被真实触发**：是。`_PartialFailAI` 先 yield 一个 chunk 使 `agent_service.py:150-151` 的 `got_content=True`，再 raise 进入 `except Exception`（`agent_service.py:157`），命中 `if got_content:`（`agent_service.py:164`）追加 `note = "\n\n> ⚠️ AI 生成中断，报告不完整"`（`agent_service.py:165-167`）。"生成中断" 字符串仅源自此处，`_FailAI` 路径（`got_content=False`）走兜底报告，不含该串，故断言非 mock 行为而是生产代码分支产物。
- **锁释放是否被真实验证**：是。`is_active` 读取真实 `AgentService._active_users` 集合；锁在 `investigate` 的 `try` 块开头 `add`（`agent_service.py:60`）、`finally` 中 `discard`（`agent_service.py:72-73`）。两条 AI 失败路径（无内容兜底 / 部分内容中断）的异常均在 `_generate_report`/`_call_step` 内被吞，不向上抛出，`finally` 正常执行。新增的 `test_pipeline_ai_partial_failure_appends_interrupt_note` 与补强的 `test_pipeline_ai_failure_fallback_report` 分别覆盖这两条路径的锁释放。
- **无生产代码改动**：`git diff dc8397b^ dc8397b -- backend/app/services/agent_service.py` 为空，仅 `backend/tests/test_agent_service.py` 变更（+30/-2）。
