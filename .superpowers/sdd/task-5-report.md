# Task 5 报告：报告 prompt 构建器 + 兜底报告构建器

## 实现内容

按 brief 逐字追加到 `backend/app/services/agent_steps.py` 末尾的两个同步构建器：

1. **`build_report_prompt(ctx: InvestigationContext) -> list[dict]`**
   - 函数级 import 复用 `app.services.context_manager.SYSTEM_PROMPT`（产线诊断 system prompt）
   - user 消息拼装：四段输出指令（🎯 故障部件定位 / 🔍 根因判定 / 🛠️ 维修动作 / ⚠️ 是否需升级 WWWTE）+ 结构化证据段
   - 证据 1 错误聚类（无聚类时给出"未发现明显错误行"兜底文案）；证据 2/3/4a/4b/对话上下文均为可选段，空则不出现
   - 空 `batch_result` dict 通过 `if ctx.batch_result:` 跳过；`history_text` 截断到 `HISTORY_CHARS = 1500`
2. **`build_fallback_report(ctx: InvestigationContext) -> str`**
   - AI 不可用时本地拼装 markdown：标题含"本地兜底模式"，四段结构与 AI 报告一致
   - 批次判定体现在升级段（matched_count > 0 → "反馈 WWWTE"；否则 "单台偶发"）
   - 空 `batch_result` 通过 `.get("matched_count", 0)` 安全处理

测试按 brief 逐字追加到 `backend/tests/test_agent_steps.py` 末尾：`_rich_ctx()` 工厂 + 4 个同步测试（全证据 prompt / 可选证据缺失 / 兜底报告结构 / 单台偶发兜底）。

## 测试与结果

### TDD Evidence — RED

命令：
```
cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v -k "report_prompt or fallback"
```

输出（符合预期）：
```
tests/test_agent_steps.py:373: in <module>
    from app.services.agent_steps import build_fallback_report, build_report_prompt
E   ImportError: cannot import name 'build_fallback_report' from 'app.services.agent_steps'
=============================== 1 error in 0.95s ===============================
```

预期原因：两个构建器尚未实现，测试模块收集期 import 失败 —— 正是 brief Step 2 预期的 ImportError。

### TDD Evidence — GREEN

命令：
```
cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest tests/test_agent_steps.py -v
```

输出：
```
collected 16 items
...（16 条全部 PASSED，含 4 条新增）
============================== 16 passed in 0.27s ==============================
```

与 brief 预期 "16 passed" 一致。

### 全量后端套件

```
cd /home/qim/code/ai-log-analyzer/backend && .venv/bin/python -m pytest
→ 1 failed, 81 passed in 0.54s
FAILED tests/test_resolved_path.py::test_rebuild_scans_configured_path
```

该失败为 brief 明示的既有无关失败；单独隔离运行（不收集我的任何改动）同样失败，确认与本次改动无关。

## 变更文件

- `/home/qim/code/ai-log-analyzer/backend/app/services/agent_steps.py`（追加 2 个函数，+130 行）
- `/home/qim/code/ai-log-analyzer/backend/tests/test_agent_steps.py`（追加 4 个测试 + `_rich_ctx`，+99 行）

提交：`db099cf feat: 自主排查报告 prompt 与兜底报告构建器`（分支 feat/agent-investigation，2 files changed, 229 insertions）

## 自审

- **完整性**：brief 中两个函数与全部测试逐字落地；`SYSTEM_PROMPT` 函数级 import、`HISTORY_CHARS` 复用、空 `batch_result` 安全路径均保留。
- **质量**：同步函数 + 同步测试（与 brief 一致）；中文 docstring；无新增依赖；未改动既有代码行。
- **纪律**：严格 TDD（先测试 → ImportError RED → 实现 → GREEN）；提交只含规定的两个文件；中文 conventional 提交信息（feat:）。
- **测试**：RED/GREEN 证据齐全；全量套件唯一失败为既有无关用例（隔离复现确认）。
- ruff 未安装于 .venv（仅 pyproject 配置），无法本地跑 lint；代码为 brief 原文，未自行发挥。

## 问题与顾虑

无。
