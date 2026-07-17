"""
日志对比路由

POST /api/logs/compare → 对比两份日志
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.services.compare_service import compare_service
from app.utils.auth import require_log_owner as _require_log_owner
from app.types.compare_types import CompareRequest, CompareResponse

router = APIRouter()


@router.post("/compare", response_model=dict)
async def compare_logs(body: CompareRequest, request: Request):
    """
    对比两份日志

    请求：{"log_id_1": "xxx", "log_id_2": "xxx"}
    返回：结构化对比结果
    """
    if not body.log_id_1 or not body.log_id_2:
        raise ValidationError("请提供两份日志的 ID")

    if body.log_id_1 == body.log_id_2:
        raise ValidationError("不能对比同一份日志")

    # 归属校验：两份日志都必须属于当前用户（管理员放行）
    _require_log_owner(body.log_id_1, request.state.user)
    _require_log_owner(body.log_id_2, request.state.user)

    result = compare_service.compare_logs(body.log_id_1, body.log_id_2)

    return {
        "code": 0,
        "message": "success",
        "data": CompareResponse(
            total_lines_1=result.total_lines_1,
            total_lines_2=result.total_lines_2,
            added_lines=result.added_lines,
            removed_lines=result.removed_lines,
            modified_lines=result.modified_lines,
            unchanged_lines=result.unchanged_lines,
            new_errors=result.new_errors,
            fixed_errors=result.fixed_errors,
            changed_params=result.changed_params,
            diff_lines=result.diff_lines,
            summary=result.summary,
        ),
    }
