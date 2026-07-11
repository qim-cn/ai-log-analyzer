/**
 * Webhook API
 */

import { http } from './http';

export interface Webhook {
  id: string;
  name: string;
  type: 'wechat' | 'dingtalk' | 'feishu' | 'custom';
  url: string;
  enabled: number;
  created_at: string;
}

export const webhookService = {
  /** 获取列表 */
  list: () => http.get<{ webhooks: Webhook[] }>('/webhooks'),

  /** 创建 */
  create: (data: { name: string; type: string; url: string }) =>
    http.post<Webhook>('/webhooks', data),

  /** 更新 */
  update: (id: string, data: Partial<Webhook>) =>
    http.put<null>(`/webhooks/${id}`, data),

  /** 删除 */
  delete: (id: string) =>
    http.delete<null>(`/webhooks/${id}`),

  /** 测试发送 */
  test: (id: string) =>
    http.post<null>(`/webhooks/${id}/test`),
};
