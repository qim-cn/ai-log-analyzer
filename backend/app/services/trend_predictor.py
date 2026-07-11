"""
Trend Predictor - 日志趋势预测

基于历史数据进行趋势分析和预测：
- 错误趋势预测
- 容量规划建议
- 性能瓶颈预警
"""

import logging
from datetime import datetime, timedelta
from typing import List, Optional

import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures

from app.config.database import get_connection

logger = logging.getLogger(__name__)


class TrendPredictor:
    """趋势预测器"""

    def predict_error_trend(
        self,
        timestamps: List[str],
        error_counts: List[int],
        days_ahead: int = 7,
    ) -> dict:
        """
        预测错误趋势

        Args:
            timestamps: 时间戳列表
            error_counts: 错误计数列表
            days_ahead: 预测天数

        Returns:
            趋势预测结果
        """
        if len(timestamps) < 3:
            return {
                "trend": "insufficient_data",
                "predictions": [],
                "confidence": 0,
            }

        # 转换时间戳为数值
        base_time = datetime.fromisoformat(timestamps[0])
        X = []
        for ts in timestamps:
            dt = datetime.fromisoformat(ts)
            hours = (dt - base_time).total_seconds() / 3600
            X.append([hours])

        y = np.array(error_counts)
        X = np.array(X)

        # 使用多项式回归（二次）
        poly = PolynomialFeatures(degree=2)
        X_poly = poly.fit_transform(X)

        model = LinearRegression()
        model.fit(X_poly, y)

        # 计算 R² 分数
        r2_score = model.score(X_poly, y)

        # 预测未来
        last_hour = X[-1][0]
        predictions = []
        for day in range(1, days_ahead + 1):
            future_hour = last_hour + day * 24
            future_X = poly.transform([[future_hour]])
            predicted = max(0, int(model.predict(future_X)[0]))
            predictions.append({
                "day": day,
                "predicted_errors": predicted,
                "timestamp": (base_time + timedelta(days=day)).isoformat(),
            })

        # 判断趋势
        if len(error_counts) >= 2:
            recent_avg = np.mean(error_counts[-3:])
            earlier_avg = np.mean(error_counts[:3])
            if recent_avg > earlier_avg * 1.2:
                trend = "increasing"
            elif recent_avg < earlier_avg * 0.8:
                trend = "decreasing"
            else:
                trend = "stable"
        else:
            trend = "unknown"

        return {
            "trend": trend,
            "predictions": predictions,
            "confidence": round(r2_score, 4),
            "current_rate": error_counts[-1] if error_counts else 0,
            "average_rate": round(np.mean(error_counts), 2) if error_counts else 0,
        }

    def analyze_capacity(self, session_id: str) -> dict:
        """
        容量规划分析

        基于日志增长趋势预测存储需求

        Returns:
            容量分析结果和建议
        """
        conn = get_connection()

        # 获取日志文件大小趋势
        logs = conn.execute(
            """SELECT file_size, created_at
            FROM log_files
            WHERE session_id = ?
            ORDER BY created_at ASC""",
            (session_id,),
        ).fetchall()

        if len(logs) < 2:
            return {
                "status": "insufficient_data",
                "recommendations": [],
            }

        # 计算增长趋势
        sizes = [log["file_size"] for log in logs]
        timestamps = [log["created_at"] for log in logs]

        # 转换为 MB
        sizes_mb = [s / (1024 * 1024) for s in sizes]

        # 计算日均增长
        if len(timestamps) >= 2:
            first_dt = datetime.fromisoformat(timestamps[0])
            last_dt = datetime.fromisoformat(timestamps[-1])
            days = max(1, (last_dt - first_dt).days)
            daily_growth_mb = sum(sizes_mb) / days
        else:
            daily_growth_mb = sum(sizes_mb)

        # 预测未来存储需求
        predictions = []
        current_storage = sum(sizes_mb)
        for days in [7, 30, 90]:
            predicted = current_storage + daily_growth_mb * days
            predictions.append({
                "days": days,
                "predicted_mb": round(predicted, 2),
                "predicted_gb": round(predicted / 1024, 2),
            })

        # 生成建议
        recommendations = []
        if daily_growth_mb > 100:
            recommendations.append({
                "type": "storage",
                "severity": "high",
                "message": f"日志增长过快（{daily_growth_mb:.1f} MB/天），建议启用日志轮转或压缩",
            })

        if current_storage > 1024:  # 超过 1GB
            recommendations.append({
                "type": "cleanup",
                "severity": "medium",
                "message": "当前日志占用超过 1GB，建议清理历史日志",
            })

        return {
            "status": "ok",
            "current_storage_mb": round(current_storage, 2),
            "daily_growth_mb": round(daily_growth_mb, 2),
            "predictions": predictions,
            "recommendations": recommendations,
        }

    def detect_bottlenecks(self, session_id: str) -> dict:
        """
        性能瓶颈预警

        分析日志中的性能指标，识别潜在瓶颈

        Returns:
            瓶颈检测结果
        """
        conn = get_connection()

        # 获取日志内容
        logs = conn.execute(
            """SELECT id, filename, summary
            FROM log_files
            WHERE session_id = ?
            ORDER BY created_at DESC
            LIMIT 10""",
            (session_id,),
        ).fetchall()

        bottlenecks = []
        warnings = []

        for log in logs:
            summary = log["summary"] or ""

            # 检测常见瓶颈模式
            import re

            # 检测超时
            timeout_matches = re.findall(r'(?i)timeout|timed?\s*out', summary)
            if timeout_matches:
                bottlenecks.append({
                    "type": "timeout",
                    "file": log["filename"],
                    "count": len(timeout_matches),
                    "severity": "high",
                    "suggestion": "检查网络连接或增加超时时间",
                })

            # 检测内存问题
            memory_matches = re.findall(r'(?i)out\s*of\s*memory|heap\s*size|memory\s*leak', summary)
            if memory_matches:
                bottlenecks.append({
                    "type": "memory",
                    "file": log["filename"],
                    "count": len(memory_matches),
                    "severity": "critical",
                    "suggestion": "增加内存或优化内存使用",
                })

            # 检测 CPU 问题
            cpu_matches = re.findall(r'(?i)cpu\s*(?:usage|load)|high\s*cpu', summary)
            if cpu_matches:
                bottlenecks.append({
                    "type": "cpu",
                    "file": log["filename"],
                    "count": len(cpu_matches),
                    "severity": "medium",
                    "suggestion": "优化代码或增加 CPU 资源",
                })

            # 检测磁盘问题
            disk_matches = re.findall(r'(?i)disk\s*(?:full|space)|no\s*space', summary)
            if disk_matches:
                bottlenecks.append({
                    "type": "disk",
                    "file": log["filename"],
                    "count": len(disk_matches),
                    "severity": "high",
                    "suggestion": "清理磁盘或扩展存储",
                })

            # 检测连接池问题
            pool_matches = re.findall(r'(?i)connection\s*pool|pool\s*exhausted', summary)
            if pool_matches:
                bottlenecks.append({
                    "type": "connection_pool",
                    "file": log["filename"],
                    "count": len(pool_matches),
                    "severity": "medium",
                    "suggestion": "增加连接池大小或优化连接管理",
                })

        # 去重并汇总
        bottleneck_summary = {}
        for b in bottlenecks:
            key = b["type"]
            if key not in bottleneck_summary:
                bottleneck_summary[key] = {
                    "type": b["type"],
                    "total_count": 0,
                    "severity": b["severity"],
                    "suggestion": b["suggestion"],
                    "files": [],
                }
            bottleneck_summary[key]["total_count"] += b["count"]
            if b["file"] not in bottleneck_summary[key]["files"]:
                bottleneck_summary[key]["files"].append(b["file"])

        # 生成预警
        if bottleneck_summary:
            for key, summary in bottleneck_summary.items():
                if summary["severity"] == "critical":
                    warnings.append({
                        "level": "critical",
                        "message": f"检测到 {summary['type']} 问题，共 {summary['total_count']} 次",
                        "suggestion": summary["suggestion"],
                    })
                elif summary["total_count"] > 5:
                    warnings.append({
                        "level": "warning",
                        "message": f"{summary['type']} 问题频繁出现（{summary['total_count']} 次）",
                        "suggestion": summary["suggestion"],
                    })

        return {
            "bottlenecks": list(bottleneck_summary.values()),
            "warnings": warnings,
            "total_issues": len(bottlenecks),
        }

    def get_trend_summary(self) -> dict:
        """获取全局趋势统计"""
        conn = get_connection()

        # 获取最近 30 天的错误趋势
        month_ago = (datetime.utcnow() - timedelta(days=30)).isoformat()

        daily_errors = conn.execute(
            """SELECT date(created_at) as day, COUNT(*) as count
            FROM error_patterns
            WHERE last_seen >= ?
            GROUP BY date(created_at)
            ORDER BY day ASC""",
            (month_ago,),
        ).fetchall()

        return {
            "daily_trend": [
                {"date": row["day"], "count": row["count"]}
                for row in daily_errors
            ],
            "total_days": len(daily_errors),
        }


# 全局单例
trend_predictor = TrendPredictor()
