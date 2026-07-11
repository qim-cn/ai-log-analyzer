/**
 * 消息 API
 */

import type { Message } from '@/types';
import { http } from './http';

export const messageService = {
  /** 获取历史消息 */
  list: (sessionId: string) =>
    http.get<{ messages: Message[] }>(`/messages/${sessionId}`),
};
