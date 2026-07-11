"""
告警规则引擎服务

管理告警规则，自动触发分析和通知。
"""

import logging
import re
import uuid
from datetime import datetime

import httpx

from app.config.database import get_connection
from app.config.settings import settings
from app.middlewares.error_handler import ValidationError

logger = logging.getLogger(__name__)


def init_rules_table() -> None:
    """初始化规则表"""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS alert_rules (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            condition    TEXT NOT NULL,
            time_window  TEXT NOT NULL DEFAULT '5m',
            enabled      INTEGER NOT NULL DEFAULT 1,
            action       TEXT NOT NULL DEFAULT 'auto_analyze',
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)

    # 预设规则
    presets = [
        ("错误过多", "error_count > 10", "5m", "auto_analyze"),
        ("严重错误", "fatal_count > 0", "1m", "auto_analyze"),
        ("错误激增", "error_count > prev_error_count * 2", "10m", "auto_analyze"),
    ]

    for name, cond, window, action in presets:
        conn.execute(
            "INSERT OR IGNORE INTO alert_rules (id, name, condition, time_window, action) VALUES (?, ?, ?, ?, ?)",
            (f"preset-{name}", name, cond, window, action),
        )
    conn.commit()


class RuleService:
    """告警规则服务"""

    def list_rules(self) -> list[dict]:
        """获取所有规则"""
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM alert_rules ORDER BY created_at ASC"
        ).fetchall()
        return [dict(row) for row in rows]

    def get_rule(self, rule_id: str) -> dict | None:
        """获取单个规则"""
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM alert_rules WHERE id = ?", (rule_id,)
        ).fetchone()
        return dict(row) if row else None

    def create_rule(
        self,
        name: str,
        condition: str,
        time_window: str = "5m",
        action: str = "auto_analyze",
    ) -> dict:
        """创建规则"""
        conn = get_connection()
        rule_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        conn.execute(
            """INSERT INTO alert_rules (id, name, condition, time_window, enabled, action, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, ?, ?, ?)""",
            (rule_id, name, condition, time_window, action, now, now),
        )
        conn.commit()

        return self.get_rule(rule_id)

    def update_rule(self, rule_id: str, data: dict) -> bool:
        """更新规则"""
        conn = get_connection()
        rule = self.get_rule(rule_id)
        if not rule:
            raise ValidationError("规则不存在")

        now = datetime.utcnow().isoformat()
        conn.execute(
            """UPDATE alert_rules
               SET name = ?, condition = ?, time_window = ?, enabled = ?, action = ?, updated_at = ?
               WHERE id = ?""",
            (
                data.get("name", rule["name"]),
                data.get("condition", rule["condition"]),
                data.get("time_window", rule["time_window"]),
                data.get("enabled", rule["enabled"]),
                data.get("action", rule["action"]),
                now,
                rule_id,
            ),
        )
        conn.commit()
        return True

    def delete_rule(self, rule_id: str) -> bool:
        """删除规则"""
        conn = get_connection()
        cursor = conn.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
        conn.commit()
        return cursor.rowcount > 0

    def evaluate_condition(self, condition: str, stats: dict) -> bool:
        """
        评估规则条件

        Args:
            condition: 条件表达式，如 "error_count > 10"
            stats: 统计数据 {"error_count": 5, "fatal_count": 0, ...}

        Returns:
            是否触发
        """
        try:
            # 简单的条件解析
            # 支持: error_count > 10, fatal_count > 0, error_count > prev_error_count * 2
            match = re.match(r"(\w+)\s*(>|>=|<|<=|==|!=)\s*(.+)", condition)
            if not match:
                return False

            field_name = match.group(1)
            operator = match.group(2)
            value_expr = match.group(3).strip()

            # 获取字段值
            field_value = stats.get(field_name)
            if field_value is None:
                return False

            # 计算比较值
            if "*" in value_expr or "/" in value_expr:
                # 支持简单算术: prev_error_count * 2
                parts = re.split(r"\s*([*/])\s*", value_expr)
                if len(parts) == 3:
                    ref_value = stats.get(parts[0], 0)
                    op = parts[1]
                    num = float(parts[2])
                    compare_value = ref_value * num if op == "*" else ref_value / num
                else:
                    compare_value = float(value_expr)
            else:
                compare_value = float(value_expr)

            # 比较
            if operator == ">":
                return field_value > compare_value
            elif operator == ">=":
                return field_value >= compare_value
            elif operator == "<":
                return field_value < compare_value
            elif operator == "<=":
                return field_value <= compare_value
            elif operator == "==":
                return field_value == compare_value
            elif operator == "!=":
                return field_value != compare_value

            return False
        except Exception as e:
            logger.error(f"条件评估失败: {condition} - {e}")
            return False

    async def trigger_alert(self, rule: dict, log_filename: str, stats: dict, session_id: str = None) -> None:
        """
        触发告警动作

        Args:
            rule: 规则配置
            log_filename: 日志文件名
            stats: 统计数据
            session_id: 关联会话 ID
        """
        action = rule.get("action", "auto_analyze")

        if action == "auto_analyze":
            await self._auto_analyze(rule, log_filename, stats, session_id)

        # 发送 webhook 通知
        webhook_url = self._get_webhook_url()
        if webhook_url:
            await self._send_webhook(webhook_url, rule, log_filename, stats)

    async def _auto_analyze(self, rule: dict, log_filename: str, stats: dict, session_id: str) -> None:
        """自动分析并保存到知识库"""
        from app.services.obsidian_service import obsidian_service

        # 构建分析 prompt
        prompt = f"""告警规则 "{rule['name']}" 已触发。

规则条件: {rule['condition']}
时间窗口: {rule['time_window']}

日志统计:
- 错误数: {stats.get('error_count', 0)}
- 警告数: {stats.get('warning_count', 0)}
- 严重错误: {stats.get('fatal_count', 0)}

请分析可能的原因并给出处理建议。"""

        # 调用 AI 分析
        try:
            from app.services.ai_service import ai_service
            messages = [
                {"role": "system", "content": "你是服务器日志分析专家。请分析以下告警信息。"},
                {"role": "user", "content": prompt},
            ]
            analysis = await ai_service.chat(messages, temperature=0.3)

            # 保存到知识库
            if obsidian_service.get_settings().get("webdav_url"):
                await obsidian_service.save_note(
                    title=f"告警: {rule['name']} - {log_filename}",
                    log_summary=f"错误: {stats.get('error_count', 0)}, 警告: {stats.get('warning_count', 0)}",
                    log_snippet=f"规则: {rule['condition']}",
                    analysis=analysis,
                    user="system",
                )
                logger.info(f"告警分析已保存: {rule['name']}")
        except Exception as e:
            logger.error(f"自动分析失败: {e}")

    async def _send_webhook(self, url: str, rule: dict, log_filename: str, stats: dict) -> None:
        """发送 webhook 通知"""
        try:
            payload = {
                "event": "alert_triggered",
                "rule": rule["name"],
                "condition": rule["condition"],
                "log_file": log_filename,
                "stats": stats,
                "timestamp": datetime.utcnow().isoformat(),
            }
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload)
                logger.info(f"Webhook 通知已发送: {resp.status_code}")
        except Exception as e:
            logger.error(f"Webhook 发送失败: {e}")

    def _get_webhook_url(self) -> str | None:
        """获取 webhook URL"""
        import os
        return os.getenv("ALERT_WEBHOOK_URL")


# 全局实例
rule_service = RuleService()
