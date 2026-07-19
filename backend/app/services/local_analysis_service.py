"""
本地分析服务 — 在调用 AI 之前，先尝试用规则/模式/知识库匹配
返回 (result: str | None, source: str)
result=None 表示本地无法分析，需要调用 AI
"""

import logging
import re
from collections import Counter

from app.config.database import get_connection

logger = logging.getLogger(__name__)

# ── 产线测试常见错误模式（有序，越靠前匹配越精准）────────────────────

TEST_FAILURE_PATTERNS: list[tuple[str, str, str]] = [
    # (日志行匹配正则, 故障类型, 排查建议)

    # PCIe 链路宽度相关
    (r"(?i)pci.*x(\d+).*vs.*x(\d+).*fail", "PCIe链路降宽",
     "部件({bdf})协商x{actual}，预期x{expected}。{bay_info}"
     "**验证命令：** `lspci -vvv -s {bdf}` 查看 LnkSta 协商宽度，"
     "`setpci -s {bdf} CAP_EXP+12.L` 读链路状态寄存器。"
     "排查：1. 重插拔该槽位 → 2. 目检金手指/连接器 "
     "→ 3. 交叉验证换到正常槽位 → 4. 换件"),

    # PCIe 链路速率相关
    (r"(?i)pci.*(\d+)gt/s.*vs.*(\d+)gt/s.*fail", "PCIe链路降速",
     "部件({bdf})协商{actual}GT/s，预期{expected}GT/s。"
     "排查同降宽：重插拔→目检→交叉验证→换件"),

    # HBA/RAID 卡超时
    (r"(?i)storcli\d*\s.*timeout|storcli\d*.*timed\s*out", "HBA/RAID卡命令超时",
     "storcli 命令超时，可能原因：1. HBA 固件卡死 2. SAS 链路故障 3. 磁盘不响应。"
     "排查：dmesg查看SAS PHY错误，检查/sys/class/sas_phy/*/invalid_dword_count"),

    # SAS PHY 错误
    (r"(?i)invalid_dword_count.*[1-9]|phy.*error|sas.*error", "SAS链路错误",
     "invalid_dword_count 非零表示 SAS 物理链路信号质量问题。"
     "排查：重插拔 SAS 线缆→检查线缆/连接器 →交叉验证 HBA/背板 →换件"),

    # DIMM/内存 ECC 错误
    (r"(?i)(?:correctable|uncorrectable|edac|mce).*mem|dimm.*fail|memory.*error", "内存故障",
     "出现 ECC/内存错误。排查：1.dmidecode定位故障 DIMM "
     "2.重插拔该 DIMM 3.交叉验证（换槽位/换DIMM） 4.换件"),

    # CPU 温度/过热
    (r"(?i)cpu.*(?:thermal|throttl|overheat|temp.*(?:9\d|1\d{2}))", "CPU过热",
     "CPU 温度异常或触发降频。排查：1.检查散热器是否装好 2.硅脂是否正确涂覆 "
     "3.风扇是否运转 4.检查机箱风道"),

    # 磁盘 SMART 故障
    (r"(?i)smart.*(?:fail|error)|reallocat.*sector.*[1-9]|pending.*sector.*[1-9]", "磁盘SMART异常",
     "SMART 报告异常扇区。排查：1.smartctl -a 查看详情 "
     "2.确认是系统盘还是数据盘 3.换盘"),

    # 网卡链路
    (r"(?i)(?:nic|eth|network).*(?:link.*down|fail|error|lost)", "网卡链路故障",
     "网卡链路状态异常。排查：1.检查网线是否插紧 2.检查交换机端口 "
     "3.ethtool 确认协商速率 4.交叉验证网口/网线"),

    # 电源/PSU
    (r"(?i)(?:psu|power\s*supply).*(?:fail|error|loss|missing)", "电源模块故障",
     "PSU 状态异常。排查：1.检查电源线是否插紧 2.确认 PSU 指示灯状态 "
     "3.ipmitool sensor 查看详细告警 4.交叉验证 PSU 槽位"),

    # 风扇
    (r"(?i)(?:fan|FAN).*(?:\b0\s*RPM|fail|error|missing|stop)", "风扇故障",
     "风扇停转或转速异常。排查：1.目检风扇是否被线缆卡住 "
     "2.检查风扇连接器 3.ipmitool sensor 确认 4.换风扇"),

    # BIOS/BMC
    (r"(?i)(?:bios|bmc|firmware).*(?:fail|error|mismatch|version)", "固件/BIOS异常",
     "BIOS/BMC 固件问题。排查：1.确认固件版本是否符合产线要求 "
     "2.重新刷写固件 3.更换 BIOS/BMC 芯片"),

    # 通用 FAIL/ERROR 兜底
    (r"(?i)\bFAIL\b.*\bFAIL\b|\bTESTE\s+FAIL\b", "测试FAIL",
     "日志中出现 FAIL 标记。需要进一步分析具体错误类型。请提供更多日志上下文。"),
]

