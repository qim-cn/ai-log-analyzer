### Task 5: 报告 prompt 构建器 + 兜底报告构建器

**Files:**
- Modify: `backend/app/services/agent_steps.py`（追加两个同步函数）
- Test: `backend/tests/test_agent_steps.py`

**Interfaces:**
- Consumes: `app.services.context_manager.SYSTEM_PROMPT`（现有产线诊断 system prompt，直接复用）；`InvestigationContext` 全部证据字段
- Produces: `build_report_prompt(ctx) -> list[dict]`（OpenAI messages 格式：`[system, user]`）；`build_fallback_report(ctx) -> str`（AI 不可用时直接拼装证据的 markdown 报告）

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_agent_steps.py` 末尾追加：

```python
# ---- 报告 prompt / 兜底报告 ----

from app.services.agent_steps import build_fallback_report, build_report_prompt


def _rich_ctx() -> InvestigationContext:
    """填满证据的上下文"""
    ctx = _ctx(content="ERROR DIMM A2 training failed\n", model="7500S", history="用户: 帮忙看下\nAI: 初步看是内存")
    ctx.error_clusters = {
        "total_error_lines": 3,
        "clusters": [
            {"pattern": "ERROR DIMM A<NUM> training failed", "count": 3, "first_seen": None,
             "last_seen": None, "sample": "ERROR DIMM A2 training failed", "ratio": 1.0},
        ],
    }
    ctx.top_patterns = ["ERROR DIMM A<NUM> training failed"]
    ctx.similar_cases = [{"log_id": "old-1", "similarity": 0.92, "preview": "历史案例预览"}]
    ctx.batch_result = {
        "model": "7500S", "checked_sessions": 5, "matched_count": 1,
        "matched_machines": ["SN002"], "is_batch": True,
    }
    ctx.knowledge_refs = [{"filename": "case1.md", "title": "DIMM 故障案例", "snippet": "换内存解决"}]
    ctx.repair_templates = [{"text": "重插拔内存条", "count": 3}]
    return ctx


def test_build_report_prompt_contains_all_evidence():
    ctx = _rich_ctx()

    messages = build_report_prompt(ctx)

    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[0]["content"]  # 复用现有产线 system prompt
    user = messages[1]["content"]
    # 四段输出指令
    assert "🎯 故障部件定位" in user
    assert "🔍 根因判定" in user
    assert "🛠️ 维修动作" in user
    assert "⚠️ 是否需升级 WWWTE" in user
    # 证据全部带入
    assert "DIMM" in user                      # 错误聚类
    assert "历史案例预览" in user                # 相似案例
    assert "SN002" in user                     # 批次检测
    assert "DIMM 故障案例" in user               # 知识库
    assert "重插拔内存条" in user                # 维修模板
    assert "初步看是内存" in user                # 对话上下文


def test_build_report_prompt_without_optional_evidence():
    """只有错误聚类时 prompt 仍完整（可选证据段不出现）"""
    ctx = _ctx(content="ERROR x\n")
    ctx.error_clusters = {
        "total_error_lines": 1,
        "clusters": [{"pattern": "ERROR x", "count": 1, "first_seen": None,
                      "last_seen": None, "sample": "ERROR x", "ratio": 1.0}],
    }

    messages = build_report_prompt(ctx)

    user = messages[1]["content"]
    assert "证据 1" in user
    assert "证据 2" not in user   # 无相似案例
    assert "证据 3" not in user   # 无批次结果


def test_build_fallback_report_structure():
    ctx = _rich_ctx()

    report = build_fallback_report(ctx)

    assert "本地兜底" in report
    assert "🎯 故障部件定位" in report
    assert "🔍 根因判定" in report
    assert "🛠️ 维修动作" in report
    assert "⚠️ 是否需升级 WWWTE" in report
    assert "DIMM" in report
    assert "SN002" in report
    assert "重插拔内存条" in report
    # 批次判定结论体现在升级段
    assert "反馈 WWWTE" in report


