/**
 * 命令黑窗口组件
 * 终端样式的深色代码块，带复制按钮。
 * 用于：聊天里 ==命令== 渲染、侧栏 Debug 命令列表。
 */

import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyText } from '@/utils';

interface CommandWindowProps {
  code: string;
  /** 紧凑模式（侧栏窄列用）：更小内边距与字号 */
  compact?: boolean;
}

export function CommandWindow({ code, compact }: CommandWindowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [code]);

  return (
    <div className="relative my-2 rounded-lg overflow-hidden border border-border bg-[#1b1b2e] shadow-sm">
      {/* 标题栏：$ 命令 + 复制 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/40 text-[11px] text-muted-foreground border-b border-white/5">
        <span className="font-mono flex items-center gap-1.5">
          <span className="text-success/80">$</span>
          <span>命令</span>
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          title="复制命令"
        >
          {copied ? (
            <>
              <Check size={12} className="text-success" />
              <span className="text-success">已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* 命令体（用 div 而非 pre/code，避开 .markdown-body pre/code 样式干扰） */}
      <div
        className={
          compact
            ? 'px-3 py-1.5 overflow-x-auto text-[11px] font-mono text-emerald-100/90 leading-relaxed whitespace-pre-wrap break-all'
            : 'px-3 py-2 overflow-x-auto text-xs font-mono text-emerald-100/90 leading-relaxed whitespace-pre-wrap break-all'
        }
      >
        {code}
      </div>
    </div>
  );
}