# ── 从日志中提取信息 ──────────────────────────────────────

def _extract_log_info(log_text: str) -> dict:
    """从日志片段中提取关键信息"""
    info: dict = {"bay_info": "", "bdf": "", "actual": "", "expected": ""}

    # BDF 格式: XX:XX.X
    bdf = re.findall(r'\b([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-9a-fA-F])\b', log_text[:500])
    if bdf:
        info["bdf"] = f"{bdf[0][0]}:{bdf[0][1]}.{bdf[0][2]}"

    # Bay 信息
    bay = re.findall(r'(?:Front|Rear|Internal)\s*(?:Storage)?\s*Bay\s*(\d+)', log_text[:500], re.IGNORECASE)
    if bay:
        info["bay_info"] = f"前端存储Bay{bay[0]}， "

    # NVMe/SSD 类型
    nvme = re.findall(r'(?:NVMe|SSD|HDD|SATA)', log_text[:200], re.IGNORECASE)
    if nvme:
        info["bay_info"] += f"{nvme[0]}盘位"

    # PCIe 协商值
    pci = re.findall(r'(\d+)GT/s.*?(\d+)GT/s.*?x(\d+).*?x(\d+)', log_text[:300])
    if pci:
        info["actual"] = "x" + pci[0][3]   # 实际 lane 数
        info["expected"] = "x" + pci[0][2]  # 预期 lane 数

    return info


# ── 公开 API ─────────────────────────────────────────────

def try_local_analysis(query: str, log_snippet: str = "") -> tuple[str | None, str]:
    """
    尝试本地分析。返回 (分析结果, 来源标签)

    如果本地可以给出有意义的分析，返回 (结果文本, '本地分析')
    否则返回 (None, '')，调用方应 fallback 到 AI
    """

    # 合并用户提问和日志内容一起分析
    combined = f"{query}\n{log_snippet[:3000]}" if log_snippet else query

    matches: list[dict] = []
    for pattern, fault_type, suggestion in TEST_FAILURE_PATTERNS:
        m = re.search(pattern, combined)
        if m:
            matches.append({"type": fault_type, "suggestion": suggestion, "groups": m.groups()})

    if not matches:
        return None, ""

    # 去重：同类型只保留第一个
    seen = set()
    unique = []
    for m in matches:
        if m["type"] not in seen:
            seen.add(m["type"])
            unique.append(m)

    # 构建本地分析结果
    info = _extract_log_info(combined)
    lines = ["## [本地分析] \n"]

    for i, m in enumerate(unique[:5]):
        sug = m["suggestion"]
        # 替换模板变量
        for k, v in info.items():
            sug = sug.replace(f"{{{k}}}", v or "")
        sug = re.sub(r'\{[^}]+\}', '', sug)  # 清理未替换的模板变量
        sug = re.sub(r'\s+', ' ', sug).strip()  # 合并多余空格

        lines.append(f"### {i+1}. {m['type']}")
        lines.append(sug)

        # 搜索知识库：用故障类型中的每个独立词分别搜
        try:
            # 从故障类型中提取搜索词（英文/中文各一个）
            words = re.findall(r'[a-zA-Z0-9]+|[一-鿿]{1,3}', m["type"])
            keywords = list(dict.fromkeys(words))[:3]  # 去重取前3个
            conn = get_connection()
            kb = []
            for kw in keywords:
                rows = conn.execute(
                    "SELECT command, description FROM linux_knowledge "
                    "WHERE tags LIKE ? OR title LIKE ? OR solution LIKE ? LIMIT 2",
                    (f"%{kw}%", f"%{kw}%", f"%{kw}%"),
                ).fetchall()
                for row in rows:
                    if len(kb) < 3:
                        kb.append(row)
            if kb:
                lines.append("")
                lines.append("**诊断命令：**")
                for row in kb[:3]:
                    lines.append(f"- `{row['command']}` — {row['description']}")
        except Exception:
            pass

        lines.append("")

    lines.append("> ⚡ 以上为本地分析结果，基于日志模式匹配和历史知识库。")
    lines.append("> 如需更深入分析，请提供更多日志上下文或具体问题。")

    # 历史案例检索
    try:
        history = search_resolved(combined)
        if history:
            lines.append("")
            lines.append("**📚 相似历史案例：**")
            for h in history:
                lines.append(f"- [{h['title']}]({h['filename']})  (相似度: {'⭐' * h['score']})")
    except Exception:
        pass

    return "\n".join(lines), "本地分析"


