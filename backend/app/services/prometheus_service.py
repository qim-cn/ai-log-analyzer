"""
Prometheus Service - 指标收集和导出

暴露自定义指标端点，用于监控：
- 错误率
- 响应时间
- 日志处理量
- AI 调用统计
"""

import logging
import time
from typing import Optional

from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    Info,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

logger = logging.getLogger(__name__)


class PrometheusService:
    """Prometheus 指标服务"""

    def __init__(self):
        # ============================================================
        # 应用信息
        # ============================================================
        self.app_info = Info(
            'ai_log_analyzer',
            'AI Log Analyzer 应用信息'
        )
        self.app_info.info({
            'version': '1.0.0',
            'component': 'backend',
        })

        # ============================================================
        # 请求指标
        # ============================================================
        self.http_requests_total = Counter(
            'http_requests_total',
            'HTTP 请求总数',
            ['method', 'endpoint', 'status']
        )

        self.http_request_duration_seconds = Histogram(
            'http_request_duration_seconds',
            'HTTP 请求耗时（秒）',
            ['method', 'endpoint'],
            buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0]
        )

        # ============================================================
        # 日志处理指标
        # ============================================================
        self.logs_uploaded_total = Counter(
            'logs_uploaded_total',
            '上传的日志文件总数',
            ['file_type']
        )

        self.log_lines_processed_total = Counter(
            'log_lines_processed_total',
            '处理的日志行总数'
        )

        self.log_errors_detected_total = Counter(
            'log_errors_detected_total',
            '检测到的错误总数',
            ['error_type']
        )

        self.log_processing_duration_seconds = Histogram(
            'log_processing_duration_seconds',
            '日志处理耗时（秒）',
            buckets=[0.1, 0.5, 1.0, 5.0, 10.0, 30.0]
        )

        # ============================================================
        # AI 调用指标
        # ============================================================
        self.ai_requests_total = Counter(
            'ai_requests_total',
            'AI 请求总数',
            ['model', 'status']
        )

        self.ai_request_duration_seconds = Histogram(
            'ai_request_duration_seconds',
            'AI 请求耗时（秒）',
            ['model'],
            buckets=[0.5, 1.0, 5.0, 10.0, 30.0, 60.0]
        )

        self.ai_tokens_used_total = Counter(
            'ai_tokens_used_total',
            'AI Token 使用总数',
            ['model', 'type']  # type: prompt/completion
        )

        # ============================================================
        # 向量数据库指标
        # ============================================================
        self.vector_store_operations_total = Counter(
            'vector_store_operations_total',
            '向量存储操作总数',
            ['operation']  # add/search/delete
        )

        self.vector_store_size = Gauge(
            'vector_store_size',
            '向量存储大小'
        )

        # ============================================================
        # 知识图谱指标
        # ============================================================
        self.knowledge_entities_total = Gauge(
            'knowledge_entities_total',
            '知识实体总数',
            ['type']  # error/component/solution
        )

        self.knowledge_relations_total = Gauge(
            'knowledge_relations_total',
            '知识关系总数'
        )

        # ============================================================
        # 异常检测指标
        # ============================================================
        self.anomalies_detected_total = Counter(
            'anomalies_detected_total',
            '检测到的异常总数',
            ['severity']  # high/medium/low
        )

        # ============================================================
        # 会话指标
        # ============================================================
        self.active_sessions = Gauge(
            'active_sessions',
            '活跃会话数'
        )

        self.messages_total = Counter(
            'messages_total',
            '消息总数',
            ['role']  # user/assistant/system
        )

    def record_http_request(self, method: str, endpoint: str, status: int, duration: float):
        """记录 HTTP 请求"""
        self.http_requests_total.labels(
            method=method,
            endpoint=endpoint,
            status=str(status)
        ).inc()
        self.http_request_duration_seconds.labels(
            method=method,
            endpoint=endpoint
        ).observe(duration)

    def record_log_upload(self, file_type: str, line_count: int, duration: float):
        """记录日志上传"""
        self.logs_uploaded_total.labels(file_type=file_type).inc()
        self.log_lines_processed_total.inc(line_count)
        self.log_processing_duration_seconds.observe(duration)

    def record_log_error(self, error_type: str):
        """记录日志错误"""
        self.log_errors_detected_total.labels(error_type=error_type).inc()

    def record_ai_request(self, model: str, duration: float, tokens_prompt: int = 0, tokens_completion: int = 0):
        """记录 AI 请求"""
        self.ai_requests_total.labels(model=model, status='success').inc()
        self.ai_request_duration_seconds.labels(model=model).observe(duration)

        if tokens_prompt > 0:
            self.ai_tokens_used_total.labels(model=model, type='prompt').inc(tokens_prompt)
        if tokens_completion > 0:
            self.ai_tokens_used_total.labels(model=model, type='completion').inc(tokens_completion)

    def record_ai_error(self, model: str):
        """记录 AI 错误"""
        self.ai_requests_total.labels(model=model, status='error').inc()

    def record_vector_operation(self, operation: str):
        """记录向量存储操作"""
        self.vector_store_operations_total.labels(operation=operation).inc()

    def update_vector_store_size(self, size: int):
        """更新向量存储大小"""
        self.vector_store_size.set(size)

    def update_knowledge_stats(self, error_count: int, component_count: int, solution_count: int, relation_count: int):
        """更新知识图谱统计"""
        self.knowledge_entities_total.labels(type='error').set(error_count)
        self.knowledge_entities_total.labels(type='component').set(component_count)
        self.knowledge_entities_total.labels(type='solution').set(solution_count)
        self.knowledge_relations_total.set(relation_count)

    def record_anomaly(self, severity: str):
        """记录异常检测"""
        self.anomalies_detected_total.labels(severity=severity).inc()

    def update_active_sessions(self, count: int):
        """更新活跃会话数"""
        self.active_sessions.set(count)

    def record_message(self, role: str):
        """记录消息"""
        self.messages_total.labels(role=role).inc()

    def get_metrics(self) -> bytes:
        """生成 Prometheus 指标文本"""
        return generate_latest()

    def get_content_type(self) -> str:
        """获取指标内容类型"""
        return CONTENT_TYPE_LATEST


# 全局单例
prometheus_service = PrometheusService()
