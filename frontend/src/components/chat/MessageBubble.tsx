/**
 * 消息气泡组件
 * 区分 user/assistant，assistant 消息支持 Markdown 渲染
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, User, Bot } from 'lucide-react';
import { useState } from 'react';
import type { Message } from '@/types';
import { cn } from '@/utils';
import { SaveToKnowledgeButton } from './SaveToKnowledgeButton';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user';

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
          'max-w-[80%] min-w-0',
          isUser ? 'text-right' : 'text-left'
        )}
      >
        <div
          className={cn(
            'inline-block px-4 py-2.5 text-sm',
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

          {/* 保存到知识库（仅 AI 回复） */}
          {!isUser && !isStreaming && (
            <SaveToKnowledgeButton
              analysis={message.content}
              sessionId={message.session_id}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
}

function MarkdownContent({ content, isStreaming }: MarkdownContentProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');

            if (match) {
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
        {content}
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