def test_build_fallback_report_single_machine():
    ctx = _ctx(content="ERROR x\n")
    ctx.error_clusters = {"total_error_lines": 1, "clusters": [
        {"pattern": "ERROR x", "count": 1, "first_seen": None,
         "last_seen": None, "sample": "ERROR x", "ratio": 1.0}]}
    ctx.batch_result = {
        "model": "7500S", "checked_sessions": 3, "matched_count": 0,
        "matched_machines": [], "is_batch": False,
    }

    report = build_fallback_report(ctx)

    assert "单台偶发" in report
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v -k "report_prompt or fallback"`
Expected: FAIL — `ImportError: cannot import name 'build_report_prompt'`

- [ ] **Step 3: 实现两个构建器**

在 `backend/app/services/agent_steps.py` 末尾追加：

```python
def build_report_prompt(ctx: InvestigationContext) -> list[dict]:
    """步骤 5：汇总证据，构建根因报告 prompt（复用产线 system prompt）"""
    from app.services.context_manager import SYSTEM_PROMPT

    sections: list[str] = []

    # 证据 1：错误聚类
    clusters = ctx.error_clusters.get("clusters", [])
    if clusters:
        lines = [
            "## 证据 1：错误聚类（当前日志）",
            f"共 {ctx.error_clusters.get('total_error_lines', 0)} 行错误，TOP 模式：",
        ]
        for i, c in enumerate(clusters[:5], 1):
            lines.append(f"{i}. {c['pattern'][:120]}（{c['count']} 次，占比 {c['ratio']:.0%}）")
            if c.get("sample"):
                lines.append(f"   样例: {c['sample'][:200]}")
        sections.append("\n".join(lines))
    else:
        sections.append("## 证据 1：错误聚类\n当前日志未发现明显错误行。")

    # 证据 2：相似历史案例
    if ctx.similar_cases:
        lines = ["## 证据 2：相似历史案例（向量检索）"]
        for i, c in enumerate(ctx.similar_cases, 1):
            lines.append(f"{i}. 相似度 {c['similarity']:.2f}：{c['preview']}")
        sections.append("\n".join(lines))

    # 证据 3：同批次模式检测
    if ctx.batch_result:
        b = ctx.batch_result
        lines = [
            "## 证据 3：同批次模式检测",
            f"机型: {b['model']}，检查了 {b['checked_sessions']} 个同机型会话",
        ]
        if b["matched_count"] > 0:
            lines.append(
                f"⚠️ 另有 {b['matched_count']} 台机器出现相同失败模式: "
                f"{', '.join(b['matched_machines'])}"
            )
            lines.append("判定: 同批次多台相同模式（连本机 >=2 台），符合升级 WWWTE 的条件")
        else:
            lines.append("判定: 单台偶发，优先按硬件/装配/本机配置排查")
        sections.append("\n".join(lines))

    # 证据 4：知识库案例与维修模板
    if ctx.knowledge_refs:
        lines = ["## 证据 4a：知识库历史案例"]
        for r in ctx.knowledge_refs:
            lines.append(f"- {r['title'] or r['filename']}: {r['snippet']}")
        sections.append("\n".join(lines))
    if ctx.repair_templates:
        lines = ["## 证据 4b：维修操作模板（按使用频次）"]
        for t in ctx.repair_templates:
            lines.append(f"- {t['text']}（历史使用 {t['count']} 次）")
        sections.append("\n".join(lines))

    # 已有对话上下文（聊天入口触发时）
    if ctx.history_text:
        sections.append(f"## 已有对话上下文（节选）\n{ctx.history_text[:HISTORY_CHARS]}")

    evidence = "\n\n".join(sections)
    user_content = (
        "以下是 Agent 自主排查收集到的结构化证据。请基于证据输出一份完整的根因报告，"
        "严格按以下四段结构（保留 emoji 标题）：\n\n"
        "## 🎯 故障部件定位\n明确指出故障物理部件。\n\n"
        "## 🔍 根因判定\n按证据强弱排序候选根因，每条标注依据来源（错误聚类/相似案例/批次检测/知识库）。\n\n"
        "## 🛠️ 维修动作\n给出工位可执行的动作（换件/重插拔/刷固件/改配置），优先参考命中的维修模板。\n\n"
        "## ⚠️ 是否需升级 WWWTE\n"
        "引用批次检测结论：单台偶发 → 工位解决；同批次多台相同模式 → 建议升级，并列出需收集的反馈信息。\n\n"
        f"{evidence}"
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def build_fallback_report(ctx: InvestigationContext) -> str:
    """AI 不可用时的兜底报告：直接拼装结构化证据（不走 AI）"""
    parts = ["🔬 **自主排查报告（本地兜底模式，AI 不可用）**\n"]

    clusters = ctx.error_clusters.get("clusters", [])
    parts.append("## 🎯 故障部件定位\n")
    if clusters:
        top = clusters[0]
        parts.append(
            f"最高频错误模式：**{top['pattern'][:150]}**"
            f"（{top['count']} 次，占比 {top['ratio']:.0%}）\n"
        )
        parts.append("\n全部错误模式：")
        for c in clusters[:5]:
            parts.append(f"- {c['pattern'][:120]}（{c['count']} 次）")
    else:
        parts.append("当前日志未发现明显错误行。")

    parts.append("\n## 🔍 根因判定（证据汇总）\n")
    if ctx.batch_result:
        b = ctx.batch_result
        if b["matched_count"] > 0:
            parts.append(
                f"- ⚠️ 批次检测：同机型另有 {b['matched_count']} 台出现相同模式"
                f"（{', '.join(b['matched_machines'][:5])}），疑似批次性问题"
            )
        else:
            parts.append(f"- 批次检测：单台偶发（检查 {b['checked_sessions']} 个同机型会话）")
    if ctx.similar_cases:
        parts.append(
            f"- 相似案例：{len(ctx.similar_cases)} 条"
            f"（最高相似度 {ctx.similar_cases[0]['similarity']:.2f}）"
        )
    if ctx.knowledge_refs:
        parts.append("- 知识库命中：")
        for r in ctx.knowledge_refs:
            parts.append(f"  - {r['title'] or r['filename']}")

    parts.append("\n## 🛠️ 维修动作（参考模板）\n")
    if ctx.repair_templates:
        for t in ctx.repair_templates:
            parts.append(f"- {t['text']}（历史使用 {t['count']} 次）")
    else:
        parts.append("暂无维修模板命中，请根据错误模式人工判断。")

    parts.append("\n## ⚠️ 是否需升级 WWWTE\n")
    if ctx.batch_result.get("matched_count", 0) > 0:
        parts.append("同批次多台出现相同失败模式，建议收集本机日志、SN、错误截图反馈 WWWTE。")
    else:
        parts.append("单台偶发，建议在工位完成维修；如维修后仍复现再升级。")
    return "\n".join(parts)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/qim/code/ai-log-analyzer/backend && python -m pytest tests/test_agent_steps.py -v`
Expected: 16 passed

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add backend/app/services/agent_steps.py backend/tests/test_agent_steps.py
git commit -m "feat: 自主排查报告 prompt 与兜底报告构建器"
```

---

