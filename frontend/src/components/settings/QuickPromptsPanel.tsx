/**
 * 快捷提问管理面板（SettingsDialog "快捷提问" tab）
 * 增删改自定义快捷提问，localStorage 持久化，按钮显示在 ChatInput 上方
 */

import { useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import { useQuickPromptStore } from '@/stores';

export function QuickPromptsPanel() {
  const { prompts, addPrompt, updatePrompt, removePrompt } = useQuickPromptStore();
  const [newLabel, setNewLabel] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const handleAdd = () => {
    const label = newLabel.trim();
    const prompt = newPrompt.trim();
    if (!label || !prompt) return;
    addPrompt(label, prompt);
    setNewLabel('');
    setNewPrompt('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Zap size={16} className="text-primary" />
        <span className="text-sm font-medium">快捷提问</span>
        <span className="text-xs text-muted-foreground">按钮显示在输入框上方，点击即发送</span>
      </div>

      {/* 现有模板 */}
      {prompts.length === 0 ? (
        <div className="text-center text-muted-foreground py-6 text-sm">
          还没有快捷提问，在下面添加一个
        </div>
      ) : (
        <div className="space-y-2">
          {prompts.map((item) => (
            <div key={item.id} className="border border-border rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.label}
                  onChange={(e) => updatePrompt(item.id, e.target.value, item.prompt)}
                  placeholder="按钮文字"
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-input bg-background text-sm"
                />
                <button
                  onClick={() => removePrompt(item.id)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <textarea
                value={item.prompt}
                onChange={(e) => updatePrompt(item.id, item.label, e.target.value)}
                placeholder="发送给 AI 的内容"
                rows={2}
                className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-sm resize-none"
              />
            </div>
          ))}
        </div>
      )}

      {/* 新增 */}
      <div className="border border-dashed border-muted-foreground/25 rounded-xl p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">新增快捷提问</div>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="按钮文字，如：有没有 OOM"
          className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-sm"
        />
        <textarea
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          placeholder="发送给 AI 的内容"
          rows={2}
          className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-sm resize-none"
        />
        <button
          onClick={handleAdd}
          disabled={!newLabel.trim() || !newPrompt.trim()}
          className="w-full py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground
                     hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5
                     disabled:opacity-50"
        >
          <Plus size={14} /> 添加
        </button>
      </div>
    </div>
  );
}
