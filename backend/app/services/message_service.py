"""
Message 业务逻辑层
"""

from app.models.message import Message, MessageRole
from app.repositories.message_repository import message_repository
from app.repositories.session_repository import session_repository


class MessageService:
    """消息管理服务"""

    def create_message(
        self, session_id: str, role: MessageRole, content: str
    ) -> Message:
        """创建消息并更新会话时间"""
        message = message_repository.create(session_id, role, content)
        session_repository.update_timestamp(session_id)
        return message

    def get_messages(self, session_id: str) -> list[Message]:
        """获取会话下的所有消息"""
        return message_repository.get_by_session(session_id)

    def get_recent_messages(
        self, session_id: str, limit: int = 20
    ) -> list[Message]:
        """获取会话下最近的消息"""
        return message_repository.get_recent_by_session(session_id, limit=limit)


# 全局实例
message_service = MessageService()
