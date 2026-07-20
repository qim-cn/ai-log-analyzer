"""
Session 业务逻辑层
"""

from app.middlewares.error_handler import NotFoundError
from app.models.message import MessageRole
from app.models.session import Session
from app.repositories.session_repository import session_repository


def build_title_prompt(user_content: str, assistant_content: str) -> list[dict]:
    """组装自动生成会话标题的 prompt（各取前 500 字，控制 token）"""
    return [
        {
            "role": "user",
            "content": (
                "根据以下问答内容，生成一个 15 字以内的简短会话标题"
                "（如\"nginx 502 排查\"）。只输出标题本身，不要引号、不要解释。\n\n"
                f"用户提问：{user_content[:500]}\n\n"
                f"AI 回答：{assistant_content[:500]}"
            ),
        }
    ]


def clean_generated_title(raw: str) -> str:
    """清洗 AI 生成的标题：去引号/换行，截断到 20 字"""
    return (
        raw.strip()
        .strip("\"'「」《》`")
        .replace("\n", " ")
        .strip()[:20]
        .strip()
    )


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

    async def generate_auto_title(self, session_id: str) -> tuple[str, bool]:
        """第一轮问答后调用 AI 生成简短会话标题

        Returns:
            (标题, 是否更新)；消息不足或 AI 不可用时返回 (当前标题, False)，
            由调用方决定静默处理。
        """
        from app.repositories.message_repository import message_repository
        from app.services.ai_service import ai_service

        session = self.get_session(session_id)
        messages = message_repository.get_by_session(session_id, limit=2)
        user_msg = next((m for m in messages if m.role == MessageRole.USER), None)
        assistant_msg = next(
            (m for m in messages if m.role == MessageRole.ASSISTANT), None
        )
        if not user_msg or not assistant_msg:
            return session.title, False

        try:
            raw = await ai_service.chat(
                build_title_prompt(user_msg.content, assistant_msg.content),
                temperature=0.3,
            )
        except Exception:
            # AI 不可用：保持原标题，静默失败
            return session.title, False

        title = clean_generated_title(raw)
        if not title:
            return session.title, False

        self.update_title(session_id, title)
        return title, True

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
