/**
 * 告警规则 API
 */

import { http } from './http';

export interface AlertRule {
  id: string;
  name: string;
  condition: string;
  time_window: string;
  enabled: number;
  action: string;
  created_at: string;
  updated_at: string;
}

export const ruleService = {
  /** 获取规则列表 */
  list: () => http.get<{ rules: AlertRule[] }>('/rules'),

  /** 创建规则 */
  create: (data: { name: string; condition: string; time_window?: string; action?: string }) =>
    http.post<AlertRule>('/rules', data),

  /** 更新规则 */
  update: (id: string, data: Partial<AlertRule>) =>
    http.put<null>(`/rules/${id}`, data),

  /** 删除规则 */
  delete: (id: string) =>
    http.delete<null>(`/rules/${id}`),
};
