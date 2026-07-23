# Task 2 报告：步骤 2（相似案例检索）

## 实现内容

在 `backend/app/services/agent_steps.py` 末尾追加 `run_similar_cases(ctx, emit) -> StepResult`：

- 无 `top_patterns` 时返回 `status="skipped"`（不触碰向量库）
- 懒加载 `vector_store`（chromadb 重依赖，函数级 import）
- 以 `"\n".join(top_patterns)` 为查询文本，`limit=SIMILAR_CASES_LIMIT(5)`，`exclude_id` 取当前首个日志 id
- 结果写入 `ctx.similar_cases: [{log_id, similarity, preview}]`，preview 截断到 `SIMILAR_PREVIEW_CHARS(500)` 字符，`None` 安全（`or ""`）
- 空结果：emit 提示 + 返回 `ok` / "无相似历史案例"
- 有结果：emit "找到 N 个相似案例，最高相似度 X.XX"，summary 同步

在 `backend/tests/test_agent_steps.py` 末尾追加 3 个测试（按任务书原文）：`_FakeVectorStore` + `_patch_vector_store`（sys.modules 注入假模块，避免真 import chromadb）、`test_similar_cases_found`（含 500 字符截断言）、`test_similar_cases_empty`、`test_similar_cases_skipped_without_patterns`。

## 与任务书的唯一偏差（有意为之）

任务书给出的实现把懒加载 import 放在函数首行、skip 判断**之前**；但 skip 测试未 patch `sys.modules`，且 venv 中未安装 chromadb，导致该测试 `ModuleNotFoundError: No module named 'chromadb'`（1 failed, 5 passed）。

修复：将 `from app.services.vector_store import vector_store` 移到 skip 提前返回**之后**。测试代码保持任务书原文逐字不变；非 skip 路径行为与任务书完全一致，懒加载约束不变。

## 测试与结果

### TDD Evidence — RED

```
$ cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v -k similar
tests/test_agent_steps.py:89: in <module>
    from app.services.agent_steps import run_similar_cases
E   ImportError: cannot import name 'run_similar_cases' from 'app.services.agent_steps'
=============================== 1 error in 0.35s ===============================
```

预期内失败：实现尚未追加，`run_similar_cases` 不存在，与任务书 "Expected: FAIL — ImportError" 一致。

### TDD Evidence — GREEN

```
$ cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v
tests/test_agent_steps.py::test_error_extraction_clusters_errors PASSED
tests/test_agent_steps.py::test_error_extraction_no_error_lines PASSED
tests/test_agent_steps.py::test_error_extraction_empty_content_fails PASSED
tests/test_agent_steps.py::test_similar_cases_found PASSED
tests/test_agent_steps.py::test_similar_cases_empty PASSED
tests/test_agent_steps.py::test_similar_cases_skipped_without_patterns PASSED
============================== 6 passed in 0.27s ===============================
```

### 全量后端测试（提交前）

```
$ cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/ -v
1 failed, 71 passed in 0.57s
FAILED tests/test_resolved_path.py::test_rebuild_scans_configured_path
```

唯一失败为任务书已声明的、与本任务无关的预存失败（`get_resolved_base` 属性缺失），基线未变化。

## 变更文件

- `backend/app/services/agent_steps.py`（+26 行：追加 `run_similar_cases`）
- `backend/tests/test_agent_steps.py`（+77 行：追加步骤 2 测试）

提交：`e2186b9 feat: 自主排查相似案例检索步骤`（分支 feat/agent-investigation）

## 自审

- **完整性**：接口与任务书一致（签名、StepResult 契约、ctx.similar_cases 结构、preview ≤500、常量复用）；skip/空/命中三路径全覆盖。
- **质量**：中文 docstring、函数级懒加载、无新依赖、风格与步骤 1 一致；`r.get("preview") or ""` 对缺失/None preview 安全。
- **纪律**：严格 TDD（RED→GREEN）；仅改两个指定文件；中文 conventional 提交；直接提交到 feat/agent-investigation。
- **测试**：聚焦 6/6 通过；全量仅预存无关失败。

## 问题与顾虑

- 唯一偏差（import 位置下移两行）已在上文说明；若后续任务在 venv 安装 chromadb，该偏差亦无影响。
