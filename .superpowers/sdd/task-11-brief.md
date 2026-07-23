### Task 11: README 更新 + 全量验证

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 更新 README 功能特性**

在 `README.md` 的 `## 功能特性` 列表中，在 `- 🎯 **快捷分析**` 一行之后插入：

```markdown
- 🕵️ **AI Agent 自主排查**：一键触发固定流水线排查（错误定位 → 相似案例 → 同批次模式检测 → 知识库/维修模板 → 根因报告），过程实时流式可见；报告自动存入会话，可保存知识库/导出
```

- [ ] **Step 2: 后端全量测试**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/ -v`
Expected: 全部通过（21 个新测试 + 既有测试）

- [ ] **Step 3: 前端构建**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: 构建通过

- [ ] **Step 4: 手动冒烟（需 docker compose 环境，可选）**

```bash
cd /home/qim/code/ai-log-analyzer && docker compose up -d
```

- 访问 http://localhost:8880，登录后上传一份含错误的日志
- 点击日志面板"深度排查"：步骤时间线逐步亮起，进度消息实时出现，最终报告流式输出
- 关闭排查视图：报告作为最新一条 AI 消息出现在聊天历史
- 聊天输入 `/investigate` 发送：同样触发排查
- 排查中点"取消"：流水线停止，无报告写入会话

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add README.md
git commit -m "docs: README 增加 AI Agent 自主排查功能说明"
```

---

## Self-Review 记录

**1. Spec 覆盖检查：**
- 5 步流水线 → Task 1-5 ✅；流水线 runner（单步失败隔离/超时/取消/并发锁/兜底报告）→ Task 6 ✅；SSE 端点（双入参/归属校验/限流复用）→ Task 7 ✅；前端流式视图/双入口/取消 → Task 8-10 ✅；报告存为消息（复用保存/导出）→ Task 6 `_generate_report` ✅；README → Task 11 ✅
- Spec 中"每用户同时最多 1 个排查" → `AgentService._active_users` 内存锁 ✅（单容器部署与现有限流器 sqlite 后端一致；多副本场景的超用户并发属既有架构限制，不在本计划范围）
- Spec 中"单步 30s/整体 180s/证据截断" → Task 6 常量 + Task 1 常量 ✅

**2. 占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码。

**3. 类型一致性：**
- `StepResult.status` 取值 `ok/failed/skipped` 在步骤实现、runner、前端 `StepState` 三处一致 ✅
- SSE 事件字段（`type/step/title/message/status/summary/content/message_id`）后端 yield 与前端 `AgentEvent` 一致 ✅
- `AgentService._active_users` 被 Task 6 测试直接操作（`service._active_users.add("u1")`）✅
- 前端 store 的 `start/cancel/close` 与 Task 9/10 的消费点一致 ✅
