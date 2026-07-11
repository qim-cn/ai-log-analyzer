/**
 * 思考过程气泡
 * 显示 AI 正在思考的动画
 */

import { Bot } from 'lucide-react';

interface ThinkingBubbleProps {
  message: string;
}

export function ThinkingBubble({ message }: ThinkingBubbleProps) {
  return (
    <div className="flex gap-3 px-4 py-3 animate-fade-in">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-primary/15 text-primary">
        <Bot size={16} />
      </div>

      {/* Content */}
      <div className="max-w-[80%] min-w-0">
        <div className="inline-block rounded-2xl rounded-tl-md px-4 py-3 bg-card border border-border shadow-surface">
          <div className="flex items-center gap-2.5 text-sm">
            {/* 旋转动画 */}
            <div className="relative w-4 h-4">
              <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
            </div>
            <span className="text-muted-foreground">{message}</span>
          </div>

          {/* 动态点 */}
          <div className="flex gap-1.5 mt-2 pl-6">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-thinking-dot"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
