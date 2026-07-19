"""
维修操作模板库路由

GET  /api/repair-templates?model=&limit= -> 模板列表（按机型过滤、频次降序）
POST /api/repair-templates/rebuild       -> 重建模板库（仅管理员）
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.services.repair_template_service import repair_template_service

router = APIRouter()


@router.get("", response_model=dict)
async def list_templates(model: str | None = None, limit: int = 50):
    """查询维修操作模板（按机型过滤，含通用模板）"""
    templates = repair_template_service.list(model=model, limit=limit)
    return {"code": 0, "data": {"templates": templates}}


@router.post("/rebuild", response_model=dict)
async def rebuild_templates(request: Request):
    """重建模板库（扫描 /resolved 所有案例，仅管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("仅管理员可重建模板库")
    count = repair_template_service.rebuild()
    return {"code": 0, "message": f"重建完成，共 {count} 条模板"}
