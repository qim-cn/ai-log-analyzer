/**
 * 聊天 API（SSE 流式）
 */

import { http } from './http';

export interface ChatMessage {
  content?: string;
  done?: boolean;
  error?: string;
  status?: string;
  message?: string;
}

/**
 * 发送消息并接收流式回复
 */
export async function* sendMessage(
  sessionId: string,
  content: string
): AsyncGenerator<ChatMessage> {
  yield* http.stream('/chat', { session_id: sessionId, content });
}
