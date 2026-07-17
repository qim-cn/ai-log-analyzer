"""授权校验工具函数

集中存放会话/日志归属校验逻辑，供各路由复用，避免鉴权遗漏与重复代码。
"""

from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.repositories.log_repository import log_repository
from app.repositories.session_repository import session_repository


def require_session_owner(session_id: str, user) -> None:
    """校验当前用户是否拥有会话访问/修改权限（管理员放行）。

    user_id 为 NULL 的历史会话仅允许管理员访问，避免越权。
    """
    session = session_repository.get_by_id(session_id)
    if session is None:
        raise ValidationError("会话不存在")
    if user.role != UserRole.ADMIN and (
        session.user_id is None or session.user_id != user.id
    ):
        raise ValidationError("无权访问此会话")


def require_log_owner(log_id: str, user) -> None:
    """校验当前用户是否拥有日志文件访问/修改权限。"""
    lf = log_repository.get_by_id(log_id)
    if lf is None:
        raise ValidationError("日志文件不存在")
    require_session_owner(lf.session_id, user)
