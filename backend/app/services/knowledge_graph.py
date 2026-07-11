"""
Knowledge Graph - 知识图谱构建和可视化

从日志分析结果中提取实体和关系，构建知识图谱，
使用 networkx 构建图，使用 pyvis 生成可视化 HTML。
"""

import json
import logging
import re
from typing import List, Optional

import networkx as nx
from pyvis.network import Network

from app.config.database import get_connection
from app.services.ai_service import ai_service

logger = logging.getLogger(__name__)


class KnowledgeGraph:
    """知识图谱服务"""

    # 实体提取提示词
    ENTITY_EXTRACTION_PROMPT = """Analyze the following log analysis result and extract entities and relationships.

Return a JSON object with this exact structure:
{
    "errors": [
        {"name": "ErrorType", "description": "brief description", "severity": "critical|high|medium|low"}
    ],
    "components": [
        {"name": "ComponentName", "type": "service|module|database|network|hardware"}
    ],
    "causes": [
        {"name": "RootCause", "description": "description of root cause"}
    ],
    "solutions": [
        {"name": "Solution", "description": "description of solution"}
    ],
    "relations": [
        {"source": "ErrorType", "target": "ComponentName", "type": "occurs_in"},
        {"source": "ErrorType", "target": "RootCause", "type": "caused_by"},
        {"source": "ErrorType", "target": "Solution", "type": "solved_by"}
    ]
}

Log analysis result:
{content}

Return ONLY the JSON object, no other text."""

    # 颜色映射
    COLOR_MAP = {
        "error": "#dc2626",      # 红色
        "component": "#3b82f6",  # 蓝色
        "cause": "#f97316",      # 橙色
        "solution": "#22c55e",   # 绿色
    }

    # 形状映射
    SHAPE_MAP = {
        "error": "dot",
        "component": "diamond",
        "cause": "triangle",
        "solution": "square",
    }

    def __init__(self):
        self.graph = nx.DiGraph()

    async def extract_entities(self, log_text: str, analysis_result: str = None) -> dict:
        """
        从分析结果提取实体

        Args:
            log_text: 原始日志文本
            analysis_result: AI 分析结果（可选，如果没有则用 AI 提取）

        Returns:
            提取的实体字典
        """
        content = analysis_result or log_text

        # 先用正则提取一些基础信息
        entities = self._extract_with_regex(content)

        # 再用 AI 补充提取
        try:
            ai_entities = await self._extract_with_ai(content)
            self._merge_entities(entities, ai_entities)
        except Exception as e:
            logger.warning(f"AI entity extraction failed: {e}")

        return entities

    def _extract_with_regex(self, text: str) -> dict:
        """用正则表达式提取基础实体"""
        entities = {
            "errors": [],
            "components": [],
            "causes": [],
            "solutions": [],
        }

        # 错误模式匹配
        error_patterns = [
            r'\b(ERROR|FATAL|CRITICAL|EXCEPTION|PANIC|FAIL(?:ED|URE)?)\b',
            r'\b(Timeout|Connection\s+(?:Refused|Reset|Lost))\b',
            r'\b(OutOfMemory|StackOverflow|NullPointer|IndexOutOfBounds)\b',
            r'\b(\w+Exception|\w+Error)\b',
        ]

        for pattern in error_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                error_name = match.strip()
                if error_name and len(error_name) > 2:
                    entities["errors"].append({
                        "name": error_name,
                        "description": "",
                        "severity": "high" if "FATAL" in error_name.upper() else "medium",
                    })

        # 组件模式匹配
        component_patterns = [
            r'\b(MySQL|PostgreSQL|Redis|MongoDB|Elasticsearch)\b',
            r'\b(Nginx|Apache|Tomcat|IIS)\b',
            r'\b(Docker|Kubernetes|K8s)\b',
            r'\b(API|Gateway|Load\s*Balancer|Cache)\b',
            r'\b(Database|DB|Queue|Message\s*Queue)\b',
        ]

        for pattern in component_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                entities["components"].append({
                    "name": match.strip(),
                    "type": "service",
                })

        # 解决方案模式匹配
        solution_patterns = [
            r'(?:解决|修复|方案|建议)[：:]\s*(.+?)(?:\n|$)',
            r'(?:Solution|Fix|Resolution)[：:]\s*(.+?)(?:\n|$)',
            r'(?:增加|扩大|优化|调整|检查)\s+(.+?)(?:\n|$)',
        ]

        for pattern in solution_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                if match.strip():
                    entities["solutions"].append({
                        "name": match.strip()[:50],
                        "description": match.strip(),
                    })

        # 去重
        entities["errors"] = self._deduplicate(entities["errors"], "name")
        entities["components"] = self._deduplicate(entities["components"], "name")
        entities["solutions"] = self._deduplicate(entities["solutions"], "name")

        return entities

    async def _extract_with_ai(self, text: str) -> dict:
        """用 AI 提取实体"""
        prompt = self.ENTITY_EXTRACTION_PROMPT.format(content=text[:3000])

        response = await ai_service.chat(prompt)

        # 尝试解析 JSON
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 块
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            return json.loads(json_match.group())

        return {
            "errors": [],
            "components": [],
            "causes": [],
            "solutions": [],
            "relations": [],
        }

    def _merge_entities(self, base: dict, additional: dict) -> None:
        """合并实体"""
        for key in ["errors", "components", "causes", "solutions"]:
            if key in additional:
                base[key].extend(additional[key])
                base[key] = self._deduplicate(base[key], "name")

    def _deduplicate(self, items: List[dict], key: str) -> List[dict]:
        """去重"""
        seen = set()
        result = []
        for item in items:
            name = item.get(key, "").lower()
            if name and name not in seen:
                seen.add(name)
                result.append(item)
        return result

    def build_relations(self, entities: dict) -> None:
        """
        构建实体关系

        - 错误 -发生在-> 组件
        - 错误 -由-> 原因 -引起
        - 问题 -通过-> 方案 -解决
        """
        self.graph.clear()

        # 添加错误节点
        for error in entities.get("errors", []):
            node_id = f"error:{error['name']}"
            self.graph.add_node(
                node_id,
                label=error["name"],
                type="error",
                description=error.get("description", ""),
                severity=error.get("severity", "medium"),
            )

        # 添加组件节点
        for comp in entities.get("components", []):
            node_id = f"component:{comp['name']}"
            self.graph.add_node(
                node_id,
                label=comp["name"],
                type="component",
                component_type=comp.get("type", "service"),
            )

        # 添加原因节点
        for cause in entities.get("causes", []):
            node_id = f"cause:{cause['name']}"
            self.graph.add_node(
                node_id,
                label=cause["name"],
                type="cause",
                description=cause.get("description", ""),
            )

        # 添加解决方案节点
        for solution in entities.get("solutions", []):
            node_id = f"solution:{solution['name']}"
            self.graph.add_node(
                node_id,
                label=solution["name"],
                type="solution",
                description=solution.get("description", ""),
            )

        # 构建关系
        errors = entities.get("errors", [])
        components = entities.get("components", [])
        causes = entities.get("causes", [])
        solutions = entities.get("solutions", [])

        # 错误 -发生在-> 组件
        for error in errors:
            for comp in components:
                # 简单的关键词匹配
                if (error["name"].lower() in comp["name"].lower() or
                        comp["name"].lower() in error["name"].lower()):
                    self.graph.add_edge(
                        f"error:{error['name']}",
                        f"component:{comp['name']}",
                        label="occurs_in",
                    )

        # 错误 -由-> 原因
        for error in errors:
            for cause in causes:
                self.graph.add_edge(
                    f"error:{error['name']}",
                    f"cause:{cause['name']}",
                    label="caused_by",
                )

        # 问题 -通过-> 方案
        for error in errors:
            for solution in solutions:
                self.graph.add_edge(
                    f"error:{error['name']}",
                    f"solution:{solution['name']}",
                    label="solved_by",
                )

    def save_to_database(self, log_id: str, entities: dict) -> None:
        """保存实体到数据库"""
        conn = get_connection()

        # 保存错误模式
        for error in entities.get("errors", []):
            pattern_name = error.get("name", "")
            if not pattern_name:
                continue

            existing = conn.execute(
                "SELECT id, count FROM error_patterns WHERE pattern = ?",
                (pattern_name,),
            ).fetchone()

            if existing:
                conn.execute(
                    """UPDATE error_patterns
                    SET count = count + 1, last_seen = datetime('now')
                    WHERE id = ?""",
                    (existing["id"],),
                )
            else:
                conn.execute(
                    """INSERT INTO error_patterns (pattern, description, severity)
                    VALUES (?, ?, ?)""",
                    (pattern_name, error.get("description", ""), error.get("severity", "medium")),
                )

        # 保存组件关系
        for src, dst, data in self.graph.edges(data=True):
            rel_type = data.get("label", "related_to")
            type_map = {
                "occurs_in": "causes",
                "caused_by": "depends_on",
                "solved_by": "related_to",
            }
            db_type = type_map.get(rel_type, "related_to")

            # 提取组件名
            src_name = src.split(":", 1)[1] if ":" in src else src
            dst_name = dst.split(":", 1)[1] if ":" in dst else dst

            existing = conn.execute(
                """SELECT id, count FROM component_relations
                WHERE source_component = ? AND target_component = ? AND relation_type = ?""",
                (src_name, dst_name, db_type),
            ).fetchone()

            if existing:
                conn.execute(
                    "UPDATE component_relations SET count = count + 1 WHERE id = ?",
                    (existing["id"],),
                )
            else:
                conn.execute(
                    """INSERT INTO component_relations
                    (source_component, target_component, relation_type)
                    VALUES (?, ?, ?)""",
                    (src_name, dst_name, db_type),
                )

        # 保存解决方案
        for solution in entities.get("solutions", []):
            solution_text = solution.get("description", solution.get("name", ""))
            if not solution_text:
                continue

            errors = entities.get("errors", [])
            if errors:
                pattern_name = errors[0].get("name", "unknown")
                conn.execute(
                    """INSERT INTO solutions (error_pattern, solution, source_log_id)
                    VALUES (?, ?, ?)""",
                    (pattern_name, solution_text, log_id),
                )

        conn.commit()

    def to_pyvis_html(self) -> str:
        """
        导出为 pyvis 交互式 HTML

        Returns:
            HTML 字符串
        """
        net = Network(
            height="600px",
            width="100%",
            directed=True,
            notebook=False,
            bgcolor="#1a1a2e",
            font_color="white",
        )

        # 配置物理引擎
        net.set_options("""
        {
            "physics": {
                "forceAtlas2Based": {
                    "gravitationalConstant": -100,
                    "centralGravity": 0.01,
                    "springLength": 200,
                    "springConstant": 0.08,
                    "damping": 0.4
                },
                "solver": "forceAtlas2Based",
                "stabilization": {
                    "enabled": true,
                    "iterations": 1000
                }
            },
            "nodes": {
                "borderWidth": 2,
                "borderWidthSelected": 3,
                "font": {
                    "size": 14,
                    "face": "Arial"
                }
            },
            "edges": {
                "arrows": {
                    "to": {
                        "enabled": true,
                        "scaleFactor": 0.5
                    }
                },
                "font": {
                    "size": 12,
                    "align": "middle"
                },
                "smooth": {
                    "type": "curvedCW",
                    "roundness": 0.2
                }
            }
        }
        """)

        # 添加节点（不同类型不同颜色）
        for node in self.graph.nodes:
            node_data = self.graph.nodes[node]
            node_type = node_data.get("type", "unknown")
            label = node_data.get("label", node)
            color = self.COLOR_MAP.get(node_type, "#6b7280")
            shape = self.SHAPE_MAP.get(node_type, "dot")

            # 根据 count 调整大小
            size = 30
            count = node_data.get("count", 0)
            if count:
                size = min(30 + count * 5, 60)

            # 构建 tooltip
            title = label
            if node_data.get("description"):
                title += f"\n{node_data['description']}"
            if node_data.get("severity"):
                title = f"[{node_data['severity'].upper()}] {title}"

            net.add_node(
                node,
                label=label,
                color=color,
                shape=shape,
                size=size,
                title=title,
            )

        # 添加边
        for src, dst, data in self.graph.edges(data=True):
            net.add_edge(
                src,
                dst,
                label=data.get("label", ""),
            )

        # 生成 HTML
        html = net.generate_html(notebook=False)

        # 添加自定义样式
        custom_style = """
        <style>
            body {
                margin: 0;
                padding: 0;
                background: #1a1a2e;
            }
            #mynetwork {
                border: 1px solid #333;
                border-radius: 8px;
            }
        </style>
        """
        html = html.replace("</head>", f"{custom_style}</head>")

        return html

    def get_stats(self) -> dict:
        """获取图谱统计"""
        return {
            "nodes": self.graph.number_of_nodes(),
            "edges": self.graph.number_of_edges(),
            "error_patterns": len([n for n, d in self.graph.nodes(data=True) if d.get("type") == "error"]),
            "components": len([n for n, d in self.graph.nodes(data=True) if d.get("type") == "component"]),
            "solutions": len([n for n, d in self.graph.nodes(data=True) if d.get("type") == "solution"]),
        }


# 全局单例
knowledge_graph = KnowledgeGraph()
