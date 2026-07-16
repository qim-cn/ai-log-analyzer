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
            solution    TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_linux_knowledge_category
            ON linux_knowledge(category);
    """)
    conn.commit()
    logger.info("Linux knowledge table ready")


def seed_linux_knowledge() -> None:
    """从 JSON 文件导入种子数据（幂等：已有数据则跳过）"""
    conn = get_connection()

    # 检查是否已导入
    count = conn.execute("SELECT COUNT(*) FROM linux_knowledge").fetchone()[0]
    if count > 0:
        logger.info(f"Linux knowledge already seeded ({count} entries), skipping")
        return

    if not SEED_FILE.exists():
        logger.warning(f"Seed file not found: {SEED_FILE}")
        return

    with open(SEED_FILE, "r", encoding="utf-8") as f:
        entries = json.load(f)

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


def get_knowledge_stats() -> dict:
    """获取知识库统计"""
    conn = get_connection()
    total = conn.execute("SELECT COUNT(*) FROM linux_knowledge").fetchone()[0]
    categories = conn.execute(
        "SELECT COUNT(DISTINCT category) FROM linux_knowledge"
    ).fetchone()[0]
    return {"total_entries": total, "total_categories": categories}
