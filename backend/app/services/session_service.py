"""
Session 业务逻辑层
"""

from app.middlewares.error_handler import NotFoundError
from app.models.session import Session
from app.repositories.session_repository import session_repository


class SessionService:
    """会话管理服务"""

    def create_session(
        self,
        title: str | None = None,
        user_id: str | None = None,
        model: str | None = None,
        sn: str | None = None,
    ) -> Session:
        """创建新会话"""
        return session_repository.create(
            title=title or "新对话", user_id=user_id, model=model, sn=sn
        )

    def get_session(self, session_id: str) -> Session:
        """获取会话（不存在则抛异常）"""
        session = session_repository.get_by_id(session_id)
        if session is None:
            raise NotFoundError(f"会话 {session_id} 不存在")
        return session

    def list_sessions(
        self, limit: int = 100, offset: int = 0,
        model: str | None = None, status: str | None = None, q: str | None = None,
    ) -> list[Session]:
        """获取所有会话列表（管理员用），支持筛选"""
        return session_repository.list_all(
            limit=limit, offset=offset, model=model, status=status, q=q
        )

    def list_sessions_by_user(
        self, user_id: str, limit: int = 100, offset: int = 0,
        model: str | None = None, status: str | None = None, q: str | None = None,
    ) -> list[Session]:
        """获取指定用户的会话列表，支持筛选"""
        return session_repository.list_by_user(
            user_id=user_id, limit=limit, offset=offset, model=model, status=status, q=q
        )

    def update_title(self, session_id: str, title: str) -> Session:
        """更新会话标题"""
        session = self.get_session(session_id)
        session_repository.update_title(session_id, title)
        session.title = title
        return session

    def update_model(self, session_id: str, model: str | None = None, sn: str | None = None) -> Session:
        """更新机型/SN"""
        session = self.get_session(session_id)
        session_repository.update_model(session_id, model=model, sn=sn)
        if model is not None:
            session.model = model
        if sn is not None:
            session.sn = sn
        return session

    def update_status(self, session_id: str, status: str) -> Session:
        """更新会话状态（open/resolved）"""
        session = self.get_session(session_id)
        session_repository.update_status(session_id, status)
        session.status = status
        return session

    def delete_session(self, session_id: str) -> None:
        """删除会话"""
        self.get_session(session_id)  # 验证存在
        session_repository.delete(session_id)


# 全局实例
session_service = SessionService()
