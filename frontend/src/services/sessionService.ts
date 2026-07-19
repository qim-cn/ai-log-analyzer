/**
 * 会话 API
 */

import type { Session } from '@/types';
import { http } from './http';

export const sessionService = {
  /** 创建会话（可带机型/SN） */
  create: (title?: string, model?: string, sn?: string) =>
    http.post<Session>('/sessions', { title, model, sn }),

  /** 获取会话列表（支持机型/状态/关键字筛选） */
  list: (filters?: { model?: string; status?: string; q?: string }) => {
    const params = new URLSearchParams();
    if (filters?.model) params.set('model', filters.model);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.q) params.set('q', filters.q);
    const qs = params.toString();
    return http.get<{ sessions: Session[] }>(`/sessions${qs ? `?${qs}` : ''}`);
  },

  /** 获取单个会话 */
  get: (id: string) => http.get<Session>(`/sessions/${id}`),

  /** 删除会话 */
  delete: (id: string) => http.delete<null>(`/sessions/${id}`),

  /** 重命名会话 */
  rename: (id: string, title: string) =>
    http.put<null>(`/sessions/${id}/rename`, { title }),
};
