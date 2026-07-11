"""
日志聚类服务

自动对错误行聚类，相似消息归为一组。
"""

import re
from collections import Counter
from dataclasses import dataclass, field


@dataclass
class LogCluster:
    """日志聚类结果"""

    pattern: str
    count: int
    samples: list[str] = field(default_factory=list)
    level: str = "error"


class ClusterService:
    """日志聚类服务"""

    def cluster_errors(self, content: str, max_clusters: int = 20) -> list[dict]:
        """
        对错误行聚类

        Args:
            content: 日志内容
            max_clusters: 最大聚类数

        Returns:
            [{pattern, count, samples[], level}]
        """
        lines = content.split("\n")

        # 提取错误行
        error_lines = []
        error_pattern = re.compile(
            r"\b(ERROR|FATAL|CRITICAL|EXCEPTION|PANIC|FAIL|WARN|WARNING)\b", re.IGNORECASE
        )

        for line in lines:
            if error_pattern.search(line):
                error_lines.append(line.strip())

        if not error_lines:
            return []

        # 归一化：去掉变量部分（数字、时间戳、ID等）
        normalized = []
        for line in error_lines:
            norm = self._normalize_line(line)
            normalized.append((norm, line))

        # 聚类
        clusters: dict[str, list[str]] = {}
        for norm, original in normalized:
            if norm not in clusters:
                clusters[norm] = []
            clusters[norm].append(original)

        # 排序并限制
        sorted_clusters = sorted(clusters.items(), key=lambda x: -len(x[1]))[:max_clusters]

        # 构建结果
        result = []
        for pattern, samples in sorted_clusters:
            # 检测级别
            level = "error"
            if re.search(r"\b(WARN|WARNING)\b", samples[0], re.IGNORECASE):
                level = "warning"

            result.append({
                "pattern": pattern,
                "count": len(samples),
                "samples": samples[:3],  # 只保留前 3 条样本
                "level": level,
            })

        return result

    def _normalize_line(self, line: str) -> str:
        """归一化日志行：去掉变量部分"""
        # 去掉时间戳
        norm = re.sub(r"\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}", "<TIME>", line)
        # 去掉方括号中的数字（PID/TID）
        norm = re.sub(r"\[\d+\]", "[<NUM>]", norm)
        # 去掉独立的数字
        norm = re.sub(r"\b\d+\b", "<NUM>", norm)
        # 去掉十六进制地址
        norm = re.sub(r"0x[0-9a-fA-F]+", "<HEX>", norm)
        # 去掉 UUID
        norm = re.sub(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            "<UUID>",
            norm,
        )
        # 去掉多余空格
        norm = re.sub(r"\s+", " ", norm).strip()
        return norm[:300]


# 全局实例
cluster_service = ClusterService()
