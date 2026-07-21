"""
维修操作模板库服务

从已解决案例的「## 🛠️ 维修操作」段聚合常用动作，保存知识库时点选插入，减少手打。
- rebuild(): 扫描 /resolved 所有案例重建模板库
- list(model): 查询模板，按机型过滤、频次降序
- record_from_body(model, body): 保存案例时增量更新
"""

import logging
import re
import uuid
from pathlib import Path

from app.config.database import get_connection

logger = logging.getLogger(__name__)

# 匹配「## ...维修操作...」标题段，到下一个 ## 标题或结尾
SECTION_RE = re.compile(r'## .*维修操作.*\n(.*?)(?=\n## |\Z)', re.DOTALL)
MODEL_RE = re.compile(r'^model:\s*(.+)$', re.MULTILINE)


class RepairTemplateService:
    """维修操作模板库"""

    def _extract(self, content: str) -> tuple[str | None, str]:
        """从案例正文提取 (model, repair_text)"""
        model = None
        m = MODEL_RE.search(content)
        if m:
            model = m.group(1).strip()
        s = SECTION_RE.search(content)
        repair = s.group(1).strip() if s else ""
        return model, repair

    @staticmethod
    def _lines(text: str) -> list[str]:
        """拆维修操作段为干净条目行"""
        out = []
        for line in text.split('\n'):
            line = line.strip().lstrip('-').lstrip('•').lstrip('*').strip()
            if len(line) >= 4:
                out.append(line)
        return out

    def rebuild(self) -> int:
        """扫描已解决案例所有案例，重建模板库。返回模板条数。"""
        from app.services.obsidian_service import get_resolved_base
        conn = get_connection()
        conn.execute("DELETE FROM repair_templates")
        counter: dict[tuple[str, str], int] = {}
        base = get_resolved_base()
        if base.exists():
            for md in base.rglob('*.md'):
                try:
                    content = md.read_text(encoding='utf-8')
                except Exception:
                    continue
                model, repair = self._extract(content)
                if not repair:
                    continue
                for line in self._lines(repair):
                    key = (model or '', line)
                    counter[key] = counter.get(key, 0) + 1
        rows = 0
        for (model, text), count in counter.items():
            conn.execute(
                "INSERT INTO repair_templates (id, model, text, count) VALUES (?, ?, ?, ?)",
                (uuid.uuid4().hex, model, text, count),
            )
            rows += 1
        conn.commit()
        logger.info(f"维修模板库重建: {rows} 条")
        return rows

    def list(self, model: str | None = None, limit: int = 50) -> list[dict]:
        """查询模板，按机型过滤（含空机型通用模板），频次降序"""
        conn = get_connection()
        if model:
            rows = conn.execute(
                "SELECT text, model, count FROM repair_templates "
                "WHERE model = ? OR model = '' ORDER BY count DESC LIMIT ?",
                (model, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT text, model, count FROM repair_templates "
                "ORDER BY count DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def record_from_body(self, model: str | None, body: str) -> None:
        """保存案例时增量更新：从正文解析维修操作段，频次 +1"""
        if not body:
            return
        _, repair = self._extract(body)
        if not repair:
            return
        conn = get_connection()
        model = model or ''
        for line in self._lines(repair):
            existing = conn.execute(
                "SELECT id FROM repair_templates WHERE model = ? AND text = ?",
                (model, line),
            ).fetchone()
            if existing:
                conn.execute(
                    "UPDATE repair_templates SET count = count + 1, updated_at = datetime('now') "
                    "WHERE id = ?",
                    (existing["id"],),
                )
            else:
                conn.execute(
                    "INSERT INTO repair_templates (id, model, text, count) VALUES (?, ?, ?, 1)",
                    (uuid.uuid4().hex, model, line),
                )
        conn.commit()


repair_template_service = RepairTemplateService()
