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
  session_title?: string;
  source?: string;
}

/**
 * 发送消息并接收流式回复
 *
 * @param signal 可选的 AbortSignal，用于取消进行中的流式请求（切会话/重发时）
 */
export async function* sendMessage(
  sessionId: string,
  content: string,
  signal?: AbortSignal
): AsyncGenerator<ChatMessage> {
  yield* http.stream('/chat', { session_id: sessionId, content }, signal);
}
