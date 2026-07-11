"""
Webhook 输出服务

支持企业微信、钉钉、飞书、自定义 URL。
"""

import logging
import uuid
from datetime import datetime

import httpx

from app.config.database import get_connection

logger = logging.getLogger(__name__)


def init_webhooks_table() -> None:
    """初始化 Webhook 表"""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS webhooks (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            type       TEXT NOT NULL CHECK (type IN ('wechat', 'dingtalk', 'feishu', 'custom')),
            url        TEXT NOT NULL,
            enabled    INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)


class WebhookService:
    """Webhook 服务"""

    def list_webhooks(self) -> list[dict]:
        """获取所有 Webhook"""
        conn = get_connection()
        rows = conn.execute("SELECT * FROM webhooks ORDER BY created_at ASC").fetchall()
        return [dict(row) for row in rows]

    def create_webhook(self, name: str, webhook_type: str, url: str) -> dict:
        """创建 Webhook"""
        conn = get_connection()
        webhook_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()

        conn.execute(
            "INSERT INTO webhooks (id, name, type, url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
            (webhook_id, name, webhook_type, url, now),
        )
        conn.commit()

        return {"id": webhook_id, "name": name, "type": webhook_type, "url": url, "enabled": 1, "created_at": now}

    def update_webhook(self, webhook_id: str, data: dict) -> bool:
        """更新 Webhook"""
        conn = get_connection()
        conn.execute(
            "UPDATE webhooks SET name = ?, type = ?, url = ?, enabled = ? WHERE id = ?",
            (data.get("name"), data.get("type"), data.get("url"), data.get("enabled", 1), webhook_id),
        )
        conn.commit()
        return True

    def delete_webhook(self, webhook_id: str) -> bool:
        """删除 Webhook"""
        conn = get_connection()
        cursor = conn.execute("DELETE FROM webhooks WHERE id = ?", (webhook_id,))
        conn.commit()
        return cursor.rowcount > 0

    async def send_alert(self, title: str, content: str, url: str = None) -> None:
        """
        发送告警到所有启用的 Webhook

        Args:
            title: 告警标题
            content: 告警内容
            url: 详情链接（可选）
        """
        webhooks = self.list_webhooks()
        enabled = [w for w in webhooks if w["enabled"]]

        for webhook in enabled:
            try:
                await self._send_to_webhook(webhook, title, content, url)
                logger.info(f"Webhook 发送成功: {webhook['name']}")
            except Exception as e:
                logger.error(f"Webhook 发送失败: {webhook['name']} - {e}")

    async def _send_to_webhook(self, webhook: dict, title: str, content: str, url: str = None) -> None:
        """发送到单个 Webhook"""
        webhook_type = webhook["type"]
        webhook_url = webhook["url"]

        if webhook_type == "wechat":
            await self._send_wechat(webhook_url, title, content, url)
        elif webhook_type == "dingtalk":
            await self._send_dingtalk(webhook_url, title, content, url)
        elif webhook_type == "feishu":
            await self._send_feishu(webhook_url, title, content, url)
        else:
            await self._send_custom(webhook_url, title, content, url)

    async def _send_wechat(self, url: str, title: str, content: str, detail_url: str = None) -> None:
        """企业微信机器人"""
        text = f"**{title}**\n\n{content}"
        if detail_url:
            text += f"\n\n[查看详情]({detail_url})"

        payload = {
            "msgtype": "markdown",
            "markdown": {"content": text},
        }

        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload)

    async def _send_dingtalk(self, url: str, title: str, content: str, detail_url: str = None) -> None:
        """钉钉机器人"""
        text = f"### {title}\n\n{content}"
        if detail_url:
            text += f"\n\n[查看详情]({detail_url})"

        payload = {
            "msgtype": "markdown",
            "markdown": {"title": title, "text": text},
        }

        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload)

    async def _send_feishu(self, url: str, title: str, content: str, detail_url: str = None) -> None:
        """飞书机器人"""
        text = f"**{title}**\n\n{content}"
        if detail_url:
            text += f"\n\n[查看详情]({detail_url})"

        payload = {
            "msg_type": "text",
            "content": {"text": text},
        }

        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload)

    async def _send_custom(self, url: str, title: str, content: str, detail_url: str = None) -> None:
        """自定义 URL"""
        payload = {
            "title": title,
            "content": content,
            "url": detail_url,
            "timestamp": datetime.utcnow().isoformat(),
        }

        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload)


# 全局实例
webhook_service = WebhookService()
