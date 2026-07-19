/**
 * 消息气泡组件
 * 区分 user/assistant，assistant 消息支持 Markdown 渲染
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, User, Bot, BookOpen } from 'lucide-react';
import { useState } from 'react';
import type { Message, CaseRef } from '@/types';
import { obsidianService } from '@/services/obsidianService';
import { cn, copyText, preprocessChatMarkdown } from '@/utils';
import { CommandWindow } from '@/components/ui/CommandWindow';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopyMsg = async () => {
    if (await copyText(message.content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-3 animate-fade-in',
        isUser && 'flex-row-reverse'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-medium',
          isUser
            ? 'bg-primary/15 text-primary border border-primary/25'
            : 'bg-accent/15 text-accent border border-accent/25'
        )}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Content */}
      <div
        className={cn(
          'max-w-[min(80%,760px)] min-w-0',
          isUser ? 'text-right' : 'text-left'
        )}
      >
        <div
          className={cn(
            'inline-block px-4 py-2.5 text-sm select-text',
            isUser
              ? 'bg-muted text-foreground rounded-2xl rounded-tr-md'
              : 'bg-card border border-border rounded-2xl rounded-tl-md shadow-surface markdown-body'
          )}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
          ) : (
            <MarkdownContent
              content={message.content}
              isStreaming={isStreaming}
            />
          )}
        </div>

        {/* Actions */}
        <div className={cn('flex items-center gap-1 mt-1', isUser && 'justify-end')}>
          {/* Time */}
          <span className="text-[11px] text-muted-foreground/60 px-1">
            {new Date(message.created_at).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>

          {/* 复制整段消息 */}
          {!isStreaming && (
            <button
              onClick={handleCopyMsg}
              className="p-1 hover:bg-muted rounded-md transition-colors"
              title="复制整段"
            >
              {copied
                ? <Check size={12} className="text-success" />
                : <Copy size={12} className="text-muted-foreground/70" />}
            </button>
          )}
        </div>

        {/* 参考案例（RAG 命中） */}
        {!isUser && message.refs && message.refs.length > 0 && (
          <CaseRefs refs={message.refs} />
        )}
      </div>
    </div>
  );
}

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
}

function MarkdownContent({ content, isStreaming }: MarkdownContentProps) {
  // 预处理：==命令== -> ```command 块（黑窗口），==日志== -> 加粗
  const processed = preprocessChatMarkdown(content);
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 透传 pre：避免 react-markdown 给代码块套一层 <pre>，让 CommandWindow/CodeBlock 自带外壳
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');

            if (match) {
              // ==命令== 预处理成的 command 块 -> 黑窗口
              if (language === 'command') {
                return <CommandWindow code={codeString} />;
              }
              return (
                <CodeBlock language={language} code={codeString} />
              );
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>

      {/* 流式光标 */}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5 rounded-sm" />
      )}
    </div>
  );
}

interface CodeBlockProps {
  language: string;
  code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 text-xs text-muted-foreground border-b border-border">
        <span className="font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
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

      {/* Code */}
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.8125rem',
          lineHeight: '1.6',
          padding: '1rem',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

interface CaseRefsProps {
  refs: CaseRef[];
}

function CaseRefs({ refs }: CaseRefsProps) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, "helpful" | "unhelpful">>({});

  const handleFb = async (filename: string, helpful: boolean) => {
    setFeedback((prev) => ({ ...prev, [filename]: helpful ? "helpful" : "unhelpful" }));
    try {
      await obsidianService.feedback(filename, helpful);
    } catch {
      /* 静默 */
    }
  };

  return (
    <div className="mt-1 text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-primary flex items-center gap-1"
      >
        <BookOpen size={11} /> 参考了 {refs.length} 个已解决案例 {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5">
          {refs.map((r, i) => (
            <div key={i} className="px-2 py-1.5 rounded-md border border-border bg-muted/30">
              <div className="font-medium text-foreground truncate">{r.title}</div>
              {r.snippet && (
                <div className="text-muted-foreground/70 mt-0.5 line-clamp-2">{r.snippet}</div>
              )}
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => handleFb(r.filename, true)}
                  className={cn(
                    "px-1.5 py-0.5 rounded transition-colors",
                    feedback[r.filename] === "helpful"
                      ? "bg-emerald-500/20 text-emerald-600"
                      : "text-muted-foreground hover:text-emerald-600"
                  )}
                >
                  👍 有用
                </button>
                <button
                  onClick={() => handleFb(r.filename, false)}
                  className={cn(
                    "px-1.5 py-0.5 rounded transition-colors",
                    feedback[r.filename] === "unhelpful"
                      ? "bg-amber-500/20 text-amber-600"
                      : "text-muted-foreground hover:text-amber-600"
                  )}
                >
                  👎 无关
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
