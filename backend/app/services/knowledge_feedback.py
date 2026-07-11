"""
智能知识反哺服务

用户发消息时，先搜索 Obsidian 知识库，找到相关历史案例注入上下文。
"""

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.obsidian_service import ObsidianService

logger = logging.getLogger(__name__)


class KnowledgeFeedback:
    """知识反哺服务"""

    async def search_and_inject(
        self,
        query: str,
        obsidian_service: "ObsidianService",
    ) -> str:
        """
        搜索知识库并生成注入文本

        Args:
            query: 用户提问
            obsidian_service: Obsidian 服务实例

        Returns:
            注入到 system prompt 的文本
        """
        try:
            # 从用户提问中提取关键词
            keywords = self._extract_keywords(query)
            if not keywords:
                return ""

            # 搜索知识库
            results = []
            for kw in keywords[:3]:  # 只搜前 3 个关键词
                search_results = await obsidian_service.search_notes(kw)
                results.extend(search_results)

            # 去重
            seen = set()
            unique_results = []
            for r in results:
                key = r.get("filename", "")
                if key not in seen:
                    seen.add(key)
                    unique_results.append(r)

            if not unique_results:
                return ""

            # 生成注入文本
            parts = ["\n## 历史参考案例\n"]
            parts.append("以下是知识库中相关的 DEBUG 记录，请参考这些历史案例来分析当前问题：\n")

            for r in unique_results[:3]:  # 最多注入 3 条
                title = r.get("title", r.get("filename", ""))
                snippet = r.get("snippet", "")[:200]
                filename = r.get("filename", "")
                parts.append(f"- **{title}**")
                if snippet:
                    parts.append(f"  摘要: {snippet}")
                parts.append(f"  文件: {filename}")
                parts.append("")

            logger.info(f"知识反哺: 找到 {len(unique_results)} 条相关记录")
            return "\n".join(parts)

        except Exception as e:
            logger.warning(f"知识反哺搜索失败: {e}")
            return ""

    def _extract_keywords(self, text: str) -> list[str]:
        """从文本中提取关键词"""
        import re

        # 提取错误相关关键词
        error_patterns = [
            r"(?:ERROR|FATAL|CRITICAL|EXCEPTION|FAIL)\S*",
            r"\w+Error\b",
            r"\w+Exception\b",
            r"DIMM\s*\w+",
            r"CPU\s*\d+",
            r"PSU\s*\w+",
            r"BMC\s*\w+",
            r"BIOS\s*\w+",
            r"内存\S*",
            r"硬盘\S*",
            r"电源\S*",
            r"风扇\S*",
        ]

        keywords = []
        for pattern in error_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            keywords.extend(matches)

        # 去重并限制数量
        unique = list(dict.fromkeys(keywords))
        return unique[:5]


# 全局实例
knowledge_feedback = KnowledgeFeedback()
