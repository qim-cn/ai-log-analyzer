/**
 * 聊天状态管理
 */

import { create } from 'zustand';
import type { Message } from '@/types';
import { messageService, sendMessage } from '@/services';
import { useSessionStore } from './sessionStore';

interface ChatState {
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  streamingContent: string;
  inputQuote: string;
  thinking: boolean;
  thinkingMessage: string;

  // Actions
  fetchMessages: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string) => Promise<void>;
  regenerate: (sessionId: string) => Promise<void>;
  clearMessages: () => void;
  setInputQuote: (quote: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  streaming: false,
  streamingContent: '',
  inputQuote: '',
  thinking: false,
  thinkingMessage: '',

  fetchMessages: async (sessionId) => {
    set({ loading: true });
    try {
      const data = await messageService.list(sessionId);
      set({ messages: data.messages });
    } finally {
      set({ loading: false });
    }
  },

  sendMessage: async (sessionId, content) => {
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      session_id: sessionId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      streaming: true,
      streamingContent: '',
      thinking: true,
      thinkingMessage: '正在分析...',
    }));

    try {
      let fullContent = '';
      let hasStartedContent = false;

      for await (const chunk of sendMessage(sessionId, content)) {
        if (chunk.error) throw new Error(chunk.error);

        if (chunk.status === 'thinking') {
          set({ thinkingMessage: chunk.message || '正在思考...' });
          continue;
        }

        if (chunk.content && !hasStartedContent) {
          hasStartedContent = true;
          set({ thinking: false, thinkingMessage: '' });
        }

        if (chunk.content) {
          fullContent += chunk.content;
          set({ streamingContent: fullContent });
        }

        if (chunk.done) {
          // 回传会话标题，触发侧栏刷新
          if (chunk.session_title) {
            useSessionStore.getState().renameSession(sessionId, chunk.session_title);
          }
          break;
        }
      }

      const assistantMessage: Message = {
        id: `temp-${Date.now()}`,
        session_id: sessionId,
        role: 'assistant',
        content: fullContent,
        created_at: new Date().toISOString(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMessage],
        streaming: false,
        streamingContent: '',
        thinking: false,
        thinkingMessage: '',
      }));
    } catch (error) {
      set({ streaming: false, streamingContent: '', thinking: false, thinkingMessage: '' });
      throw error;
    }
  },

  regenerate: async (sessionId) => {
    const { messages } = get();
    // 找到最后一条用户消息
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;

    // 删除最后一条 AI 回复
    const messagesWithoutLast = messages.filter(
      (m, i) => !(m.role === 'assistant' && i === messages.length - 1)
    );
    set({ messages: messagesWithoutLast });

    // 重新发送
    await get().sendMessage(sessionId, lastUserMsg.content);
  },

  clearMessages: () => {
    set({ messages: [], streamingContent: '', inputQuote: '', thinking: false, thinkingMessage: '' });
  },

  setInputQuote: (quote) => {
    set({ inputQuote: quote });
  },
}));
