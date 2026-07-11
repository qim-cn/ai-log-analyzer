"""
Vector Store - ChromaDB 向量存储

管理日志嵌入向量的存储和检索。
"""

import logging
from typing import List, Optional

import chromadb

from app.config.settings import settings
from app.services.embedding_service import embedding_service

logger = logging.getLogger(__name__)


class VectorStore:
    """向量存储服务"""

    def __init__(self, persist_dir: str = None):
        persist_dir = persist_dir or settings.chroma_persist_dir
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.collection = self.client.get_or_create_collection(
            name="log_analysis",
            metadata={"hnsw:space": "cosine"},
        )

    async def add_log(
        self,
        log_id: str,
        text: str,
        metadata: Optional[dict] = None,
    ) -> None:
        """
        添加日志到向量库

        Args:
            log_id: 日志文件 ID
            text: 日志内容（用于生成嵌入）
            metadata: 额外元数据
        """
        # 生成嵌入向量
        embedding = await embedding_service.get_embedding(text)

        # 构建元数据
        meta = metadata or {}

        # ChromaDB 元数据值只能是 str, int, float, bool
        clean_meta = {}
        for k, v in meta.items():
            if isinstance(v, (str, int, float, bool)):
                clean_meta[k] = v
            elif v is None:
                clean_meta[k] = ""
            else:
                clean_meta[k] = str(v)

        # 存储到 ChromaDB
        self.collection.upsert(
            ids=[log_id],
            embeddings=[embedding],
            documents=[text[:1000]],  # 存储前 1000 字符作为文档
            metadatas=[clean_meta],
        )

        logger.info(f"Added log {log_id} to vector store")

    async def search_similar(
        self,
        text: str,
        limit: int = 5,
        exclude_id: Optional[str] = None,
    ) -> List[dict]:
        """
        搜索相似日志

        Args:
            text: 查询文本
            limit: 返回数量
            exclude_id: 排除的日志 ID

        Returns:
            相似日志列表，包含 id, similarity, metadata
        """
        # 检查集合是否为空
        if self.collection.count() == 0:
            return []

        # 生成查询向量
        query_embedding = await embedding_service.get_embedding(text)

        # 查询
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=min(limit + 1, self.collection.count()),  # 多查一个用于排除自身
            include=["metadatas", "documents", "distances"],
        )

        # 处理结果
        similar_logs = []
        if results and results["ids"] and results["ids"][0]:
            for i, log_id in enumerate(results["ids"][0]):
                # 排除自身
                if exclude_id and log_id == exclude_id:
                    continue

                # ChromaDB 返回的是距离，需要转换为相似度
                # cosine distance 范围 [0, 2]，相似度 = 1 - distance/2
                distance = results["distances"][0][i] if results["distances"] else 0
                similarity = max(0, 1 - distance / 2)

                metadata = results["metadatas"][0][i] if results["metadatas"] else {}
                document = results["documents"][0][i] if results["documents"] else ""

                similar_logs.append({
                    "log_id": log_id,
                    "similarity": round(similarity, 4),
                    "metadata": metadata,
                    "preview": document[:200],
                })

                # 达到 limit 个结果后停止
                if len(similar_logs) >= limit:
                    break

        return similar_logs

    async def delete_log(self, log_id: str) -> None:
        """删除日志嵌入"""
        try:
            self.collection.delete(ids=[log_id])
        except Exception:
            pass  # 忽略不存在的情况

    def get_stats(self) -> dict:
        """获取集合统计信息"""
        return {
            "total_embeddings": self.collection.count(),
        }


# 全局单例
vector_store = VectorStore()
