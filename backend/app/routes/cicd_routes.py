"""
CI/CD 集成路由

支持：
- 构建失败时自动分析日志
- 与 Jenkins、GitHub Actions 集成
- Webhook 回调
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.services.log_service import log_service
from app.services.knowledge_graph import knowledge_graph
from app.services.vector_store import vector_store
from app.repositories.log_repository import log_repository
from app.repositories.session_repository import session_repository

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求模型
# ============================================================

class CICDLogRequest(BaseModel):
    """CI/CD 日志上传请求"""
    pipeline_id: str
    pipeline_name: str
    provider: str  # jenkins, github_actions, gitlab_ci, etc.
    status: str  # failed, success, canceled
    branch: Optional[str] = None
    commit_sha: Optional[str] = None
    commit_message: Optional[str] = None
    log_content: str
    metadata: Optional[dict] = None


class GitHubWebhookPayload(BaseModel):
    """GitHub Actions Webhook"""
    action: str
    workflow_run: Optional[dict] = None
    repository: Optional[dict] = None


class JenkinsWebhookPayload(BaseModel):
    """Jenkins Webhook"""
    build: dict
    project: dict


# ============================================================
# API 端点
# ============================================================

@router.post("/analyze", response_model=dict)
async def analyze_cicd_log(request: CICDLogRequest):
    """
    分析 CI/CD 构建日志

    自动分析构建失败原因，提供修复建议。
    """
    # 创建会话
    session = session_repository.create(
        title=f"[{request.provider}] {request.pipeline_name} - {request.status}"
    )

    # 保存日志
    from app.models.log_file import LogFileType
    log_file = log_repository.create(
        session_id=session.id,
        filename=f"{request.pipeline_id}.log",
        file_type=LogFileType.LOG,
        file_size=len(request.log_content.encode()),
        line_count=request.log_content.count('\n') + 1,
        content=request.log_content,
    )

    # 生成嵌入向量
    await vector_store.add_log(
        log_id=log_file.id,
        text=request.log_content,
        metadata={
            "session_id": session.id,
            "pipeline_id": request.pipeline_id,
            "provider": request.provider,
            "status": request.status,
        },
    )

    # 提取知识图谱实体
    entities = await knowledge_graph.extract_entities(request.log_content)
    knowledge_graph.build_relations(entities)
    knowledge_graph.save_to_database(log_file.id, entities)

    # 搜索相似历史问题
    similar_logs = await vector_store.search_similar(
        text=request.log_content,
        limit=3,
    )

    # 构建响应
    result = {
        "session_id": session.id,
        "log_id": log_file.id,
        "status": request.status,
        "entities": entities,
        "similar_issues": similar_logs,
        "analysis_summary": _build_analysis_summary(entities, similar_logs),
    }

    return {
        "code": 0,
        "message": "分析完成",
        "data": result,
    }


@router.post("/webhook/github", response_model=dict)
async def github_webhook(
    payload: GitHubWebhookPayload,
    x_github_event: Optional[str] = Header(None),
):
    """
    GitHub Actions Webhook

    自动接收 GitHub Actions 工作流事件
    """
    if x_github_event != "workflow_run":
        return {"code": 0, "message": "ignored", "data": None}

    if not payload.workflow_run:
        raise HTTPException(status_code=400, detail="Missing workflow_run data")

    workflow = payload.workflow_run
    status = workflow.get("conclusion", "unknown")

    # 只处理失败的构建
    if status != "failure":
        return {"code": 0, "message": "ignored", "data": {"status": status}}

    logger.info(f"GitHub Actions build failed: {workflow.get('name')}")

    return {
        "code": 0,
        "message": "received",
        "data": {
            "workflow": workflow.get("name"),
            "status": status,
            "run_id": workflow.get("id"),
        },
    }


@router.post("/webhook/jenkins", response_model=dict)
async def jenkins_webhook(payload: JenkinsWebhookPayload):
    """
    Jenkins Webhook

    自动接收 Jenkins 构建事件
    """
    build = payload.build
    status = build.get("status", "unknown")

    # 只处理失败的构建
    if status != "FAILURE":
        return {"code": 0, "message": "ignored", "data": {"status": status}}

    logger.info(f"Jenkins build failed: {payload.project.get('name')}")

    return {
        "code": 0,
        "message": "received",
        "data": {
            "project": payload.project.get("name"),
            "build_number": build.get("number"),
            "status": status,
        },
    }


@router.post("/webhook/gitlab", response_model=dict)
async def gitlab_webhook(payload: dict):
    """
    GitLab CI Webhook

    自动接收 GitLab CI 管道事件
    """
    object_kind = payload.get("object_kind")

    if object_kind != "pipeline":
        return {"code": 0, "message": "ignored", "data": None}

    pipeline = payload.get("object_attributes", {})
    status = pipeline.get("status", "unknown")

    if status != "failed":
        return {"code": 0, "message": "ignored", "data": {"status": status}}

    logger.info(f"GitLab CI pipeline failed: {pipeline.get('id')}")

    return {
        "code": 0,
        "message": "received",
        "data": {
            "pipeline_id": pipeline.get("id"),
            "status": status,
            "ref": pipeline.get("ref"),
        },
    }


@router.get("/templates", response_model=dict)
async def get_cicd_templates():
    """
    获取 CI/CD 集成模板

    返回各平台的配置示例
    """
    templates = {
        "github_actions": {
            "name": "GitHub Actions",
            "description": "GitHub Actions CI/CD integration",
            "config_url": "https://docs.github.com/en/actions",
        },
        "jenkins": {
            "name": "Jenkins",
            "description": "Jenkins CI/CD integration",
            "config_url": "https://www.jenkins.io/doc/",
        },
        "gitlab_ci": {
            "name": "GitLab CI",
            "description": "GitLab CI/CD integration",
            "config_url": "https://docs.gitlab.com/ee/ci/",
        },
    }

    return {
        "code": 0,
        "message": "success",
        "data": {"templates": templates},
    }


# ============================================================
# 辅助函数
# ============================================================

def _build_analysis_summary(entities: dict, similar_logs: list) -> dict:
    """构建分析摘要"""
    errors = entities.get("errors", [])
    solutions = entities.get("solutions", [])

    summary = {
        "error_count": len(errors),
        "solution_count": len(solutions),
        "similar_issue_count": len(similar_logs),
        "main_errors": [e["name"] for e in errors[:3]],
        "suggested_solutions": [s["name"] for s in solutions[:3]],
    }

    # 从相似问题中提取解决方案
    if similar_logs:
        summary["similar_solutions"] = [
            {
                "log_id": log["log_id"],
                "similarity": log["similarity"],
                "preview": log.get("preview", ""),
            }
            for log in similar_logs
        ]

    return summary
