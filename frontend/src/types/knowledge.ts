/**
 * 知识图谱相关类型定义
 */

/** 相似日志 */
export interface SimilarLog {
  log_id: string;
  similarity: number;
  session_id: string;
  summary: string;
  solution: string | null;
  timestamp: string;
}

/** 知识实体（API 响应格式） */
export interface KnowledgeEntity {
  id: string;
  type: 'error' | 'component' | 'solution';
  name: string;
  count: number;
  first_seen: string | null;
  last_seen: string | null;
  related_components: string[];
  solutions: string[];
  // solution 类型特有字段
  error_pattern?: string;
  success_rate?: number;
}

/** 知识图谱实体（pyvis 渲染用） */
export interface GraphNode {
  id: string;
  label: string;
  type: 'error' | 'component' | 'solution';
  description?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  count?: number;
  color?: string;
}

/** 知识图谱边 */
export interface KnowledgeEdge {
  source: string;
  target: string;
  label?: string;
  count?: number;
}

/** 知识图谱数据 */
export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: KnowledgeEdge[];
}

/** 知识图谱统计 */
export interface KnowledgeStats {
  error_patterns: number;
  relations: number;
  solutions: number;
}

/** Reindex 响应 */
export interface ReindexResponse {
  indexed: number;
  skipped: number;
}
