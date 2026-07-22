/**
 * AI Agent 自主排查 API（SSE 流式）
 */

import { http } from './http';

export interface AgentEvent {
  type: 'step_start' | 'step_progress' | 'step_done' | 'report_chunk' | 'done' | 'error';
  step?: number;
  title?: string;
  message?: string;
  status?: 'ok' | 'failed' | 'skipped';
  summary?: string;
  content?: string;
  message_id?: string;
}

/**
 * 启动自主排查并流式接收事件
 * @param signal 用于取消（AbortController）
 */
export async function* investigate(
  sessionId: string,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  // http.stream 的返回类型是通用 chunk 形状，与 AgentEvent 不兼容，需 as unknown 中转
  yield* http.stream('/agent/investigate', { session_id: sessionId }, signal) as unknown as AsyncGenerator<AgentEvent>;
}

export const agentService = { investigate };
