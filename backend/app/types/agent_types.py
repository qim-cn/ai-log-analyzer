"""
Agent 自主排查相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class InvestigateRequest(BaseModel):
    """启动排查请求：session_id 与 log_id 二选一"""
    session_id: str | None = None
    log_id: str | None = None
