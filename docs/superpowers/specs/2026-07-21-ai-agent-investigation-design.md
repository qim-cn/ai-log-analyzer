# AI Agent 自主排查 —— 设计文档

日期：2026-07-21
状态：已批准（用户确认）
项目：ai-log-analyzer

## 背景与目标

ai-log-analyzer 服务于服务器产线测试诊断场景：用户是测试线维修工程师，机器测试报错后上传日志，用 AI 定位硬件故障并给出维修动作。

当前 AI 分析是"一问一答"模式：用户需要逐步追问（查相似案例、查知识库、判断批次模式），每一步都要人工发起。**AI Agent 自主排查**把整个排查流程自动化：一次点击，Agent 按固定流水线自动完成"错误定位 → 相似案例 → 批次模式 → 知识库 → 根因报告"，实时流式展示排查过程。

### 关键决策（brainstorming 阶段确认）

| 决策点 | 结论 |
|--------|------|
| 入口 | 双入口：上传后一键排查 + 聊天中升级触发 |
| 数据范围 | 当前日志 + 历史知识 + 跨日志关联（全局向量库已支持跨会话检索） |
| 写权限 | 全程只读；报告生成后由用户决定是否保存知识库 |
| 运行交互 | 实时流式显示排查过程（SSE） |
| 架构 | 方案 A：固定流水线（不依赖模型 tool-calling，任何 OpenAI 兼容模型/Ollama 都能跑） |

## 架构

### 排查流水线（5 步）

后端新增 `app/services/agent_service.py`（流水线 runner）+ `app/services/agent_steps.py`（步骤实现）。每步是独立类：有 `name`、中文 `title`、`run(context)` 方法，通过注册表挂载到流水线。未来加步骤或加 LLM 决策分支点（方案 C）只需注册新步骤，不动主干。

| # | 步骤 | 做什么 | 复用的现有服务 |
|---|------|--------|----------------|
| 1 | 错误定位 | 解析日志，提取错误行并聚类，产出"错误签名"（错误码/部件/模式） | `log_service`、`log_parser`、`error_cluster_service` |
| 2 | 相似案例检索 | 用错误签名在全局 ChromaDB 检索 Top-5 相似历史日志 | `vector_store`、`embedding_service` |
| 3 | 同批次模式检测 | 按机型+错误签名跨会话统计：同机型多少台机器出现相同失败模式 → 输出"单台偶发 / 同批次 N 台"判定 | log 元数据 + 错误签名匹配 |
| 4 | 知识库与维修模板 | 按机型+错误签名查 Obsidian/WebDAV 知识库历史案例 + 匹配维修操作模板 | `obsidian_service`、`repair_template_service`、knowledge 相关服务 |
| 5 | 根因报告生成 | 汇总 1~4 的证据（每项截断控制 token），一次 LLM 调用流式生成结构化报告 | `ai_service` |

### 报告结构

对齐现有 system prompt 的分析流程：

1. 🎯 故障部件定位
2. 🔍 根因判定（按证据强弱排序，标注每条依据来自哪一步：相似案例/批次统计/知识库）
3. 🛠️ 维修动作（可执行：换件/重插拔/刷固件/改配置）
4. ⚠️ 是否需升级 WWWTE（引用批次检测结果：单台 → 工位解决；同批次 N 台相同模式 → 建议升级并列出需收集的信息）

第 5 步的 prompt 携带前 4 步的结构化证据，并要求 AI **引用证据来源**，保证报告可溯源。

## 数据流 / API / 前端

### 入口与端点

```
入口 1（上传后）                          入口 2（聊天中）
LogUploader 完成                          ChatPanel "🔍 深入调查"按钮
  → LogPanel 出现                            或输入 /investigate 命令
    "🔬 深度排查"按钮                          → POST /api/agent/investigate
  → POST /api/agent/investigate              { session_id }
    { log_id }（自动建新会话）                      │
        └──────────────┬──────────────────────────┘
                       ▼
            SSE 流式返回排查过程
```

- **API**：`POST /api/agent/investigate`，Body 二选一：`{log_id}`（新建会话）或 `{session_id}`（复用现有会话，报告生成时带上已有对话上下文）
- 鉴权、归属校验、限流复用现有中间件（`require_session_owner`、`rate_limiter`）

### SSE 事件格式

沿用现有 chat 的 SSE 风格：

```
data: {"type": "step_start",    "step": 2, "title": "相似案例检索"}
data: {"type": "step_progress", "step": 2, "message": "找到 3 个相似案例，最高相似度 0.92"}
data: {"type": "step_done",     "step": 2, "status": "ok", "summary": "3 个相似案例"}
data: {"type": "report_chunk",  "content": "## 🎯 故障部件定位\n..."}
data: {"type": "done", "message_id": "..."}
```

`step_done.status` 取值：`ok` / `failed`（失败时 `summary` 说明原因）。错误事件：`{"type": "error", "message": "..."}`。

### 前端

- 新增 `InvestigationView` 组件：上半部分为步骤时间线（可折叠步骤卡片，状态图标 ⏳/✅/⚠️ + 进度消息），下半部分为流式报告（复用 `MarkdownRenderer`）
- 复用 `useStreaming` 的 SSE 处理模式；新增 `agentService.ts`
- 报告存为会话中的一条 assistant 消息 —— 现有保存知识库、导出、历史回看功能零改动直接可用
- 运行中显示"取消"按钮（关闭 SSE → 后端取消任务）

## 错误处理

核心原则：**单步失败不中断流水线**。

- 每个步骤独立 try/catch：失败 → 推送 `step_done {status: "failed"}`，该步证据标记为不可用，继续后续步骤（如向量检索挂了，报告注明"相似案例检索不可用"，其余证据照常生成）
- 第 5 步 LLM 不可用 → 降级为模板化报告（直接拼装前 4 步的结构化证据，不走 AI），与现有 `local_analysis_service` 兜底思路一致
- 超时：单步 30s，整体 180s；超时按该步失败处理
- 取消：用户关闭 SSE → asyncio 任务取消，中间结果丢弃，不写会话

## 限制（成本与并发控制）

- 每用户同时最多 1 个进行中的排查
- 证据截断：相似案例 Top-5、每条摘录 ≤500 字符、知识库命中 ≤3 条 —— 保证塞进 `MAX_CONTEXT_TOKENS`（8000）
- 排查端点在 `rate_limiter` 中单独配额度（低于普通聊天）

## 测试

backend/tests/ 下新增 pytest 用例，Mock 外部依赖：

- 每个步骤的单元测试（mock 向量库/知识库/AI）
- 流水线 runner 测试：事件顺序、单步失败隔离、超时与取消
- 路由测试：鉴权、归属校验、SSE 事件流格式、`log_id`/`session_id` 两种入参
- 证据截断测试（超长案例被截断）
- 前端无现有测试基建，手动验证

## 非目标（v1 明确不做）

- LLM 自主决策的 Agent 循环（方案 B/C，未来升级方向）
- 自动执行维修动作
- 自动写入知识库（沿用现有"保存到知识库"按钮，用户确认）
- 排查过程持久化（只有最终报告存为消息；中间步骤临时）

## 实施清单

1. 后端：`agent_service.py`、`agent_steps.py`、`agent_routes.py` + 测试
2. 前端：`InvestigationView`、`agentService.ts`、LogPanel/ChatPanel 两个入口按钮、`/investigate` 命令
3. **更新 README.md**：功能特性列表加入"🕵️ AI Agent 自主排查"及简要说明
