"""
Webhook 路由

GET    /api/webhooks       → Webhook 列表
POST   /api/webhooks       → 创建 Webhook
PUT    /api/webhooks/:id   → 更新 Webhook
DELETE /api/webhooks/:id   → 删除 Webhook
POST   /api/webhooks/:id/test → 测试发送
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.services.webhook_service import webhook_service
from app.types.webhook_types import CreateWebhookRequest

router = APIRouter()


@router.get("", response_model=dict)
async def list_webhooks():
    """获取 Webhook 列表"""
    webhooks = webhook_service.list_webhooks()
    return {"code": 0, "message": "success", "data": {"webhooks": webhooks}}


@router.post("", response_model=dict)
async def create_webhook(body: CreateWebhookRequest, request: Request):
    """创建 Webhook（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足")

    if not body.name or not body.url:
        raise ValidationError("名称和 URL 不能为空")

    webhook = webhook_service.create_webhook(body.name, body.type, body.url)
    return {"code": 0, "message": "创建成功", "data": webhook}


@router.put("/{webhook_id}", response_model=dict)
async def update_webhook(webhook_id: str, body: dict, request: Request):
    """更新 Webhook（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足")

    webhook_service.update_webhook(webhook_id, body)
    return {"code": 0, "message": "更新成功", "data": None}


@router.delete("/{webhook_id}", response_model=dict)
async def delete_webhook(webhook_id: str, request: Request):
    """删除 Webhook（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足")

    webhook_service.delete_webhook(webhook_id)
    return {"code": 0, "message": "删除成功", "data": None}


@router.post("/{webhook_id}/test", response_model=dict)
async def test_webhook(webhook_id: str, request: Request):
    """测试 Webhook 发送（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足")

    await webhook_service.send_alert(
        title="测试通知",
        content="这是一条测试消息，用于验证 Webhook 配置是否正确。",
    )
    return {"code": 0, "message": "测试消息已发送", "data": None}
