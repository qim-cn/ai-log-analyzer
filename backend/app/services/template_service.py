"""
快捷分析模板服务

管理预设模板和用户自定义模板。
"""

import uuid
from datetime import datetime

from app.config.database import get_connection


def init_templates_table() -> None:
    """初始化模板表"""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS analysis_templates (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            prompt     TEXT NOT NULL,
            is_preset  INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)

    # 插入预设模板（如果不存在）
    presets = [
        ("总结错误", "请总结这段日志中的所有错误，按严重程度排序，说明每种错误的出现次数和可能影响。", 1),
        ("找根因", "分析这段日志，找出最可能的根本原因，按可能性排序，每个原因附带推理过程和证据。", 2),
        ("排查步骤", "根据这些错误日志，生成详细的排查步骤清单，每步包含：检查命令、预期结果、异常处理。", 3),
        ("对比差异", "对比这两段日志，列出关键差异点，包括：新增错误、消失的错误、频率变化、新增组件。", 4),
        ("生成报告", "将分析结果整理为一份结构化的故障报告，包含：故障概述、影响范围、根因分析、解决方案、预防措施。", 5),
        ("硬件诊断", "分析这些日志，判断是硬件问题还是软件问题。如果是硬件问题，指出具体哪个部件（CPU/内存/硬盘/网卡/电源/风扇等）需要更换或维修。", 6),
    ]

    for name, prompt, order in presets:
        conn.execute(
            "INSERT OR IGNORE INTO analysis_templates (id, name, prompt, is_preset, sort_order) VALUES (?, ?, ?, 1, ?)",
            (f"preset-{order}", name, prompt, order),
        )
    conn.commit()


class TemplateService:
    """模板服务"""

    def list_templates(self) -> list[dict]:
        """获取所有模板"""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM analysis_templates ORDER BY sort_order ASC"
        ).fetchall()
        return [dict(row) for row in rows]

    def create_template(self, name: str, prompt: str) -> dict:
        """创建自定义模板"""
        conn = get_connection()
        template_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        # 获取最大排序号
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) as max_order FROM analysis_templates"
        ).fetchone()["max_order"]

        conn.execute(
            "INSERT INTO analysis_templates (id, name, prompt, is_preset, sort_order, created_at) VALUES (?, ?, ?, 0, ?, ?)",
            (template_id, name, prompt, max_order + 1, now),
        )
        conn.commit()

        return {
            "id": template_id,
            "name": name,
            "prompt": prompt,
            "is_preset": False,
            "sort_order": max_order + 1,
            "created_at": now,
        }

    def update_template(self, template_id: str, name: str, prompt: str) -> bool:
        """更新模板"""
        conn = get_connection()
        cursor = conn.execute(
            "UPDATE analysis_templates SET name = ?, prompt = ? WHERE id = ? AND is_preset = 0",
            (name, prompt, template_id),
        )
        conn.commit()
        return cursor.rowcount > 0

    def delete_template(self, template_id: str) -> bool:
        """删除模板（只能删除自定义模板）"""
        conn = get_connection()
        cursor = conn.execute(
            "DELETE FROM analysis_templates WHERE id = ? AND is_preset = 0",
            (template_id,),
        )
        conn.commit()
        return cursor.rowcount > 0


# 全局实例
template_service = TemplateService()
