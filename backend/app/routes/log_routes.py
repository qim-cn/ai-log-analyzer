"""
Log 路由定义

处理日志文件的上传、查询、删除、统计。
上传时自动生成结构化摘要和嵌入向量。
"""

import json
import logging
from fastapi import APIRouter, Request, UploadFile

from app.config.database import get_connection
from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.repositories.log_repository import log_repository
from app.repositories.session_repository import session_repository
from app.services.cluster_service import cluster_service
from app.utils.auth import require_log_owner as _require_log_owner, require_session_owner as _require_session_owner
from app.services.knowledge_graph import knowledge_graph
from app.services.log_service import log_service
from app.services.masking_service import summarize_mapping
from app.services.vector_store import vector_store
from app.types.log_types import (
    LogFileListResponse,
    LogFileResponse,
    LogStatisticsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/upload", response_model=dict)
async def upload_log(session_id: str, file: UploadFile, request: Request):
    """
    上传日志文件

    - 支持 .log / .txt / .csv 格式
    - 最大 50MB
    - 自动生成结构化摘要（时间范围、错误统计、关键告警）
    - 大文件（>10MB）使用流式分块解析
    - 自动生成嵌入向量用于相似度匹配
    - 自动提取知识图谱实体
    """
    # 会话所有权校验
    _require_session_owner(session_id, request.state.user)

    # 前置大小校验：避免把超大文件全量读进内存后再校验（DoS）。
    # 优先用 UploadFile.size，回退 Content-Length；二者都拿不到时走流式按累计字节拦截。
    MAX_SIZE = log_service.MAX_FILE_SIZE
    declared = getattr(file, "size", None) or int(request.headers.get("content-length", 0) or 0)
    if declared and declared > MAX_SIZE:
        raise ValidationError(f"文件大小超过限制 (最大 50MB)")

    SMALL_THRESHOLD = 1024 * 1024  # 1MB
    if declared and declared <= SMALL_THRESHOLD:
        # 小文件：读入内存存 DB（保留 content 字段，供本地分析/标题提取使用）
        content = await file.read()
        log_file = log_service.upload_log(
            session_id=session_id,
            filename=file.filename or "unknown.log",
            content=content,
        )
    else:
        # 大文件或大小未知：流式写盘，分块读取不占内存
        async def _iter_chunks(chunk_size: int = 1024 * 1024):
            total = 0
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SIZE:
                    raise ValidationError(f"文件大小超过限制 (最大 50MB)")
                yield chunk

        log_file = await log_service.upload_log_streaming(
            session_id=session_id,
            filename=file.filename or "unknown.log",
            file_iterator=_iter_chunks(),
            file_size=declared,
        )

    # 异步生成嵌入向量和提取知识图谱实体（不阻塞响应）
    try:
        log_content = log_service.get_log_content(log_file)

        # 生成嵌入向量
        await vector_store.add_log(
            log_id=log_file.id,
            text=log_content,
            metadata={
                "session_id": session_id,
                "filename": log_file.filename,
                "file_type": log_file.file_type.value,
            },
        )

        # 提取知识图谱实体
        entities = await knowledge_graph.extract_entities(log_content)
        knowledge_graph.build_relations(entities)
        knowledge_graph.save_to_database(log_file.id, entities)

        logger.info(f"日志 {log_file.id} 嵌入和实体提取完成")
    except Exception as e:
        # 嵌入/实体提取失败不影响上传成功
        logger.warning(f"日志 {log_file.id} 嵌入/实体提取失败: {e}")

    return {
        "code": 0,
        "message": "上传成功",
        "data": LogFileResponse(
            id=log_file.id,
            session_id=log_file.session_id,
            filename=log_file.filename,
            file_type=log_file.file_type.value,
            file_size=log_file.file_size,
            line_count=log_file.line_count,
            content=None,
            disk_path=None,
            summary=log_file.summary,
            created_at=log_file.created_at,
            has_masking_map=bool(log_file.masking_map),
        ),
    }


@router.get("/{session_id}", response_model=dict)
async def list_logs(session_id: str, request: Request):
    """获取会话下的日志文件列表"""
    _require_session_owner(session_id, request.state.user)
    files = log_service.get_logs_by_session(session_id)
    return {
        "code": 0,
        "message": "success",
        "data": LogFileListResponse(
            files=[
                LogFileResponse(
                    id=f.id,
                    session_id=f.session_id,
                    filename=f.filename,
                    file_type=f.file_type.value,
                    file_size=f.file_size,
                    line_count=f.line_count,
                    content=None,
                    disk_path=None,
                    summary=f.summary,
                    created_at=f.created_at,
                    has_masking_map=bool(f.masking_map),
                )
                for f in files
            ]
        ),
    }


@router.get("/{log_id}/statistics", response_model=dict)
async def get_log_statistics(log_id: str, request: Request):
    """
    获取日志文件的详细统计信息

    返回结构化统计：
    - 按级别统计（error/warning/info/debug）
    - 按来源统计（top 10）
    - 按小时分布
    - 错误类型分布
    - 关键告警列表
    """
    _require_log_owner(log_id, request.state.user)
    stats = log_service.get_log_statistics(log_id)
    return {
        "code": 0,
        "message": "success",
        "data": LogStatisticsResponse(
            total_lines=stats.total_lines,
            file_size_mb=stats.file_size_mb,
            time_start=stats.time_start,
            time_end=stats.time_end,
            level_counts=stats.level_counts,
            source_counts=stats.source_counts,
            hour_distribution=stats.hour_distribution,
            error_types=stats.error_types,
            key_alerts=stats.key_alerts,
            detected_format=stats.detected_format,
        ),
    }


@router.get("/{log_id}/masking-map", response_model=dict)
async def get_masking_map(log_id: str, request: Request):
    """
    获取日志文件的脱敏映射（占位符 -> 原始值）和每类数量统计

    用于用户确认脱敏是否正确、有没有误伤；未脱敏的日志返回空结构。
    """
    _require_log_owner(log_id, request.state.user)
    lf = log_repository.get_by_id(log_id)
    if lf is None:
        raise ValidationError("日志文件不存在")

    mapping: dict = {}
    if lf.masking_map:
        try:
            mapping = json.loads(lf.masking_map)
        except (json.JSONDecodeError, TypeError):
            logger.warning(f"日志 {log_id} 的 masking_map 解析失败")
            mapping = {}

    return {
        "code": 0,
        "message": "success",
        "data": {
            "mapping": mapping,
            "stats": summarize_mapping(mapping),
            "total": len(mapping),
        },
    }


@router.get("/{log_id}/content-slice", response_model=dict)
async def get_content_slice(
    log_id: str,
    request: Request,
    start: str | None = None,
    end: str | None = None,
):
    """
    按行内时间戳切取时间窗内的日志内容（用于大文件分时段分析）

    - start/end 与行内时间戳同格式（ISO 等），缺省表示不限
    - 无时间戳的行作为上一条时间戳行的延续处理
    - 最多返回 5000 行 / 200KB，超出截断并置 truncated 标记
    """
    _require_log_owner(log_id, request.state.user)
    lf = log_repository.get_by_id(log_id)
    if lf is None:
        raise ValidationError("日志文件不存在")

    result = log_service.get_content_slice(lf, start=start, end=end)
    return {
        "code": 0,
        "message": "success",
        "data": result,
    }


@router.get("/{log_id}/clusters", response_model=dict)
async def get_log_clusters(log_id: str, request: Request):
    """
    获取日志错误聚类

    返回：[{pattern, count, samples[], level}]
    """
    _require_log_owner(log_id, request.state.user)
    lf = log_repository.get_by_id(log_id)
    if lf is None:
        raise ValidationError("日志文件不存在")

    content = log_service.get_log_content(lf)
    clusters = cluster_service.cluster_errors(content)

    return {
        "code": 0,
        "message": "success",
        "data": {"clusters": clusters, "total": len(clusters)},
    }


@router.get("/{log_id}/similar", response_model=dict)
async def find_similar_logs(log_id: str, request: Request, limit: int = 5):
    """
    查找相似的历史日志

    返回 limit 个相似日志，包含相似度分数、摘要和解决方案
    """
    _require_log_owner(log_id, request.state.user)
    lf = log_repository.get_by_id(log_id)
    if lf is None:
        raise ValidationError("日志文件不存在")

    content = log_service.get_log_content(lf)
    similar_logs = await vector_store.search_similar(
        text=content,
        limit=limit,
        exclude_id=log_id,
    )

    # 增强响应数据：添加 session_id, summary, solution, timestamp
    enhanced_logs = []
    for log in similar_logs:
        # 获取原始日志文件信息
        similar_file = log_repository.get_by_id(log["log_id"])
        if similar_file:
            # 越权校验：仅返回当前用户有权访问的日志（管理员可见全部）
            try:
                _require_log_owner(log["log_id"], request.state.user)
            except ValidationError:
                continue
            # 获取解决方案（如果有的话）
            solution = None
            conn = get_connection()
            sol_row = conn.execute(
                "SELECT solution FROM solutions WHERE source_log_id = ? LIMIT 1",
                (log["log_id"],),
            ).fetchone()
            if sol_row:
                solution = sol_row["solution"]

            enhanced_logs.append({
                "log_id": log["log_id"],
                "similarity": log["similarity"],
                "session_id": similar_file.session_id,
                "summary": similar_file.summary or "",
                "solution": solution,
                "timestamp": similar_file.created_at,
            })

    return {
        "code": 0,
        "message": "success",
        "data": {"similar_logs": enhanced_logs},
    }


@router.delete("/{log_id}", response_model=dict)
async def delete_log(log_id: str, request: Request):
    """删除日志文件（同时删除磁盘文件）"""
    _require_log_owner(log_id, request.state.user)
    # 删除向量嵌入
    await vector_store.delete_log(log_id)
    # 删除日志文件
    log_service.delete_log(log_id)
    return {"code": 0, "message": "删除成功", "data": None}
