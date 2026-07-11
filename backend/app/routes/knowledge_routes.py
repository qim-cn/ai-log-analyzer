"""
Knowledge 路由定义

知识图谱相关 API：
- 获取知识图谱可视化 HTML
- 获取实体列表
- 获取图谱统计信息
- 手动触发向量化（历史数据迁移）
- 异常检测
- 趋势预测
"""

import logging
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.services.knowledge_graph import knowledge_graph
from app.services.vector_store import vector_store
from app.services.log_service import log_service
from app.services.anomaly_detector import anomaly_detector
from app.services.trend_predictor import trend_predictor
from app.repositories.log_repository import log_repository
from app.config.database import get_connection

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/graph", response_class=HTMLResponse)
async def get_knowledge_graph(format: str = "html"):
    """
    获取知识图谱可视化

    Args:
        format: 返回格式，默认 "html"

    返回 pyvis 生成的交互式 HTML
    """
    html = knowledge_graph.to_pyvis_html()
    return HTMLResponse(content=html)


@router.get("/entities", response_model=dict)
async def get_entities(type: str = "all", limit: int = 50):
    """
    获取知识实体

    Args:
        type: 实体类型过滤 (error/component/solution/all)
        limit: 返回数量限制

    返回实体列表，包含关联组件和解决方案
    """
    conn = get_connection()

    entities = []

    if type in ("error", "all"):
        # 获取错误模式
        error_patterns = conn.execute(
            """SELECT id, pattern, description, severity, count, first_seen, last_seen
            FROM error_patterns
            ORDER BY count DESC
            LIMIT ?""",
            (limit if type == "error" else limit // 3,),
        ).fetchall()

        for pattern in error_patterns:
            # 获取关联组件
            related_components = conn.execute(
                """SELECT DISTINCT source_component FROM component_relations
                WHERE relation_type = 'causes' AND (
                    source_component LIKE ? OR target_component LIKE ?
                )
                UNION
                SELECT DISTINCT target_component FROM component_relations
                WHERE relation_type = 'causes' AND (
                    source_component LIKE ? OR target_component LIKE ?
                )""",
                (f"%{pattern['pattern']}%",) * 4,
            ).fetchall()

            # 获取解决方案
            solutions = conn.execute(
                "SELECT solution FROM solutions WHERE error_pattern = ?",
                (pattern["pattern"],),
            ).fetchall()

            entities.append({
                "id": pattern["id"],
                "type": "error",
                "name": pattern["pattern"],
                "count": pattern["count"],
                "first_seen": pattern["first_seen"],
                "last_seen": pattern["last_seen"],
                "related_components": [r["source_component"] for r in related_components],
                "solutions": [s["solution"] for s in solutions],
            })

    if type in ("component", "all"):
        # 获取组件
        components = conn.execute(
            """SELECT DISTINCT source_component as name, COUNT(*) as count
            FROM component_relations
            GROUP BY source_component
            ORDER BY count DESC
            LIMIT ?""",
            (limit if type == "component" else limit // 3,),
        ).fetchall()

        for comp in components:
            entities.append({
                "id": f"comp_{comp['name']}",
                "type": "component",
                "name": comp["name"],
                "count": comp["count"],
                "first_seen": None,
                "last_seen": None,
                "related_components": [],
                "solutions": [],
            })

    if type in ("solution", "all"):
        # 获取解决方案
        solutions = conn.execute(
            """SELECT id, error_pattern, solution, success_count, fail_count, created_at
            FROM solutions
            ORDER BY success_count DESC
            LIMIT ?""",
            (limit if type == "solution" else limit // 3,),
        ).fetchall()

        for sol in solutions:
            entities.append({
                "id": sol["id"],
                "type": "solution",
                "name": sol["solution"][:50] + "..." if len(sol["solution"]) > 50 else sol["solution"],
                "count": sol["success_count"],
                "first_seen": sol["created_at"],
                "last_seen": None,
                "related_components": [],
                "solutions": [sol["solution"]],
                "error_pattern": sol["error_pattern"],
                "success_rate": (
                    sol["success_count"] / (sol["success_count"] + sol["fail_count"])
                    if (sol["success_count"] + sol["fail_count"]) > 0
                    else 0
                ),
            })

    return {
        "code": 0,
        "message": "success",
        "data": {"entities": entities},
    }


@router.get("/stats", response_model=dict)
async def get_knowledge_stats():
    """
    获取知识图谱统计信息

    返回：错误模式数量、关系数量、解决方案数量
    """
    stats = knowledge_graph.get_stats()
    return {
        "code": 0,
        "message": "success",
        "data": stats,
    }


@router.post("/reindex", response_model=dict)
async def reindex_knowledge():
    """
    手动触发向量化（历史数据迁移）

    遍历所有日志文件，生成嵌入向量和提取知识图谱实体。
    跳过已索引的日志。

    返回：已索引数量和跳过数量
    """
    indexed = 0
    skipped = 0

    # 获取所有日志文件
    all_logs = log_repository.get_all()

    for log_file in all_logs:
        try:
            # 检查是否已索引（通过检查 ChromaDB 中是否存在）
            existing = vector_store.collection.get(ids=[log_file.id])

            if existing and existing["ids"]:
                skipped += 1
                continue

            # 获取日志内容
            content = log_service.get_log_content(log_file)

            # 生成嵌入向量
            await vector_store.add_log(
                log_id=log_file.id,
                text=content,
                metadata={
                    "session_id": log_file.session_id,
                    "filename": log_file.filename,
                    "file_type": log_file.file_type.value,
                },
            )

            # 提取知识图谱实体
            entities = await knowledge_graph.extract_entities(content)
            knowledge_graph.build_relations(entities)
            knowledge_graph.save_to_database(log_file.id, entities)

            indexed += 1
            logger.info(f"Indexed log {log_file.id}: {log_file.filename}")

        except Exception as e:
            logger.warning(f"Failed to index log {log_file.id}: {e}")
            skipped += 1

    return {
        "code": 0,
        "message": "Reindex completed",
        "data": {
            "indexed": indexed,
            "skipped": skipped,
        },
    }


@router.get("/anomalies", response_model=dict)
async def get_anomalies(session_id: str = None):
    """
    获取异常检测结果

    Args:
        session_id: 会话 ID（可选，不传则返回全局统计）

    返回异常检测结果和预警
    """
    if session_id:
        result = anomaly_detector.analyze_log_metrics(session_id)
    else:
        result = anomaly_detector.get_anomaly_summary()

    return {
        "code": 0,
        "message": "success",
        "data": result,
    }


@router.get("/trends", response_model=dict)
async def get_trends(session_id: str = None, days: int = 7):
    """
    获取趋势预测

    Args:
        session_id: 会话 ID（可选）
        days: 预测天数

    返回趋势预测和容量分析
    """
    if session_id:
        # 获取会话的错误趋势
        conn = get_connection()
        logs = conn.execute(
            """SELECT created_at, summary
            FROM log_files
            WHERE session_id = ?
            ORDER BY created_at ASC""",
            (session_id,),
        ).fetchall()

        # 提取错误计数
        import re
        timestamps = []
        error_counts = []
        for log in logs:
            summary = log["summary"] or ""
            error_match = re.search(r'错误:\s*(\d+)', summary)
            if error_match:
                timestamps.append(log["created_at"])
                error_counts.append(int(error_match.group(1)))

        # 预测趋势
        trend_result = trend_predictor.predict_error_trend(
            timestamps, error_counts, days_ahead=days
        )

        # 容量分析
        capacity_result = trend_predictor.analyze_capacity(session_id)

        # 瓶颈检测
        bottleneck_result = trend_predictor.detect_bottlenecks(session_id)

        result = {
            "trend": trend_result,
            "capacity": capacity_result,
            "bottlenecks": bottleneck_result,
        }
    else:
        result = trend_predictor.get_trend_summary()

    return {
        "code": 0,
        "message": "success",
        "data": result,
    }
