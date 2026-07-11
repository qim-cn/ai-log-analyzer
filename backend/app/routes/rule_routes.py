"""
告警规则路由

GET    /api/rules       → 规则列表
POST   /api/rules       → 创建规则
PUT    /api/rules/:id   → 更新规则
DELETE /api/rules/:id   → 删除规则
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.services.rule_service import rule_service
from app.types.rule_types import CreateRuleRequest

router = APIRouter()


@router.get("", response_model=dict)
async def list_rules():
    """获取规则列表"""
    rules = rule_service.list_rules()
    return {
        "code": 0,
        "message": "success",
        "data": {"rules": rules},
    }


@router.post("", response_model=dict)
async def create_rule(body: CreateRuleRequest, request: Request):
    """创建规则（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")

    if not body.name or not body.condition:
        raise ValidationError("规则名称和条件不能为空")

    rule = rule_service.create_rule(
        name=body.name,
        condition=body.condition,
        time_window=body.time_window or "5m",
        action=body.action or "auto_analyze",
    )
    return {"code": 0, "message": "规则创建成功", "data": rule}


@router.put("/{rule_id}", response_model=dict)
async def update_rule(rule_id: str, body: dict, request: Request):
    """更新规则（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")

    rule_service.update_rule(rule_id, body)
    return {"code": 0, "message": "规则更新成功", "data": None}


@router.delete("/{rule_id}", response_model=dict)
async def delete_rule(rule_id: str, request: Request):
    """删除规则（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")

    rule_service.delete_rule(rule_id)
    return {"code": 0, "message": "规则删除成功", "data": None}
