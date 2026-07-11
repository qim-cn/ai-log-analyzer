"""
模板路由

GET    /api/templates       → 模板列表
POST   /api/templates       → 创建模板（管理员）
PUT    /api/templates/:id   → 更新模板（管理员）
DELETE /api/templates/:id   → 删除模板（管理员）
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.services.template_service import template_service
from app.types.template_types import CreateTemplateRequest

router = APIRouter()


@router.get("", response_model=dict)
async def list_templates():
    """获取模板列表"""
    templates = template_service.list_templates()
    return {
        "code": 0,
        "message": "success",
        "data": {"templates": templates},
    }


@router.post("", response_model=dict)
async def create_template(body: CreateTemplateRequest, request: Request):
    """创建自定义模板（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")

    if not body.name or not body.prompt:
        raise ValidationError("模板名称和内容不能为空")

    template = template_service.create_template(body.name, body.prompt)
    return {"code": 0, "message": "模板创建成功", "data": template}


@router.put("/{template_id}", response_model=dict)
async def update_template(template_id: str, body: CreateTemplateRequest, request: Request):
    """更新模板（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")

    if not body.name or not body.prompt:
        raise ValidationError("模板名称和内容不能为空")

    success = template_service.update_template(template_id, body.name, body.prompt)
    if not success:
        raise ValidationError("模板不存在或为预设模板，无法修改")

    return {"code": 0, "message": "模板更新成功", "data": None}


@router.delete("/{template_id}", response_model=dict)
async def delete_template(template_id: str, request: Request):
    """删除模板（管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")

    success = template_service.delete_template(template_id)
    if not success:
        raise ValidationError("模板不存在或为预设模板，无法删除")

    return {"code": 0, "message": "模板删除成功", "data": None}
