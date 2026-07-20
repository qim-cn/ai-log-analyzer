/**
 * 自定义快捷提问（localStorage 持久化，自用工具无需后端存储）
 *
 * 按钮展示在 ChatInput 上方，点击即发送；
 * 管理界面在 SettingsDialog 的"快捷提问"tab。
 */

import { create } from 'zustand';

export interface QuickPrompt {
  id: string;
  /** 按钮文字 */
  label: string;
  /** 发送给 AI 的内容 */
  prompt: string;
}

const STORAGE_KEY = 'quick_prompts';

/** 首次使用的默认模板（可被用户修改/删除） */
const DEFAULT_PROMPTS: QuickPrompt[] = [
  {
    id: 'default-oom',
    label: '有没有 OOM',
    prompt: '日志里有没有 OOM（内存溢出）相关的错误或迹象？请指出具体行并分析。',
  },
  {
    id: 'default-error-dist',
    label: '总结 ERROR 分布',
    prompt: '请总结这份日志中 ERROR 的分布情况：主要错误类型、出现频率最高的错误和时间分布。',
  },
];

function loadPrompts(): QuickPrompt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // 从未存过 -> 默认模板；存过（含空数组）-> 尊重用户选择
    if (raw === null) return DEFAULT_PROMPTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_PROMPTS;
  } catch {
    return DEFAULT_PROMPTS;
  }
}

function savePrompts(prompts: QuickPrompt[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

interface QuickPromptState {
  prompts: QuickPrompt[];
  addPrompt: (label: string, prompt: string) => void;
  updatePrompt: (id: string, label: string, prompt: string) => void;
  removePrompt: (id: string) => void;
}

export const useQuickPromptStore = create<QuickPromptState>((set) => ({
  prompts: loadPrompts(),

  addPrompt: (label, prompt) =>
    set((state) => {
      const prompts = [
        ...state.prompts,
        { id: `qp-${Date.now()}`, label, prompt },
      ];
      savePrompts(prompts);
      return { prompts };
    }),

  updatePrompt: (id, label, prompt) =>
    set((state) => {
      const prompts = state.prompts.map((p) =>
        p.id === id ? { ...p, label, prompt } : p
      );
      savePrompts(prompts);
      return { prompts };
    }),

  removePrompt: (id) =>
    set((state) => {
      const prompts = state.prompts.filter((p) => p.id !== id);
      savePrompts(prompts);
      return { prompts };
    }),
}));
