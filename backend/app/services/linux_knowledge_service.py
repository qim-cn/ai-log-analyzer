"""
Linux 故障排查知识库服务

管理内置的 Linux 命令知识库：建表、种子导入、全文搜索。
"""

import json
import logging
import os
from pathlib import Path

from app.config.database import get_connection

logger = logging.getLogger(__name__)

# 种子数据路径（相对于 app/ 目录）
SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "linux_troubleshooting.json"


def init_linux_knowledge_table() -> None:
    """创建 linux 知识库表"""
    conn = get_connection()
    conn.executescript("""
        -- Linux 故障排查知识库
        CREATE TABLE IF NOT EXISTS linux_knowledge (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            category    TEXT NOT NULL,
            title       TEXT NOT NULL,
            command     TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            tags        TEXT NOT NULL DEFAULT '',
            solution    TEXT NOT NULL DEFAULT '',
            source      TEXT NOT NULL DEFAULT 'builtin'
                CHECK (source IN ('builtin', 'custom'))
        );

        CREATE INDEX IF NOT EXISTS idx_linux_knowledge_category
            ON linux_knowledge(category);
    """)
    # 迁移：旧表可能没有 source 列
    try:
        conn.execute("SELECT source FROM linux_knowledge LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE linux_knowledge ADD COLUMN source TEXT NOT NULL DEFAULT 'builtin'")
        conn.commit()
    conn.commit()
    logger.info("Linux knowledge table ready")


def seed_linux_knowledge() -> None:
    """从 JSON 文件导入种子数据（条目数变化则自动重建）"""
    conn = get_connection()

    if not SEED_FILE.exists():
        logger.warning(f"Seed file not found: {SEED_FILE}")
        return

    with open(SEED_FILE, "r", encoding="utf-8") as f:
        entries = json.load(f)

    expected = len(entries)
    current = conn.execute("SELECT COUNT(*) FROM linux_knowledge").fetchone()[0]
    if current == expected:
        logger.info(f"Linux knowledge up to date ({current} entries), skipping")
        return

    # 仅替换内置条目，保护用户自定义条目
    custom_count = conn.execute(
        "SELECT COUNT(*) FROM linux_knowledge WHERE source = 'custom'"
    ).fetchone()[0]
    conn.execute("DELETE FROM linux_knowledge WHERE source = 'builtin'")
    logger.info(f"Rebuilding builtin knowledge: {current - custom_count}→{expected} (+{custom_count} custom)")

    inserted = 0
    for entry in entries:
        conn.execute(
            """INSERT INTO linux_knowledge (category, title, command, description, tags, solution)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                entry["category"],
                entry["title"],
                entry["command"],
                entry["description"],
                entry["tags"],
                entry["solution"],
            ),
        )
        inserted += 1

    conn.commit()
    logger.info(f"Seeded {inserted} Linux knowledge entries")


def search_linux_knowledge(
    query: str = "",
    category: str = "",
    limit: int = 20,
) -> list[dict]:
    """
    搜索 Linux 知识库

    Args:
        query: 搜索关键词（匹配标题、命令、描述、标签、解决方案）
        category: 按分类过滤（可选）
        limit: 返回数量

    Returns:
        匹配的知识条目列表
    """
    conn = get_connection()

    if query:
        # 全文搜索（LIKE 多字段匹配）
        like = f"%{query}%"
        if category:
            rows = conn.execute(
                """SELECT id, category, title, command, description, tags, solution
                   FROM linux_knowledge
                   WHERE category = ?
                     AND (title LIKE ? OR command LIKE ? OR description LIKE ?
                          OR tags LIKE ? OR solution LIKE ?)
                   ORDER BY category, id
                   LIMIT ?""",
                (category, like, like, like, like, like, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT id, category, title, command, description, tags, solution
                   FROM linux_knowledge
                   WHERE title LIKE ? OR command LIKE ? OR description LIKE ?
                      OR tags LIKE ? OR solution LIKE ?
                   ORDER BY category, id
                   LIMIT ?""",
                (like, like, like, like, like, limit),
            ).fetchall()
    elif category:
        rows = conn.execute(
            """SELECT id, category, title, command, description, tags, solution
               FROM linux_knowledge
               WHERE category = ?
               ORDER BY id
               LIMIT ?""",
            (category, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT id, category, title, command, description, tags, solution
               FROM linux_knowledge
               ORDER BY category, id
               LIMIT ?""",
            (limit,),
        ).fetchall()

    return [dict(row) for row in rows]


def list_categories() -> list[dict]:
    """列出所有分类及条目数"""
    conn = get_connection()
    rows = conn.execute(
        """SELECT category, COUNT(*) AS count
           FROM linux_knowledge
           GROUP BY category
           ORDER BY category"""
    ).fetchall()
    return [dict(row) for row in rows]


def add_entry(category: str, title: str, command: str,
              description: str = "", tags: str = "", solution: str = "") -> dict:
    """添加自定义条目（source='custom'，不会被种子数据覆盖）"""
    conn = get_connection()
    cur = conn.execute(
        """INSERT INTO linux_knowledge (category, title, command, description, tags, solution, source)
           VALUES (?, ?, ?, ?, ?, ?, 'custom')""",
        (category, title, command, description, tags, solution),
    )
    conn.commit()
    entry_id = cur.lastrowid
    logger.info(f"User added knowledge entry {entry_id}: {title}")
    row = conn.execute("SELECT * FROM linux_knowledge WHERE id = ?", (entry_id,)).fetchone()
    return dict(row)


def update_entry(entry_id: int, **fields) -> dict | None:
    """更新条目，只更新传入的非空字段"""
    allowed = {"category", "title", "command", "description", "tags", "solution"}
    updates = {k: v for k, v in fields.items() if k in allowed and v}
    if not updates:
        return None
    conn = get_connection()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [entry_id]
    conn.execute(f"UPDATE linux_knowledge SET {set_clause} WHERE id = ?", values)
    conn.commit()
    logger.info(f"User updated knowledge entry {entry_id}")
    row = conn.execute("SELECT * FROM linux_knowledge WHERE id = ?", (entry_id,)).fetchone()
    return dict(row) if row else None


def delete_entry(entry_id: int) -> bool:
    """删除条目"""
    conn = get_connection()
    cur = conn.execute("DELETE FROM linux_knowledge WHERE id = ?", (entry_id,))
    conn.commit()
    deleted = cur.rowcount > 0
    if deleted:
        logger.info(f"User deleted knowledge entry {entry_id}")
    return deleted


def get_knowledge_stats() -> dict:
    """获取知识库统计"""
    conn = get_connection()
    total = conn.execute("SELECT COUNT(*) FROM linux_knowledge").fetchone()[0]
    categories = conn.execute(
        "SELECT COUNT(DISTINCT category) FROM linux_knowledge"
    ).fetchone()[0]
    return {"total_entries": total, "total_categories": categories}
