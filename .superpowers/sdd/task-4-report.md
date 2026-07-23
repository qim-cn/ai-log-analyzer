# Task 4 报告：步骤 4（知识库与维修模板）

## 实现内容

按 brief 逐字（verbatim）完成：

1. **`backend/tests/test_agent_steps.py`** 末尾追加步骤 4 的三个测试：
   - `test_knowledge_lookup_hits` — 命中路径：snippet 截断到 300 字符、模板裁剪为 `{text, count}`
   - `test_knowledge_lookup_no_hits` — 双空路径：summary 含"均无命中"
   - `test_knowledge_lookup_kb_failure_still_gets_templates` — 知识库抛异常不阻断，模板照常返回，步骤整体 ok，进度消息含"不可用"
   - 辅助：`_FakeKnowledgeFeedback`、`_patch_knowledge`（sys.modules 注入假模块，避免真 import 重依赖）

2. **`backend/app/services/agent_steps.py`** 末尾追加 `run_knowledge_lookup(ctx, emit) -> StepResult`：
   - 函数级懒加载 `knowledge_feedback` / `obsidian_service` / `repair_template_service`
   - 知识库检索被 `if ctx.top_patterns:` 守卫包裹，查询串为前 2 个模式各截 60 字符拼接
   - `ctx.knowledge_refs` ≤ `KNOWLEDGE_REFS_LIMIT`(3) 条，snippet ≤ 300 字符
   - `ctx.repair_templates` ≤ `REPAIR_TEMPLATES_LIMIT`(5) 条，仅保留 `{text, count}`
   - 两个数据源各自独立 try/except 容错，一个失败不影响另一个，步骤整体不 failed

### 导入位置偏差说明（无偏差）

Tasks 1-3 的先例是"函数级懒加载导入放在 skip 提前返回之后"。本步骤 brief 的结构中**没有 skip 提前返回**（`if ctx.top_patterns:` 守卫包裹的是 KB 调用本身），且三个新测试全部通过 sys.modules 补丁了三个模块，不存在未打补丁的导入路径。因此导入按 brief 原样放在函数顶部，**未做任何调整**。

## TDD 证据

### RED

```
$ cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v -k knowledge
tests/test_agent_steps.py:266: in <module>
    from app.services.agent_steps import run_knowledge_lookup
E   ImportError: cannot import name 'run_knowledge_lookup' from 'app.services.agent_steps'
=============================== 1 error in 0.35s ===============================
```

符合预期：`run_knowledge_lookup` 尚未实现，测试模块收集期即 ImportError（与 brief Step 2 预期一致）。

### GREEN

```
$ cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v
collected 12 items
tests/test_agent_steps.py::test_error_extraction_clusters_errors PASSED
tests/test_agent_steps.py::test_error_extraction_no_error_lines PASSED
tests/test_agent_steps.py::test_error_extraction_empty_content_fails PASSED
tests/test_agent_steps.py::test_similar_cases_found PASSED
tests/test_similar_cases_empty PASSED
tests/test_agent_steps.py::test_similar_cases_skipped_without_patterns PASSED
tests/test_agent_steps.py::test_batch_pattern_detects_batch PASSED
tests/test_agent_steps.py::test_batch_pattern_single_occurrence PASSED
tests/test_agent_steps.py::test_batch_pattern_skipped_without_model PASSED
tests/test_agent_steps.py::test_knowledge_lookup_hits PASSED
tests/test_agent_steps.py::test_knowledge_lookup_no_hits PASSED
tests/test_agent_steps.py::test_knowledge_lookup_kb_failure_still_gets_templates PASSED
============================== 12 passed in 0.28s ==============================
```

12 passed — 与 brief Step 4 预期完全一致。

### 全量后端测试

```
$ .venv/bin/python -m pytest
FAILED tests/test_resolved_path.py::test_rebuild_scans_configured_path
1 failed, 77 passed in 0.56s
```

唯一失败是任务说明中已声明的**预存在无关失败**。已用 `git stash` 在干净树上复跑该测试确认其同样失败（`1 failed in 0.07s`），非本次改动引入。

## 文件变更

- `backend/app/services/agent_steps.py` — 追加 `run_knowledge_lookup`（+55 行）
- `backend/tests/test_agent_steps.py` — 追加步骤 4 测试（+108 行）

## 提交

- `af78837` — `feat: 自主排查知识库与维修模板步骤`（分支 `feat/agent-investigation`，直接提交）

## 自审

- **完整性**：brief 中 Step 1-5 全部完成；测试与实现代码逐字采用 brief 原文；接口签名与既有服务（`knowledge_feedback.search_and_inject`、`repair_template_service.list`、`obsidian_service` 单例）已 grep 核实一致。
- **质量**：复用 Task 1 常量 `KNOWLEDGE_REFS_LIMIT` / `REPAIR_TEMPLATES_LIMIT`；中文 docstring；重依赖函数级懒加载；双数据源独立容错。
- **纪律**：TDD 红→绿证据齐全；仅改动指定的两个文件；中文 conventional 提交信息；未新增依赖。
- **测试**：聚焦文件 12/12 通过；全量 77 passed + 1 预存在无关失败（已验证非本次引入）。

## 问题与顾虑

无。唯一注意点：全量套件中的 `test_resolved_path.py::test_rebuild_scans_configured_path` 失败为预存在问题（错误信息涉及 `repair_template_service.get_resolved_base` 属性缺失，疑似该测试的 monkeypatch 目标与当前模块接口漂移），建议后续任务另行排查，但不属于本任务范围。
