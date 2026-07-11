/**
 * AI 配置状态管理
 */

import { create } from 'zustand';
import type { AISettings, ModelsResponse } from '@/types';
import { settingsService } from '@/services';

interface SettingsState {
  aiSettings: AISettings | null;
  models: ModelsResponse | null;
  loading: boolean;

  // Actions
  fetchSettings: () => Promise<void>;
  fetchModels: () => Promise<void>;
  updateSettings: (data: {
    provider: string;
    base_url?: string;
    api_key?: string;
    model?: string;
  }) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  aiSettings: null,
  models: null,
  loading: false,

  fetchSettings: async () => {
    set({ loading: true });
    try {
      const settings = await settingsService.getAI();
      set({ aiSettings: settings });
    } finally {
      set({ loading: false });
    }
  },

  fetchModels: async () => {
    const models = await settingsService.getModels();
    set({ models });
  },

  updateSettings: async (data) => {
    const settings = await settingsService.updateAI(data);
    set({ aiSettings: settings });
  },
}));
