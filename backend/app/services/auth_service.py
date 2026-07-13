"""
认证服务

- bcrypt 密码哈希
- JWT token 生成和验证
- 默认管理员账号初始化
"""

import logging
import os
import time
from dataclasses import dataclass

import bcrypt
import jwt

from app.models.user import User, UserRole
from app.repositories.user_repository import user_repository

logger = logging.getLogger(__name__)

# JWT 配置
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
if JWT_SECRET == "ai-log-analyzer-secret-key-change-in-production":
    logger.warning("WARNING: 使用默认 JWT_SECRET，生产环境请设置环境变量 JWT_SECRET！")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24

# 默认管理员
DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin")


@dataclass
class LoginResult:
    """登录结果"""

    token: str
    user: User


class AuthService:
    """认证服务"""

    def init_default_admin(self) -> None:
        """启动时初始化默认管理员（仅当用户表为空且环境变量允许时）"""
        if user_repository.count() == 0:
            password_hash = self.hash_password(DEFAULT_ADMIN_PASSWORD)
            user_repository.create(
                username=DEFAULT_ADMIN_USERNAME,
                password_hash=password_hash,
                role=UserRole.ADMIN,
            )
            logger.warning(
                f"已创建默认管理员账号: {DEFAULT_ADMIN_USERNAME} / {DEFAULT_ADMIN_PASSWORD} "
                f"(请登录后立即修改密码)"
            )

    def hash_password(self, password: str) -> str:
        """bcrypt 哈希密码"""
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

    def verify_password(self, password: str, password_hash: str) -> bool:
        """验证密码"""
        return bcrypt.checkpw(
            password.encode("utf-8"), password_hash.encode("utf-8")
        )

    def create_token(self, user: User) -> str:
        """生成 JWT token"""
        payload = {
            "sub": user.id,
            "username": user.username,
            "role": user.role.value,
            "exp": int(time.time()) + JWT_EXPIRE_HOURS * 3600,
            "iat": int(time.time()),
        }
        return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    def verify_token(self, token: str) -> dict | None:
        """验证 JWT token，返回 payload 或 None"""
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            # 检查过期
            if payload.get("exp", 0) < time.time():
                return None
            return payload
        except jwt.InvalidTokenError:
            return None

    def login(self, username: str, password: str) -> LoginResult:
        """
        用户登录

        Raises:
            ValueError: 用户名或密码错误
        """
        user = user_repository.get_by_username(username)
        if user is None:
            raise ValueError("用户名或密码错误")

        if not self.verify_password(password, user.password_hash):
            raise ValueError("用户名或密码错误")

        token = self.create_token(user)
        return LoginResult(token=token, user=user)

    def get_user_from_token(self, token: str) -> User | None:
        """从 token 获取用户"""
        payload = self.verify_token(token)
        if payload is None:
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        return user_repository.get_by_id(user_id)


# 全局实例
auth_service = AuthService()
