### Task 8: 前端 agentService + investigationStore + 导出线

**Files:**
- Create: `frontend/src/services/agentService.ts`
- Create: `frontend/src/stores/investigationStore.ts`
- Modify: `frontend/src/services/index.ts`（加一行导出）
- Modify: `frontend/src/stores/index.ts`（加一行导出）

**Interfaces:**
- Consumes: `http.stream(path, body, signal) -> AsyncGenerator`（`frontend/src/services/http.ts`）；`useChatStore.getState().fetchMessages(sessionId)`（`frontend/src/stores/chatStore.ts`）
- Produces: `agentService.investigate(sessionId: string, signal?: AbortSignal) -> AsyncGenerator<AgentEvent>`；`AgentEvent` 类型（`type: 'step_start'|'step_progress'|'step_done'|'report_chunk'|'done'|'error'`，可选字段 `step/title/message/status/summary/content/message_id`）；`useInvestigationStore`（state：`active/running/sessionId/steps/report/error`，actions：`start(sessionId)/cancel()/close()`）；`StepState` 类型（`step/title/status: 'running'|'ok'|'failed'|'skipped'/messages: string[]/summary?`）

- [ ] **Step 1: 创建 agentService.ts**

创建 `frontend/src/services/agentService.ts`：

```typescript
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
```

- [ ] **Step 2: 创建 investigationStore.ts**

创建 `frontend/src/stores/investigationStore.ts`：

```typescript
/**
 * AI Agent 自主排查状态管理
 *
 * 流水线事件驱动 steps 时间线与流式报告；
 * 报告在后端落库为 assistant 消息，结束后刷新消息列表即可在聊天历史看到。
 */

import { create } from 'zustand';
import { agentService } from '@/services/agentService';
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
```

- [ ] **Step 3: 加导出线**

修改 `frontend/src/services/index.ts`，在末尾追加：

```typescript
export * from './agentService';
```

修改 `frontend/src/stores/index.ts`，在末尾追加：

```typescript
export * from './investigationStore';
```

- [ ] **Step 4: 构建验证**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: tsc + vite build 通过，无类型错误

- [ ] **Step 5: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add frontend/src/services/agentService.ts frontend/src/stores/investigationStore.ts frontend/src/services/index.ts frontend/src/stores/index.ts
git commit -m "feat: 前端自主排查服务与状态管理"
```

---