def search_resolved(query: str, limit: int = 3) -> list[dict]:
    """从已解决目录搜历史案例"""
    import os
    from pathlib import Path
    rd = Path("/resolved")
    if not rd.exists():
        return []
    results = []
    words = query.lower().split()
    for md in rd.rglob("*.md"):
        if md.name == "index.md" or ".obsidian" in md.parts:
            continue
        try:
            content = md.read_text(encoding="utf-8")[:2000]
        except Exception:
            continue
        score = sum(1 for w in words if w in content.lower())
        if score > 0:
            # 提取标题
            title = md.stem
            for line in content.split("\n"):
                if line.startswith("title:"):
                    title = line.split(":", 1)[1].strip().strip('"')
                    break
            rel = md.relative_to(rd)
            results.append({"filename": str(rel), "title": title, "score": score})
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:limit]


def feed_known_pattern(log_text: str, session_id: str | None = None) -> None:
    """
    从用户上传的日志中提取错误模式，存入 error_patterns 表
    用于后续本地分析匹配。session_id 非空时同步记 anomaly_events（多台相同失败检测）。
    """
    conn = get_connection()

    # 提取 FAIL/ERROR 行
    fail_lines = re.findall(
        r'^.*((?:FAIL|ERROR|FATAL|CRITICAL|EXCEPTION)\S*).*$',
        log_text, re.MULTILINE | re.IGNORECASE,
    )

    # 提取错误关键词
    keywords = re.findall(
        r'(?:pci\S*\s*(?:fail|error|link|width|speed))|(?:x\d\s*vs\s*x\d)'
        r'|(?:invalid_dword)|(?:timeout|timed\s*out)'
        r'|(?:thermal|throttl|overheat)|(?:ecc|mce)'
        r'|(?:smart.*fail)|(?:link.*down)',
        log_text, re.IGNORECASE,
    )

    anomaly = None
    if session_id:
        try:
            from app.services.anomaly_service import anomaly_service
            anomaly = anomaly_service
        except Exception:
            anomaly = None

    for pattern in set(keywords + fail_lines[:20]):
        pattern_clean = pattern.strip()
        if len(pattern_clean) < 3:
            continue
        # 防止重复
        existing = conn.execute(
            "SELECT id FROM error_patterns WHERE pattern = ?", (pattern_clean,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE error_patterns SET count = count + 1, last_seen = datetime('now') WHERE id = ?",
                (existing["id"],),
            )
        else:
            severity = "high" if any(k in pattern_clean.lower() for k in
                ("fail", "error", "fatal", "critical", "timeout")) else "medium"
            conn.execute(
                "INSERT INTO error_patterns (pattern, description, severity, count) VALUES (?, ?, ?, 1)",
                (pattern_clean, f"从日志自动提取: {pattern_clean}", severity),
            )
        # 记 anomaly_event（带 session_id，机型由 record_event 从会话解析）
        if anomaly:
            try:
                anomaly.record_event(session_id, pattern_clean)
            except Exception:
                pass
    conn.commit()
