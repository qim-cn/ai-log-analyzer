# Task 1 报告：后端请求类型 + agent_steps 骨架与步骤 1（错误定位）

## 实现内容

1. `backend/app/types/agent_types.py` — `InvestigateRequest`（session_id / log_id 二选一），与现有 `log_types.py` 等风格一致（模块级中文 docstring + Pydantic BaseModel）。
2. `backend/app/services/agent_steps.py` — 排查流水线骨架：
   - 常量区（SIMILAR_CASES_LIMIT / KNOWLEDGE_REFS_LIMIT 等 6 个证据截断上限）
   - `Emit = Callable[[str], None]` 类型别名
   - `StepResult` dataclass（status / summary / error）
   - `InvestigationContext` dataclass（输入字段 + 步骤 1~4 证据字段，default_factory）
   - `run_error_extraction(ctx, emit)`：合并前 5 个日志内容（单份 50000 字符、合并 100000 字符上限）→ `error_cluster_service.cluster_errors(limit=10)` → 写回 `ctx.error_clusters` / `ctx.top_patterns`（前 3 个模式）→ emit 进度消息 → 返回 StepResult（0 错误行时 summary 为"未发现错误行，将生成日志概况报告"）。
3. `backend/tests/test_agent_steps.py` — 3 个 async 测试（pytest-asyncio auto 模式，无 marker）。

## 与 brief 的唯一偏差（必要修正，需知悉）

brief 给的实现代码与它自己的测试 `test_error_extraction_empty_content_fails` 矛盾：

- 测试中空内容 LogFile（content=""）经 `log_service.get_log_content` 后返回兜底占位串 `"(文件内容不可用)"`（log_service.py:278），是非空字符串；
- 按 brief 逐字实现 `if content: contents.append(content)`，占位串会被当作真实日志，`merged` 非空 → 走聚类 → 0 错误行 → 返回 `status="ok"`，测试断言 `failed` 失败。

修正（不改 log_service，因其被列为"不要修改"的既有服务）：在 agent_steps 中新增模块级常量 `UNAVAILABLE_PLACEHOLDER = "(文件内容不可用)"`（带注释说明与 log_service 兜底串保持一致），收集内容时过滤：

```python
if content and content.strip() != UNAVAILABLE_PLACEHOLDER:
    contents.append(content)
```

这样空/不可用日志 → merged 为空 → 返回 `StepResult(status="failed", summary="日志内容不可用", error="empty content")`，符合 brief 意图。其余代码与 brief 逐字一致。

## TDD 证据

### RED

命令：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v`

输出（预期内失败，与 brief Step 2 预期完全一致）：

```
tests/test_agent_steps.py:6: in <module>
    from app.services.agent_steps import (
E   ModuleNotFoundError: No module named 'app.services.agent_steps'
=================== 1 error in 0.11s ===================
```

失败原因：实现模块尚不存在，属预期的收集期 ImportError。

（注：环境中无 python/pytest，按 gitignore 允许新建 `backend/.venv` 并安装 pytest / pytest-asyncio / fastapi / httpx / pydantic —— 均为项目 pyproject.toml 已声明的依赖，未新增任何项目依赖。）

### GREEN

命令：同上

```
tests/test_agent_steps.py::test_error_extraction_clusters_errors PASSED  [ 33%]
tests/test_error_extraction_no_error_lines PASSED   [ 66%]
tests/test_error_extraction_empty_content_fails PASSED [100%]
======================= 3 passed in 0.29s =======================
```

### 全量后端套件

命令：`cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/ -v`

结果：**68 passed, 1 failed**。

唯一失败 `tests/test_resolved_path.py::test_rebuild_scans_configured_path` 为**与本任务无关的既有失败**：该测试 monkeypatch `app.services.repair_template_service.get_resolved_base`，但当前源码中 `get_resolved_base` 是在 `rebuild()` 函数体内惰性导入（repair_template_service.py:49），不是模块级属性，故 `monkeypatch.setattr` 抛 AttributeError。本任务只新增 3 个文件、未改动任何既有文件，该失败在改动前即存在。

## 文件变更

- 新增 `backend/app/types/agent_types.py`
- 新增 `backend/app/services/agent_steps.py`
- 新增 `backend/tests/test_agent_steps.py`
- （未提交）`backend/.venv/` — 本地测试环境，已被 .gitignore 覆盖

提交：`443e8a0 feat: 自主排查步骤骨架与错误定位步骤`

## 自评

- 完整性：brief 三个文件全部落地；InvestigationContext 覆盖步骤 1~4 全部证据字段；常量比后续任务多定义了 5 个（brief 明确给出，属骨架一部分，非自建）。
- 质量：中文模块 docstring；命名与既有服务一致；偏差处有注释说明原因。
- 纪律：只提交 brief 指定的 3 个文件；未改任何既有服务；未新增项目依赖。
- 测试：TDD 红→绿证据完整；测试验证行为（聚类数、top_patterns 内容、emit 消息、空内容失败路径）。

## 关注事项

1. brief 实现代码与测试的矛盾（见上）——建议后续任务 brief 作者知悉，或考虑在 log_service 导出该占位串常量（本任务未改 log_service）。
2. `test_resolved_path.py` 的既有失败会在后续任务的全量套件中持续出现，建议单独修。
