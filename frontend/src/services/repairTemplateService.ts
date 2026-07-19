/**
 * 维修操作模板库 API
 */

import { http } from './http';

export interface RepairTemplate {
  text: string;
  model: string;
  count: number;
}

export const repairTemplateService = {
  /** 查询模板（按机型过滤，含通用模板） */
  list: (model?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (model) params.set('model', model);
    params.set('limit', String(limit));
    return http.get<{ templates: RepairTemplate[] }>(
      `/repair-templates?${params.toString()}`
    );
  },

  /** 重建模板库（管理员） */
  rebuild: () => http.post<{ message: string }>('/repair-templates/rebuild', {}),
};
