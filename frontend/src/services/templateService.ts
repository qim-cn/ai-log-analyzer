/**
 * 分析模板 API
 */

import type { AnalysisTemplate } from '@/types';
import { http } from './http';

export const templateService = {
  /** 获取模板列表 */
  list: () => http.get<{ templates: AnalysisTemplate[] }>('/templates'),

  /** 创建模板（管理员） */
  create: (name: string, prompt: string) =>
    http.post<AnalysisTemplate>('/templates', { name, prompt }),

  /** 更新模板（管理员） */
  update: (id: string, name: string, prompt: string) =>
    http.put<null>(`/templates/${id}`, { name, prompt }),

  /** 删除模板（管理员） */
  delete: (id: string) =>
    http.delete<null>(`/templates/${id}`),
};
