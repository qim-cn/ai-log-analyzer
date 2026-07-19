"""
错误聚类路由

GET /api/logs/{log_id}/error-clusters -> 按归一化模式分组的错误聚类
（次数、首末出现时间、样例行、占比），按次数降序返回。
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.repositories.log_repository import log_repository
from app.services.error_cluster_service import error_cluster_service
from app.services.log_service import log_service
from app.utils.auth import require_log_owner as _require_log_owner

router = APIRouter()


@router.get("/{log_id}/error-clusters", response_model=dict)
async def get_error_clusters(log_id: str, request: Request, limit: int = 20):
    """
    获取日志错误聚类

    返回：{total_error_lines, clusters: [{pattern, count, first_seen, last_seen, sample, ratio}]}
    按出现次数降序，limit 控制最大聚类数。
    """
    _require_log_owner(log_id, request.state.user)
    lf = log_repository.get_by_id(log_id)
    if lf is None:
        raise ValidationError("日志文件不存在")

    content = log_service.get_log_content(lf)
    result = error_cluster_service.cluster_errors(content, limit=limit)

    return {
        "code": 0,
        "message": "success",
        "data": result,
    }
