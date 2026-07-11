"""
Session 业务逻辑层
"""

from app.middlewares.error_handler import NotFoundError
from app.models.session import Session
from app.repositories.session_repository import session_repository


class SessionService:
    """会话管理服务"""

    def create_session(self, title: str | None = None, user_id: str | None = None) -> Session:
        """创建新会话"""
        return session_repository.create(title=title or "新对话", user_id=user_id)

    def get_session(self, session_id: str) -> Session:
        """获取会话（不存在则抛异常）"""
        session = session_repository.get_by_id(session_id)
        if session is None:
            raise NotFoundError(f"会话 {session_id} 不存在")
        return session

    def list_sessions(self, limit: int = 100, offset: int = 0) -> list[Session]:
        """获取所有会话列表（管理员用）"""
        return session_repository.list_all(limit=limit, offset=offset)

    def list_sessions_by_user(self, user_id: str, limit: int = 100, offset: int = 0) -> list[Session]:
        """获取指定用户的会话列表"""
        return session_repository.list_by_user(user_id=user_id, limit=limit, offset=offset)

    def update_title(self, session_id: str, title: str) -> Session:
        """更新会话标题"""
        session = self.get_session(session_id)
        session_repository.update_title(session_id, title)
        session.title = title
        return session

    def delete_session(self, session_id: str) -> None:
        """删除会话"""
        self.get_session(session_id)  # 验证存在
        session_repository.delete(session_id)


# 全局实例
session_service = SessionService()
