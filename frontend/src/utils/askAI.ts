/**
 * 向聊天直接发送一条消息（复用 chatStore 的流式发送流程，不另造轮子）
 *
 * 没有活动会话时按现有逻辑新建会话（与 MainLayout EmptyState 的 createSession 一致）。
 * 供"问 AI"类按钮使用（错误聚类、时间窗分析等）。
 */

import { useChatStore, useSessionStore } from '@/stores';

export async function sendPromptToChat(
  sessionId: string | undefined,
  prompt: string
): Promise<void> {
  let sid = sessionId;
  if (!sid) {
    const session = await useSessionStore.getState().createSession();
    sid = session.id;
  }
  await useChatStore.getState().sendMessage(sid, prompt);
}
