"""
AI Log Analyzer - FastAPI 应用入口

功能：
- 用户认证（JWT）
- 日志文件上传与解析
- 对话式 AI 分析（SSE 流式输出）
- 会话管理
- 运行时 AI 配置切换
"""

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config.database import close_database, init_database
from app.config.settings import settings
from app.middlewares.auth_middleware import AuthMiddleware
from app.middlewares.error_handler import register_error_handlers
from app.services.prometheus_service import prometheus_service
from app.services.rate_limiter import RateLimiterFactory
from app.utils.request import get_client_ip

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ============================================================
# 限流器（默认 SQLite，支持多容器复本共享）
# ============================================================
rate_limiter = RateLimiterFactory.get_limiter(
    backend=settings.rate_limiter_backend,
    max_requests=120,
    window_seconds=60,
)
logger.info(f"限流器后端: {settings.rate_limiter_backend}")


# ============================================================
# 应用生命周期
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("AI Log Analyzer 启动中...")
    Path(settings.log_storage_path).mkdir(parents=True, exist_ok=True)
    init_database()

    # 初始化模板表
    from app.services.template_service import init_templates_table
    init_templates_table()

    # 初始化规则表
    from app.services.rule_service import init_rules_table
    init_rules_table()

    # 初始化审计日志表
    from app.services.audit_service import init_audit_table
    init_audit_table()

    # 初始化 Webhook 表
    from app.services.webhook_service import init_webhooks_table
    init_webhooks_table()

    # 初始化 Linux 故障排查知识库
    from app.services.linux_knowledge_service import (
        init_linux_knowledge_table,
        seed_linux_knowledge,
    )
    init_linux_knowledge_table()
    seed_linux_knowledge()

    # 迁移：将没有 user_id 的会话归属管理员
    from app.config.database import get_connection
    from app.repositories.user_repository import user_repository
    admin = user_repository.get_first_admin()
    if admin:
        conn = get_connection()
        conn.execute(
            "UPDATE sessions SET user_id = ? WHERE user_id IS NULL",
            (admin.id,),
        )
        conn.commit()

    logger.info(f"数据库: {settings.database_path}")
    logger.info(f"日志存储: {settings.log_storage_path}")
    logger.info(f"AI 模型: {settings.ai_model}")
    yield
    close_database()
    logger.info("AI Log Analyzer 已停止")


app = FastAPI(
    title="AI Log Analyzer",
    description="AI 驱动的日志分析工具，支持对话式交互和流式输出",
    version="1.0.0",
    lifespan=lifespan,
)


# ============================================================
# 中间件（顺序很重要：先限流，再认证）
# ============================================================

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=("*" not in settings.allowed_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info(f"CORS allowed origins: {settings.allowed_origins}")

# JWT 认证
app.add_middleware(AuthMiddleware)


# 请求限流中间件
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """请求限流 + 请求日志"""
    client_ip = get_client_ip(request)

    if request.url.path == "/api/health":
        return await call_next(request)

    if not rate_limiter.is_allowed(client_ip):
        return JSONResponse(
            status_code=429,
            content={"code": 429, "message": "请求过于频繁，请稍后重试", "data": None},
        )

    start = time.time()
    response: Response = await call_next(request)
    duration = time.time() - start

    # 记录 Prometheus 指标（排除 /metrics 和 /health）
    if request.url.path not in ("/api/health", "/metrics"):
        prometheus_service.record_http_request(
            method=request.method,
            endpoint=request.url.path,
            status=response.status_code,
            duration=duration,
        )

    if request.url.path not in ("/api/health", "/metrics"):
        logger.info(
            f"{request.method} {request.url.path} "
            f"{response.status_code} {duration:.3f}s"
        )

    return response


# 注册错误处理器
register_error_handlers(app)


# ============================================================
# 路由注册
# ============================================================

from app.routes.agent_routes import router as agent_router
from app.routes.sop_routes import router as sop_router
from app.routes.anomaly_routes import router as anomaly_router
from app.routes.error_cluster_routes import router as error_cluster_router
from app.routes.repair_template_routes import router as repair_template_router
from app.routes.auth_routes import router as auth_router
from app.routes.audit_routes import router as audit_router
from app.routes.chat_routes import router as chat_router
from app.routes.cicd_routes import router as cicd_router
from app.routes.compare_routes import router as compare_router
from app.routes.export_routes import router as export_router
from app.routes.knowledge_routes import router as knowledge_router
from app.routes.log_routes import router as log_router
from app.routes.message_routes import router as message_router
from app.routes.obsidian_routes import router as obsidian_router
from app.routes.rule_routes import router as rule_router
from app.routes.session_routes import router as session_router
from app.routes.settings_routes import router as settings_router
from app.routes.template_routes import router as template_router
from app.routes.timeline_routes import router as timeline_router
from app.routes.user_routes import router as user_router
from app.routes.webhook_routes import router as webhook_router

app.include_router(agent_router, prefix="/api/agent", tags=["AI 自主排查"])
app.include_router(sop_router, prefix="/api/sop", tags=["SOP 生成"])
app.include_router(anomaly_router, prefix="/api/anomaly", tags=["异常检测"])
app.include_router(repair_template_router, prefix="/api/repair-templates", tags=["维修模板"])
app.include_router(auth_router, prefix="/api/auth", tags=["认证"])
app.include_router(user_router, prefix="/api/users", tags=["用户管理"])
app.include_router(session_router, prefix="/api/sessions", tags=["会话管理"])
app.include_router(message_router, prefix="/api/messages", tags=["消息管理"])
app.include_router(log_router, prefix="/api/logs", tags=["日志管理"])
app.include_router(compare_router, prefix="/api/logs", tags=["日志对比"])
app.include_router(error_cluster_router, prefix="/api/logs", tags=["错误聚类"])
app.include_router(chat_router, prefix="/api/chat", tags=["AI 对话"])
app.include_router(settings_router, prefix="/api/settings", tags=["配置管理"])
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["知识图谱"])
app.include_router(cicd_router, prefix="/api/cicd", tags=["CI/CD 集成"])
app.include_router(timeline_router, prefix="/api/timeline", tags=["时间线"])
app.include_router(obsidian_router, prefix="/api/obsidian", tags=["知识库"])
app.include_router(template_router, prefix="/api/templates", tags=["分析模板"])
app.include_router(export_router, prefix="/api/sessions", tags=["对话导出"])
app.include_router(rule_router, prefix="/api/rules", tags=["告警规则"])
app.include_router(webhook_router, prefix="/api/webhooks", tags=["Webhook"])
app.include_router(audit_router, prefix="/api/audit", tags=["审计日志"])


@app.get("/api/health")
async def health_check():
    """健康检查"""
    return {"status": "ok", "version": "1.0.0"}


@app.get("/metrics")
async def metrics():
    """Prometheus 指标端点"""
    from fastapi.responses import Response
    return Response(
        content=prometheus_service.get_metrics(),
        media_type=prometheus_service.get_content_type(),
    )


@app.get("/api/stats")
async def get_stats():
    """AI 调用统计"""
    from app.services.stats_service import stats_service
    return {
        "code": 0,
        "message": "success",
        "data": stats_service.get_stats(),
    }
