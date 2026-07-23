### Task 10: ChatPanel + LogPanel 入口集成

**Files:**
- Modify: `frontend/src/components/chat/ChatPanel.tsx`
- Modify: `frontend/src/components/log/LogPanel.tsx`

**Interfaces:**
- Consumes: `useInvestigationStore`（Task 8，经 `@/stores` 导出）；`InvestigationView`（Task 9）；`useLogStore` 的 `logFiles`（现有）
- Produces: ChatPanel 头部"自主排查"按钮 + `/investigate` 输入命令 + 排查视图切换；LogPanel 上传区下方"深度排查"按钮

- [ ] **Step 1: 修改 ChatPanel.tsx**

在 `frontend/src/components/chat/ChatPanel.tsx` 中做 4 处修改：

(a) import 区，把 lucide-react 的 import 行：

```tsx
import { Copy, Check, Paperclip, FileText, GitCompareArrows } from 'lucide-react';
```

改为：

```tsx
import { Copy, Check, Paperclip, FileText, GitCompareArrows, Microscope } from 'lucide-react';
```

并在组件 import 区追加：

```tsx
import { InvestigationView } from '@/components/agent/InvestigationView';
import { useInvestigationStore } from '@/stores/investigationStore';
```

(b) 在 `const [showCompare, setShowCompare] = useState(false);` 之后加：

```tsx
  const investActive = useInvestigationStore((s) => s.active);
  const startInvestigation = useInvestigationStore((s) => s.start);
```

(c) `handleSend` 函数改为（加 `/investigate` 命令拦截）：

```tsx
  const handleSend = async (content: string) => {
    // /investigate 命令：触发 AI 自主排查
    if (content.trim() === '/investigate') {
      if (logFiles.length > 0 && !streaming) {
        await startInvestigation(sessionId);
      }
      return;
    }
    try {
      await sendMessage(sessionId, content);
    } catch (error) {
      console.error('发送失败:', error);
    }
  };
```

(d) header 按钮区，在 `<ExportButton sessionId={sessionId} />` 之后加：

```tsx
          <button
            onClick={() => startInvestigation(sessionId)}
            disabled={logFiles.length === 0 || streaming}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors disabled:opacity-30"
            title="AI 自主排查"
          >
            <Microscope size={15} />
          </button>
```

(e) 消息列表区，把：

```tsx
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
```

改为：

```tsx
      {/* Messages / 自主排查视图 */}
      {investActive ? (
        <InvestigationView />
      ) : (
      <div className="flex-1 overflow-y-auto">
```

并把该区块对应的闭合 `</div>`（在 `<div ref={messagesEndRef} />` 之后的那个）后加 `)}`，即：

```tsx
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
      )}
```

注意：改动后 JSX 结构为 `{investActive ? <InvestigationView /> : (<div className="flex-1 overflow-y-auto">...原内容...</div>)}`，保持原缩进不强制重排。

- [ ] **Step 2: 修改 LogPanel.tsx**

在 `frontend/src/components/log/LogPanel.tsx` 中做 3 处修改：

(a) import 区，把：

```tsx
import {
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
```

改为：

```tsx
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Microscope,
} from 'lucide-react';
```

并追加：

```tsx
import { useInvestigationStore } from '@/stores/investigationStore';
```

(b) 组件内 `const [showSimilar, setShowSimilar] = useState(false);` 之后加：

```tsx
  const startInvestigation = useInvestigationStore((s) => s.start);
```

(c) 上传区，把：

```tsx
          {/* Upload */}
          <div className="p-3 border-b border-border">
            <LogUploader sessionId={sessionId} />
          </div>
```

改为：

```tsx
          {/* Upload + 深度排查入口 */}
          <div className="p-3 border-b border-border space-y-2">
            <LogUploader sessionId={sessionId} />
            {logFiles.length > 0 && (
              <button
                onClick={() => startInvestigation(sessionId)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Microscope size={13} />
                深度排查
              </button>
            )}
          </div>
```

- [ ] **Step 3: 构建验证**

Run: `cd /home/qim/code/ai-log-analyzer/frontend && npm run build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
cd /home/qim/code/ai-log-analyzer
git add frontend/src/components/chat/ChatPanel.tsx frontend/src/components/log/LogPanel.tsx
git commit -m "feat: 聊天面板与日志面板接入自主排查入口"
```

---

