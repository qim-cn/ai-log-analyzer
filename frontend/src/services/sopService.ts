/**
 * 维修 SOP 生成 API（SSE 流式）
 */

import { http } from './http';
import type { AgentEvent } from './agentService';

/**
 * 生成维修 SOP
 * @param signal 用于取消（AbortController）
 */
export async function* generateSOP(
  model: string,
  fault: string,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  yield* http.stream('/sop/generate', { model, fault }, signal) as unknown as AsyncGenerator<AgentEvent>;
}

export const sopService = { generate: generateSOP };
