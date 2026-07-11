/**
 * 日志文件状态管理
 */

import { create } from 'zustand';
import type { LogFile } from '@/types';
import { logService } from '@/services';

interface LogState {
  logFiles: LogFile[];
  selectedLogId: string | null;
  selectedLogContent: string | null;
  loading: boolean;
  uploading: boolean;

  // Actions
  fetchLogs: (sessionId: string) => Promise<void>;
  uploadLog: (sessionId: string, file: File) => Promise<void>;
  deleteLog: (logId: string) => Promise<void>;
  selectLog: (logId: string | null) => void;
}

export const useLogStore = create<LogState>((set, get) => ({
  logFiles: [],
  selectedLogId: null,
  selectedLogContent: null,
  loading: false,
  uploading: false,

  fetchLogs: async (sessionId) => {
    set({ loading: true });
    try {
      const data = await logService.list(sessionId);
      set({ logFiles: data.files });
    } finally {
      set({ loading: false });
    }
  },

  uploadLog: async (sessionId, file) => {
    set({ uploading: true });
    try {
      const logFile = await logService.upload(sessionId, file);
      set((state) => ({
        logFiles: [...state.logFiles, logFile],
      }));
    } finally {
      set({ uploading: false });
    }
  },

  deleteLog: async (logId) => {
    await logService.delete(logId);
    const { selectedLogId } = get();
    set((state) => ({
      logFiles: state.logFiles.filter((f) => f.id !== logId),
      selectedLogId: selectedLogId === logId ? null : selectedLogId,
      selectedLogContent:
        selectedLogId === logId ? null : state.selectedLogContent,
    }));
  },

  selectLog: (logId) => {
    const { logFiles } = get();
    const log = logFiles.find((f) => f.id === logId);
    set({
      selectedLogId: logId,
      selectedLogContent: log?.content || log?.summary || null,
    });
  },
}));
