export type MessageRole = 'user' | 'assistant' | 'system';

/** RAG 命中的历史案例参考 */
export interface CaseRef {
  filename: string;
  title: string;
  snippet: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  /** AI 回复参考的已解决案例（RAG 命中，运行时由 SSE refs 事件填充） */
  refs?: CaseRef[];
}
