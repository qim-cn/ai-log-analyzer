/**
 * 会话状态管理
 */

import { create } from 'zustand';
import type { Session } from '@/types';
import { sessionService } from '@/services';

interface SessionState {
  sessions: Session[];
  currentSessionId: string | null;
  loading: boolean;
  searchQuery: string;
  searchResults: Session[];

  // Actions
  fetchSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<Session>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  setCurrentSession: (id: string | null) => void;
  searchSessions: (query: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  loading: false,
  searchQuery: '',
  searchResults: [],

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const data = await sessionService.list();
      set({ sessions: data.sessions });
    } finally {
      set({ loading: false });
    }
  },

  createSession: async (title) => {
    const session = await sessionService.create(title);
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
    }));
    return session;
  },

  deleteSession: async (id) => {
    await sessionService.delete(id);
    const { sessions, currentSessionId } = get();
    const filtered = sessions.filter((s) => s.id !== id);
    set({
      sessions: filtered,
      currentSessionId: currentSessionId === id ? filtered[0]?.id || null : currentSessionId,
    });
  },

  renameSession: async (id, title) => {
    await sessionService.rename(id, title);
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
    }));
  },

  setCurrentSession: (id) => {
    set({ currentSessionId: id });
  },

  searchSessions: (query) => {
    const { sessions } = get();
    if (!query.trim()) {
      set({ searchQuery: '', searchResults: [] });
      return;
    }
    const q = query.toLowerCase();
    const results = sessions.filter(
      (s) => s.title.toLowerCase().includes(q)
    );
    set({ searchQuery: query, searchResults: results });
  },
}));
