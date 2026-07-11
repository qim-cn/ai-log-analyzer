/**
 * 聊天输入框组件
 * 支持 Shift+换行、Enter 发送、引用日志行
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useChatStore } from '@/stores';
import { cn } from '@/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  streaming?: boolean;
}

export function ChatInput({ onSend, disabled, streaming }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputQuote = useChatStore((s) => s.inputQuote);

  useEffect(() => {
    if (inputQuote) {
      setValue((prev) => (prev ? prev + '\n' + inputQuote : inputQuote));
      textareaRef.current?.focus();
    }
  }, [inputQuote]);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { prompt } = e.detail;
      setValue(prompt);
      textareaRef.current?.focus();
    };
    window.addEventListener('analyze-log' as string, handler as EventListener);
    return () =>
      window.removeEventListener('analyze-log' as string, handler as EventListener);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || streaming) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, streaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="flex items-end gap-2.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Shift+Enter 换行)"
          disabled={disabled || streaming}
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-xl border border-input bg-background',
            'px-4 py-3 text-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'min-h-[44px] max-h-[200px] transition-all duration-150'
          )}
        />

        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled || streaming}
          className={cn(
            'shrink-0 w-10 h-10 rounded-xl flex items-center justify-center',
            'bg-primary text-primary-foreground',
            'hover:shadow-glow active:scale-95 transition-all duration-150',
            'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100'
          )}
        >
          {streaming ? (
            <Loader2 size={17} className="animate-spin" />
          ) : (
            <Send size={17} />
          )}
        </button>
      </div>

      <div className="text-[11px] text-muted-foreground/40 text-center mt-2">
        AI 可能会产生不准确的信息，请注意甄别
      </div>
    </div>
  );
}
