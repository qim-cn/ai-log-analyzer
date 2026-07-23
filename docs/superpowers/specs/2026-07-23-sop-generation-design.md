# 维修 SOP 自动生成 —— 设计文档

日期：2026-07-23
状态：已批准（用户确认）
项目：ai-log-analyzer

## 背景与目标

ai-log-analyzer 目前有 AI Agent 自主排查（有日志→自动分析）和知识库（历史案例+维修模板+Linux 诊断命令）。维修工程师在实际工作中还有一个高频需求：**机器还没到工位、或者还没拉日志，想先看看这类故障的标准排查流程**。

维修 SOP 自动生成填补这个空白：输入机型号（如 `7500S`）和故障描述（如 `内存ECC`），系统搜索全部知识库（已解决案例、维修模板、Linux 命令库、历史会话），LLM 合成一份结构化标准作业程序（SOP）。

### 与 AI Agent 自主排查的关系

| | Agent 自主排查 | SOP 生成 |
|---|---|---|
| 输入 | 具体日志文件 | 机型 + 故障描述 |
| 数据源 | 当前日志 + 向量库 + 知识库 | 知识库 + 模板 + 历史（不查日志） |
| 产出 | 具体根因 + 本次维修建议 | 通用标准排查流程 |
| 耗时 | 1-3 分钟 | <30 秒（无日志解析/聚类） |

### 关键决策

| 决策点 | 结论 |
|--------|------|
| 入口 | 聊天命令 `/sop <机型> <故障>` + 知识库页面「生成 SOP」按钮 |
| 数据源 | 全部：已解决案例 + 维修模板 + Linux 知识库 + 历史会话 |
| 输出 | SSE 流式生成，步骤时间线 + 结构化 SOP 报告 |
| 报告存储 | 存为 assistant 消息（与 Agent 排查一致），可保存知识库/导出 |

## 架构

### SOP 生成流水线（3 步，比 Agent 排查轻量）

| # | 步骤 | 做什么 | 复用的现有服务 |
|---|------|--------|----------------|
| 1 | 知识检索 | 并行查 4 个数据源：已解决案例搜索、维修模板列表、Linux 命令库、同机型历史会话 | `obsidian_service.search_notes`、`repair_template_service.list`、`linux_knowledge_service`、`session_repository.list_all(model=...)` |
| 2 | 证据聚合 | 去重 + 排序（按频次）+ 截断控制 token | 同 Agent 流水线的证据截断逻辑 |
| 3 | SOP 合成 | 一次 LLM 调用，流式生成结构化 SOP 报告 | `ai_service.chat_stream` |

### SOP 输出结构

1. 🎯 故障概述 —— 故障现象、可能影响范围
2. 🔍 诊断步骤 —— 按优先级排序的检查命令（标注来源：Linux 知识库 / 历史案例）
3. 🛠️ 维修流程 —— 按历史成功率排序的维修动作（标注引用案例数和来源）
4. ⚠️ 注意事项 —— 常见坑 + 升级 WWWTE 条件（单台偶发 vs 批次问题）

## 数据流 / API / 前端

### API

`POST /api/sop/generate`，Body：`{model: string, fault: string}`（两个都必填，机型号和故障描述）

无验权（登录即可用）；限流复用现有 `rate_limiter`。

SSE 事件格式（与 Agent 排查一致）：
```
data: {"type": "step_start",    "step": 1, "title": "知识检索"}
data: {"type": "step_progress", "step": 1, "message": "已解决案例命中 5 条 / 维修模板 3 条 / 同类会话 12 个"}
data: {"type": "step_done",     "step": 1, "status": "ok", "summary": "…"}
data: {"type": "step_start",    "step": 3, "title": "SOP 合成"}
data: {"type": "report_chunk",  "content": "## 🎯 故障概述\n..."}
data: {"type": "done", "message_id": "…"}
```

### 前端

- **聊天命令**：ChatPanel 的 `handleSend` 增加 `/sop` 前缀检测 → 调用 SOP SSE → 复用 InvestigationView 展示步骤 + 报告
- **知识库页面**：KnowledgePage Header 加「生成 SOP」按钮 → 弹窗填机型+故障 → 同上流式生成
- **SOP 报告**：存为 assistant 消息，可在聊天历史回看、保存知识库、导出

修改文件：
- 后端：`sop_service.py`（流水线 + 合成）、`sop_routes.py`（SSE）、`main.py`（注册）
- 前端：`sopService.ts`、`ChatPanel.tsx`（/sop 命令）、`KnowledgePage.tsx`（SOP 按钮+弹窗）

### 复用项

- InvestigationView 组件（不改，直接复用展示 SOP 步骤时间线 + 报告）
- investigationStore（新增 `startSOP` action，事件类型与 Agent 排查一致）
- MarkdownRenderer 全部排版改进（标签徽章、命令窗口、日志块）

## 错误处理

- 数据源单个失败 → 降级：某源不可用时标注"不可用"，其余源照常
- LLM 不可用 → 模板拼装兜底报告（从检索结果直接组装，不走 AI）
- 超时：单步 20s / 整体 60s（比 Agent 排查短，不查日志）

## 非目标（v1 不做）

- 不从用户输入中自动推断机型（需手动输入）
- 不保存 SOP 到知识库自动（沿用现有"保存知识库"按钮）
- 不支持批量机型 SOP

## 实施清单

1. 后端：`sop_service.py`（3 步流水线 + LLM 合成）、`sop_routes.py`（SSE）、`main.py` 注册
2. 前端：`sopService.ts`、ChatPanel `/sop` 命令、KnowledgePage SOP 按钮+弹窗、investigationStore 加 sop mode
3. 测试：后端 pytest（步骤测试 + 路由测试），前端构建验证
4. 更新 README
