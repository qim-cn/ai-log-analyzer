/**
 * 会话 API
 */

import type { Session } from '@/types';
import { http } from './http';

export const sessionService = {
  /** 创建会话 */
  create: (title?: string) => http.post<Session>('/sessions', { title }),

  /** 获取会话列表 */
  list: () => http.get<{ sessions: Session[] }>('/sessions'),

  /** 获取单个会话 */
  get: (id: string) => http.get<Session>(`/sessions/${id}`),

  /** 删除会话 */
  delete: (id: string) => http.delete<null>(`/sessions/${id}`),

  /** 重命名会话 */
  rename: (id: string, title: string) =>
    http.put<null>(`/sessions/${id}/rename`, { title }),
};
