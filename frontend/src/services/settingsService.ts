/**
 * 设置 API
 */

import type { AISettings, EmbeddingSettings, ModelsResponse } from '@/types';
import { http } from './http';

export const settingsService = {
  /** 获取 AI 配置 */
  getAI: () =>
    http.get<AISettings>('/settings/ai'),

  /** 更新 AI 配置 */
  updateAI: (data: {
    provider: string;
    base_url?: string;
    api_key?: string;
    model?: string;
  }) =>
    http.put<AISettings>('/settings/ai', data),

  /** 获取可用模型列表 */
  getModels: () =>
    http.get<ModelsResponse>('/settings/models'),

  /** 获取嵌入模型配置 */
  getEmbedding: () =>
    http.get<EmbeddingSettings>('/settings/embedding'),

  /** 更新嵌入模型配置 */
  updateEmbedding: (data: {
    provider?: string;
    model?: string;
    base_url?: string;
    api_key?: string;
  }) =>
    http.put<EmbeddingSettings>('/settings/embedding', data),
};
