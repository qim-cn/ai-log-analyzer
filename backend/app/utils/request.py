"""
请求工具函数
"""

from fastapi import Request

from app.config.settings import settings


def get_client_ip(request: Request) -> str:
    """获取真实客户端 IP。

    反向代理后端时 request.client.host 取到的是代理 IP，限流会失效。
    仅当直连 peer 在 settings.trusted_proxies 时才信任 X-Forwarded-For / X-Real-IP，
    防止客户端伪造代理头绕过限流。
    """
    peer = request.client.host if request.client else None
    if peer and peer in settings.trusted_proxies:
        # X-Forwarded-For: client, proxy1, proxy2；取最左侧（最原始）的客户端
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            first = xff.split(",")[0].strip()
            if first:
                return first
        xri = request.headers.get("x-real-ip", "").strip()
        if xri:
            return xri
    return peer or "unknown"
