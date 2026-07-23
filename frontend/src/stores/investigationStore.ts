/**
 * AI Agent 自主排查状态管理
 *
 * 流水线事件驱动 steps 时间线与流式报告；
 * 报告在后端落库为 assistant 消息，结束后刷新消息列表即可在聊天历史看到。
 */

import { create } from 'zustand';
import { agentService } from '@/services/agentService';
import { sopService } from '@/services/sopService';
import { useChatStore } from './chatStore';

export interface StepState {
  step: number;
  title: string;
  status: 'running' | 'ok' | 'failed' | 'skipped';
  messages: string[];
  summary?: string;
}

interface InvestigationState {
  active: boolean; // 是否显示排查视图（运行中或查看结果）
  running: boolean; // 流水线是否在跑
  sessionId: string | null;
  steps: StepState[];
  report: string;
  error: string | null;

  start: (sessionId: string) => Promise<void>;
  startSOP: (model: string, fault: string, sessionId: string) => Promise<void>;
  cancel: () => void;
  close: () => void;
}

// 当前排查的 AbortController；重复触发/取消时 abort 旧的
let controller: AbortController | null = null;

export const useInvestigationStore = create<InvestigationState>((set, get) => ({
  active: false,
  running: false,
  sessionId: null,
  steps: [],
  report: '',
  error: null,

  start: async (sessionId) => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    set({ active: true, running: true, sessionId, steps: [], report: '', error: null });

    const updateStep = (num: number, patch: Partial<StepState>) =>
      set((s) => ({
        steps: s.steps.map((st) => (st.step === num ? { ...st, ...patch } : st)),
      }));

    const appendStepMessage = (num: number, message: string) =>
      set((s) => ({
        steps: s.steps.map((st) =>
          st.step === num ? { ...st, messages: [...st.messages, message] } : st
        ),
      }));

    try {
      for await (const event of agentService.investigate(sessionId, signal)) {
        switch (event.type) {
          case 'step_start':
            set((s) => ({
              steps: [
                ...s.steps,
                {
                  step: event.step!,
                  title: event.title || '',
                  status: 'running',
                  messages: [],
                },
              ],
            }));
            break;
          case 'step_progress':
            appendStepMessage(event.step!, event.message || '');
            break;
          case 'step_done':
            updateStep(event.step!, {
              status: event.status || 'ok',
              summary: event.summary,
            });
            break;
          case 'report_chunk':
            set((s) => ({ report: s.report + (event.content || '') }));
            break;
          case 'error':
            set({ error: event.message || '排查失败' });
            break;
          case 'done':
            break;
        }
      }
    } catch (err: unknown) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      set({ running: false });
      if (aborted) return;
      set({ error: (err as Error)?.message || '连接失败' });
      return;
    }

    // 流正常结束（done 或 error 事件都可能）
    set({ running: false });

    // 报告已落库为 assistant 消息：刷新消息列表，聊天历史里能看到
    const sid = get().sessionId;
    if (sid) {
      useChatStore
        .getState()
        .fetchMessages(sid)
        .catch(() => {
          /* 刷新失败不影响排查结果展示 */
        });
    }
  },

  startSOP: async (model, fault, sessionId) => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    set({ active: true, running: true, sessionId, steps: [], report: '', error: null });

    const updateStep = (num: number, patch: Partial<StepState>) =>
      set((s) => ({ steps: s.steps.map((st) => (st.step === num ? { ...st, ...patch } : st)) }));

    const appendStepMessage = (num: number, message: string) =>
      set((s) => ({ steps: s.steps.map((st) => (st.step === num ? { ...st, messages: [...st.messages, message] } : st)) }));

    try {
      for await (const event of sopService.generate(model, fault, signal)) {
        switch (event.type) {
          case 'step_start':
            set((s) => ({ steps: [...s.steps, { step: event.step!, title: event.title || '', status: 'running', messages: [] }] }));
            break;
          case 'step_progress': appendStepMessage(event.step!, event.message || ''); break;
          case 'step_done': updateStep(event.step!, { status: event.status || 'ok', summary: event.summary }); break;
          case 'report_chunk': set((s) => ({ report: s.report + (event.content || '') })); break;
          case 'error': set({ error: event.message || 'SOP 生成失败' }); break;
          case 'done': break;
        }
      }
    } catch (err: unknown) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      set({ running: false });
      if (aborted) return;
      set({ error: (err as Error)?.message || '连接失败' });
      return;
    }
    set({ running: false });
    const sid = get().sessionId;
    if (sid) { useChatStore.getState().fetchMessages(sid).catch(() => {}); }
  },

  cancel: () => {
    controller?.abort();
    controller = null;
    set({ running: false });
  },

  close: () => {
    get().cancel();
    set({ active: false, steps: [], report: '', error: null, sessionId: null });
  },
}));
