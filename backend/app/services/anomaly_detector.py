"""
Anomaly Detector - 日志异常检测

支持多种异常检测算法：
- 统计学方法：Z-score、IQR
- 机器学习：Isolation Forest、LOF (Local Outlier Factor)

实时学习正常模式，检测偏差。
"""

import logging
from datetime import datetime, timedelta
from typing import List

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler

from app.config.database import get_connection

logger = logging.getLogger(__name__)


class AnomalyDetector:
    """异常检测器"""

    def __init__(self):
        # 不持有实例级可变状态：StandardScaler / 模型均为每次调用局部对象，
        # 避免单例在并发请求下被互相污染（fit_transform 会改写内部状态）。
        pass

    def detect_with_zscore(
        self, values: List[float], threshold: float = 3.0
    ) -> List[dict]:
        """
        Z-score 异常检测

        Args:
            values: 数值序列
            threshold: Z-score 阈值（默认 3.0）

        Returns:
            异常点列表 [{index, value, zscore, is_anomaly}]
        """
        if len(values) < 3:
            return []

        arr = np.array(values)
        mean = np.mean(arr)
        std = np.std(arr)

        if std == 0:
            return [{"index": i, "value": v, "zscore": 0, "is_anomaly": False}
                    for i, v in enumerate(values)]

        zscores = (arr - mean) / std

        results = []
        for i, (value, zscore) in enumerate(zip(values, zscores)):
            results.append({
                "index": i,
                "value": value,
                "zscore": round(float(zscore), 4),
                "is_anomaly": abs(zscore) > threshold,
            })

        return results

    def detect_with_iqr(
        self, values: List[float], multiplier: float = 1.5
    ) -> List[dict]:
        """
        IQR (四分位距) 异常检测

        Args:
            values: 数值序列
            multiplier: IQR 倍数（默认 1.5）

        Returns:
            异常点列表 [{index, value, is_anomaly, lower_bound, upper_bound}]
        """
        if len(values) < 4:
            return []

        arr = np.array(values)
        q1 = np.percentile(arr, 25)
        q3 = np.percentile(arr, 75)
        iqr = q3 - q1

        lower_bound = q1 - multiplier * iqr
        upper_bound = q3 + multiplier * iqr

        results = []
        for i, value in enumerate(values):
            results.append({
                "index": i,
                "value": value,
                "is_anomaly": value < lower_bound or value > upper_bound,
                "lower_bound": round(float(lower_bound), 4),
                "upper_bound": round(float(upper_bound), 4),
            })

        return results

    def detect_with_isolation_forest(
        self,
        features: List[List[float]],
        contamination: float = 0.1,
    ) -> List[dict]:
        """
        Isolation Forest 异常检测

        Args:
            features: 特征矩阵 [[f1, f2, ...], ...]
            contamination: 异常比例（默认 0.1）

        Returns:
            异常点列表 [{index, score, is_anomaly}]
        """
        if len(features) < 10:
            return []

        X = np.array(features)

        # 标准化（局部对象，避免并发污染单例状态）
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # 训练模型
        model = IsolationForest(
            contamination=contamination,
            random_state=42,
            n_estimators=100,
        )
        predictions = model.fit_predict(X_scaled)
        scores = model.decision_function(X_scaled)

        results = []
        for i, (pred, score) in enumerate(zip(predictions, scores)):
            results.append({
                "index": i,
                "score": round(float(score), 4),
                "is_anomaly": pred == -1,
            })

        return results

    def detect_with_lof(
        self,
        features: List[List[float]],
        n_neighbors: int = 20,
        contamination: float = 0.1,
    ) -> List[dict]:
        """
        LOF (Local Outlier Factor) 异常检测

        Args:
            features: 特征矩阵
            n_neighbors: 邻居数量
            contamination: 异常比例

        Returns:
            异常点列表 [{index, lof_score, is_anomaly}]
        """
        if len(features) < n_neighbors + 1:
            return []

        X = np.array(features)

        # 标准化（局部对象，避免并发污染单例状态）
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # LOF 检测
        model = LocalOutlierFactor(
            n_neighbors=n_neighbors,
            contamination=contamination,
        )
        predictions = model.fit_predict(X_scaled)
        scores = model.negative_outlier_factor_

        results = []
        for i, (pred, score) in enumerate(zip(predictions, scores)):
            results.append({
                "index": i,
                "lof_score": round(float(score), 4),
                "is_anomaly": pred == -1,
            })

        return results

    def analyze_log_metrics(self, session_id: str) -> dict:
        """
        分析会话日志的异常指标

        提取关键指标并检测异常：
        - 错误率
        - 响应时间
        - 内存使用
        - CPU 使用

        Returns:
            异常检测结果
        """
        conn = get_connection()

        # 获取会话下的日志统计
        logs = conn.execute(
            """SELECT id, filename, created_at, summary
            FROM log_files WHERE session_id = ?
            ORDER BY created_at ASC""",
            (session_id,),
        ).fetchall()

        if not logs:
            return {"anomalies": [], "metrics": {}}

        # 提取错误计数作为指标
        error_counts = []
        timestamps = []

        for log in logs:
            summary = log["summary"] or ""
            # 从摘要中提取错误数
            import re
            error_match = re.search(r'错误:\s*(\d+)', summary)
            if error_match:
                error_counts.append(int(error_match.group(1)))
                timestamps.append(log["created_at"])

        if len(error_counts) < 3:
            return {
                "anomalies": [],
                "metrics": {"error_counts": error_counts, "timestamps": timestamps},
            }

        # 使用多种算法检测异常
        zscore_results = self.detect_with_zscore(error_counts, threshold=2.0)
        iqr_results = self.detect_with_iqr(error_counts)

        # 合并异常结果
        anomalies = []
        for i, (z, iqr) in enumerate(zip(zscore_results, iqr_results)):
            if z["is_anomaly"] or iqr["is_anomaly"]:
                anomalies.append({
                    "index": i,
                    "timestamp": timestamps[i] if i < len(timestamps) else None,
                    "error_count": error_counts[i],
                    "zscore": z["zscore"],
                    "is_outlier_iqr": iqr["is_anomaly"],
                    "severity": "high" if abs(z["zscore"]) > 3 else "medium",
                })

        return {
            "anomalies": anomalies,
            "metrics": {
                "error_counts": error_counts,
                "timestamps": timestamps,
                "mean": float(np.mean(error_counts)),
                "std": float(np.std(error_counts)),
                "q1": float(np.percentile(error_counts, 25)),
                "q3": float(np.percentile(error_counts, 75)),
            },
        }

    def get_anomaly_summary(self) -> dict:
        """获取全局异常统计"""
        conn = get_connection()

        # 获取最近 7 天的错误模式变化
        week_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()

        patterns = conn.execute(
            """SELECT pattern, count, first_seen, last_seen
            FROM error_patterns
            WHERE last_seen >= ?
            ORDER BY count DESC
            LIMIT 10""",
            (week_ago,),
        ).fetchall()

        return {
            "top_patterns": [
                {
                    "pattern": p["pattern"],
                    "count": p["count"],
                    "first_seen": p["first_seen"],
                    "last_seen": p["last_seen"],
                }
                for p in patterns
            ],
            "total_patterns": len(patterns),
        }


# 全局单例
anomaly_detector = AnomalyDetector()
