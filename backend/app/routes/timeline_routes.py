"""
Timeline 路由定义

日志时间线可视化 API
"""

from fastapi import APIRouter

from app.services.timeline_service import timeline_service

router = APIRouter()


@router.get("/errors", response_model=dict)
async def get_error_timeline(
    session_id: str,
    interval: str = "hour",
):
    """
    获取错误时间线数据

    Args:
        session_id: 会话 ID
        interval: 时间间隔 (minute, hour, day)
    """
    result = timeline_service.get_error_timeline(session_id, interval)
    return {
        "code": 0,
        "message": "success",
        "data": result,
    }


@router.get("/context", response_model=dict)
async def get_log_context(
    log_id: str,
    line_number: int,
    context_lines: int = 20,
):
    """
    获取日志行的上下文

    Args:
        log_id: 日志文件 ID
        line_number: 行号
        context_lines: 上下文行数
    """
    result = timeline_service.get_log_context(log_id, line_number, context_lines)
    return {
        "code": 0,
        "message": "success",
        "data": result,
    }
