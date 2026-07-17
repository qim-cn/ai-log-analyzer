/**
 * 知识图谱 API
 */

import type {
  AnomalyResult,
  AnomalySummary,
  KnowledgeEntity,
  KnowledgeStats,
  ReindexResponse,
  TrendAnalysis,
  TrendSummary,
} from '@/types';
import { http } from './http';

export const knowledgeService = {
  /** 获取知识图谱可视化 HTML（返回原始 HTML） */
  getGraph: async (): Promise<string> => {
    const response = await fetch('/api/knowledge/graph?format=html', {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Failed to fetch knowledge graph');
    }
    return response.text();
  },

  /** 获取知识实体 */
  getEntities: (type: string = 'all', limit: number = 50) =>
    http.get<{ entities: KnowledgeEntity[] }>(`/knowledge/entities?type=${type}&limit=${limit}`),

  /** 获取知识图谱统计信息 */
  getStats: () =>
    http.get<KnowledgeStats>('/knowledge/stats'),

  /** 手动触发向量化（历史数据迁移） */
  reindex: () =>
    http.post<ReindexResponse>('/knowledge/reindex'),

  /** 获取异常检测结果 */
  getAnomalies: (sessionId?: string) => {
    const params = sessionId ? `?session_id=${sessionId}` : '';
    return http.get<AnomalyResult | AnomalySummary>(`/knowledge/anomalies${params}`);
  },

  /** 获取趋势预测 */
  getTrends: (sessionId?: string, days: number = 7) => {
    const params = new URLSearchParams();
    if (sessionId) params.append('session_id', sessionId);
    params.append('days', days.toString());
    return http.get<TrendAnalysis | TrendSummary>(`/knowledge/trends?${params.toString()}`);
  },
};
