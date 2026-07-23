# Task 3 报告：步骤 3（同批次模式检测）

## 实现内容

在 `backend/app/services/agent_steps.py` 末尾追加 `run_batch_pattern(ctx, emit) -> StepResult`：

- 无机型 / 无错误模式 → `skipped`（两个 early-return 均不触发任何仓库 import）
- 调 `session_repository.list_all(model=ctx.session_model, limit=50)`，排除当前会话后取前 `BATCH_SESSIONS_LIMIT`(20) 个同机型会话
- 逐会话读取日志（`log_repository.get_by_session` + `log_service.get_log_content`），对错误行做 `normalize_line`，与 `ctx.top_patterns` 求交集；命中即记录机器标识（`sn or title or id[:8]`），每 5 个会话 emit 一次进度
- 填充 `ctx.batch_result = {model, checked_sessions, matched_count, matched_machines[:10], is_batch}`，其中 `is_batch = matched_count >= 1`（其他机器 ≥1 台相同 → 连本机 ≥2 台，满足升级 WWWTE 条件）
- 有命中 → summary `同批次 N 台相同模式（含本机）`；无命中 → `单台偶发（检查 N 个同机型会话）`

**与 brief 的唯一偏差（按 Task 1-2 先例）**：brief 中三个函数级 import 位于函数体顶部、skip 分支之前；已移至两个 skip early-return 之后，保证 skip 路径不 import 仓库依赖（与 `run_similar_cases` 中 vector_store 懒加载的位置一致）。已实测验证：model=None 时调用后 `app.repositories.session_repository` / `app.repositories.log_repository` 均未进入 `sys.modules`。

测试代码严格按 brief 原文追加，未改动。

## 测试结果

### TDD Evidence — RED

命令：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v -k batch`

输出（截选）：
```
tests/test_agent_steps.py:156: in <module>
    from app.services.agent_steps import run_batch_pattern
E   ImportError: cannot import name 'run_batch_pattern' from 'app.services.agent_steps'
=============================== 1 error in 0.43s ===============================
```
符合预期：函数尚未实现，收集阶段 ImportError。

### TDD Evidence — GREEN

命令：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v`

输出：
```
tests/test_agent_steps.py::test_error_extraction_clusters_errors PASSED
tests/test_error_extraction_no_error_lines PASSED
tests/test_error_extraction_empty_content_fails PASSED
tests/test_similar_cases_found PASSED
tests/test_similar_cases_empty PASSED
tests/test_similar_cases_skipped_without_patterns PASSED
tests/test_batch_pattern_detects_batch PASSED
tests/test_batch_pattern_single_occurrence PASSED
tests/test_batch_pattern_skipped_without_model PASSED
============================== 9 passed in 0.26s ===============================
```
与 brief 预期（9 passed）一致。

### 全量后端测试

命令：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest`

结果：`1 failed, 74 passed in 0.53s`。唯一失败为 `tests/test_resolved_path.py::test_rebuild_scans_configured_path`（monkeypatch `repair_template_service.get_resolved_base` 不存在），即任务上下文中声明的既有无关失败，与本任务改动文件无关，按要求忽略。

## 变更文件

- `/home/qim/code/ai-log-analyzer/backend/app/services/agent_steps.py`（+59 行，追加 `run_batch_pattern`）
- `/home/qim/code/ai-log-analyzer/backend/tests/test_agent_steps.py`（+111 行，追加 3 个步骤 3 测试及 `_session` / `_patch_batch_repos` 辅助函数）

提交：`86b6890 feat: 自主排查同批次模式检测步骤`（分支 `feat/agent-investigation`，仅含上述两文件）

## 自评

- **完整性**：`batch_result` 五个键全部填充；`is_batch` 语义与 brief 一致（≥1 台其他机器）；skip/命中/未命中三条路径均有测试覆盖。
- **质量**：中文 docstring；复用模块级 `log_service` 与 Task 1 常量 `BATCH_SESSIONS_LIMIT`；无新增依赖；进度消息（每 5 个会话）与结果消息齐全。
- **纪律**：TDD 先红后绿；测试代码逐字采用 brief；唯一偏差（import 位置）遵循 Task 1-2 先例并已实测验证；提交信息为中文 conventional（feat:），工作分支正确。
- **测试**：聚焦 9/9 通过；全量仅既有无关失败。

## 问题与顾虑

无。`session_repository.list_all` 真实签名为 `list_all(limit=100, offset=0, model=None, ...)`，支持关键字调用 `list_all(model=..., limit=50)`，与实现兼容；测试中的假仓库 lambda 同样兼容。
