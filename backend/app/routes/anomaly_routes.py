"""
异常检测路由

GET /api/anomaly/check?session_id= -> 检测当前会话机型的近期多台相同失败
"""

from fastapi import APIRouter, Request

from app.services.anomaly_service import anomaly_service
from app.utils.auth import require_session_owner as _require_session_owner

router = APIRouter()


@router.get("/check", response_model=dict)
async def check_anomaly(session_id: str, request: Request):
    """检测当前会话机型的近期多台相同失败（用于会话顶部横幅提示）"""
    _require_session_owner(session_id, request.state.user)
    result = anomaly_service.check(session_id)
    return {"code": 0, "data": result}
