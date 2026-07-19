"""
异常聚合服务 - 多台相同失败检测

按 机型 + 错误模式 + 时间窗口 聚合 anomaly_events，检测近期同机型同错误多次出现。
触发时给出候选根因（testcode / 人为装配 / 物料批次，按领域铁律多方向，按证据强弱排查，
不预设比例）。
"""

import logging
import uuid

from app.config.database import get_connection

logger = logging.getLogger(__name__)

# 默认阈值：近 N 天同机型同错误模式出现 >= THRESHOLD 次算"多台相同失败"
DEFAULT_DAYS = 7
DEFAULT_THRESHOLD = 3

# 候选根因（领域铁律：多台相同失败脱离"单机"范畴，候选含 testcode/装配/物料）
CANDIDATE_CAUSES = [
    {
        "cause": "testcode 脚本问题",
        "action": "testcode 全批次共用，多台完全相同失败才怀疑脚本。升级 WWWTE 排查 testcode",
    },
    {
        "cause": "人为装配问题",
        "action": "查近期同工位/批次的装配手法、操作员是否变更",
    },
    {
        "cause": "物料批次问题",
        "action": "查该机型近期物料批号是否变更、某批次物料是否集中故障",
    },
]


class AnomalyService:
    """异常聚合与多台相同失败检测"""

    def record_event(self, session_id: str | None, pattern: str) -> None:
        """记录一次异常事件（机型 + 错误模式 + 会话），机型从 session_id 解析"""
        if not pattern or len(pattern.strip()) < 3:
            return
        model = None
        if session_id:
            try:
                from app.services.session_service import session_service
                sess = session_service.get_session(session_id)
                model = sess.model if sess else None
            except Exception:
                pass
        conn = get_connection()
        conn.execute(
            "INSERT INTO anomaly_events (id, model, pattern, session_id) VALUES (?, ?, ?, ?)",
            (uuid.uuid4().hex, model, pattern.strip(), session_id),
        )
        conn.commit()

    def check(
        self, session_id: str, days: int = DEFAULT_DAYS, threshold: int = DEFAULT_THRESHOLD
    ) -> dict | None:
        """
        检测当前会话机型的近期多台相同失败。

        返回 None 表示无告警；否则返回 {model, alerts, candidates, days, threshold}。
        alerts: 近 N 天同机型出现 >= threshold 次的错误模式列表。
        """
        from app.services.session_service import session_service

        try:
            session = session_service.get_session(session_id)
        except Exception:
            return None
        if not session or not session.model:
            return None

        model = session.model
        conn = get_connection()
        rows = conn.execute(
            """
            SELECT pattern, COUNT(*) AS cnt, COUNT(DISTINCT session_id) AS sess_cnt
            FROM anomaly_events
            WHERE model = ? AND seen_at >= datetime('now', ?)
            GROUP BY pattern
            HAVING cnt >= ?
            ORDER BY cnt DESC
            """,
            (model, f"-{days} days", threshold),
        ).fetchall()

        if not rows:
            return None

        alerts = [
            {"pattern": r["pattern"], "count": r["cnt"], "sessions": r["sess_cnt"]}
            for r in rows
        ]
        logger.info(
            f"异常检测告警: 机型 {model} 近 {days} 天 {len(alerts)} 个错误模式超阈值"
        )
        return {
            "model": model,
            "alerts": alerts,
            "candidates": CANDIDATE_CAUSES,
            "days": days,
            "threshold": threshold,
        }


anomaly_service = AnomalyService()
