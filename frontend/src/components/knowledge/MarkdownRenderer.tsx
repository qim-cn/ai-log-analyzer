/**
 * Markdown 渲染器
 * 支持标准 Markdown + Obsidian 扩展语法
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Lightbulb } from 'lucide-react';
import { useState, useCallback } from 'react';
import { cn } from '@/utils';

interface MarkdownRendererProps {
  content: string;
  onLinkClick?: (path: string) => void;
}

export function MarkdownRenderer({ content, onLinkClick }: MarkdownRendererProps) {
  // 预处理：Obsidian 扩展语法
  const processed = preprocessObsidian(content);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none
                    prose-headings:scroll-mt-20
                    prose-h1:text-2xl prose-h1:font-bold prose-h1:mb-4
                    prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-8 prose-h2:mb-3
                    prose-h3:text-lg prose-h3:font-medium prose-h3:mt-6 prose-h3:mb-2
                    prose-p:text-sm prose-p:leading-relaxed prose-p:my-3
                    prose-code:text-sm prose-code:font-mono
                    prose-pre:rounded-lg prose-pre:border prose-pre:border-border
                    prose-table:text-sm
                    prose-blockquote:border-l-2 prose-blockquote:border-primary/30 prose-blockquote:pl-3 prose-blockquote:italic
                    ">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 代码块
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');

            if (match) {
              return <CodeBlock language={language} code={codeString} />;
            }

            return (
              <code className={cn(className, 'px-1.5 py-0.5 rounded bg-muted text-xs')} {...props}>
                {children}
              </code>
            );
          },

          // 链接：处理 wikilink
          a({ href, children, ...props }) {
            if (href?.startsWith('[[') || (typeof children === 'string' && children.startsWith('[['))) {
              // Wikilink
              const linkText = typeof children === 'string'
                ? children.replace(/^\[\[|\]\]$/g, '')
                : href?.replace(/^\[\[|\]\]$/g, '') || '';

              return (
                <button
                  onClick={() => onLinkClick?.(linkText + '.md')}
                  className="text-primary hover:underline cursor-pointer"
                >
                  {linkText}
                </button>
              );
            }

            return <a href={href} {...props}>{children}</a>;
          },

          // 图片
          img({ src, alt, ...props }) {
            if (src?.startsWith('![[')) {
              // Obsidian 图片嵌入
              const imgPath = src.replace(/^!\[\[|\]\]$/g, '');
              return (
                <span className="text-xs text-muted-foreground italic">
                  [图片: {imgPath}]
                </span>
              );
            }

            return <img src={src} alt={alt} {...props} />;
          },

          // 块引用：处理 callout
          blockquote({ children, ...props }) {
            const content = String(children);

            // 检查是否是 callout
            const calloutMatch = content.match(/^\[!(\w+)\]\s*/);
            if (calloutMatch) {
              const type = calloutMatch[1].toLowerCase();
              const rest = content.replace(/^\[\w+\]\s*/, '');

              return <Callout type={type}>{rest}</Callout>;
            }

            return <blockquote {...props}>{children}</blockquote>;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

// ============================================================
// 预处理 Obsidian 语法
// ============================================================

function preprocessObsidian(content: string): string {
  let processed = content;

  // ==高亮文本== → <mark>高亮文本</mark>
  processed = processed.replace(
    /==([^=]+)==/g,
    '<mark class="bg-yellow-500/20 text-yellow-300 px-1 rounded">$1</mark>'
  );

  // ![[图片]] → 图片占位
  processed = processed.replace(
    /!\[\[([^\]]+)\]\]/g,
    '![[[$1]]]'
  );

  // [[wikilink]] → 链接
  processed = processed.replace(
    /\[\[([^\]]+)\]\]/g,
    '[[$1]]'
  );

  return processed;
}

// ============================================================
// 代码块组件
// ============================================================

interface CodeBlockProps {
  language: string;
  code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-border">
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

// ============================================================
// Callout 组件
// ============================================================

const CALLOUT_CONFIG: Record<string, { icon: typeof Info; color: string; title: string }> = {
  note: { icon: Info, color: 'text-blue-400 border-blue-500/30 bg-blue-500/10', title: 'Note' },
  warning: { icon: AlertTriangle, color: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10', title: 'Warning' },
  danger: { icon: AlertCircle, color: 'text-red-400 border-red-500/30 bg-red-500/10', title: 'Danger' },
  tip: { icon: Lightbulb, color: 'text-green-400 border-green-500/30 bg-green-500/10', title: 'Tip' },
  info: { icon: Info, color: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10', title: 'Info' },
};

interface CalloutProps {
  type: string;
  children: React.ReactNode;
}

function Callout({ type, children }: CalloutProps) {
  const config = CALLOUT_CONFIG[type] || CALLOUT_CONFIG.note;
  const Icon = config.icon;

  return (
    <div className={cn('rounded-lg border-l-4 p-4 my-3', config.color)}>
      <div className="flex items-center gap-2 font-medium text-sm mb-2">
        <Icon size={16} />
        <span>{config.title}</span>
      </div>
      <div className="text-sm opacity-90">{children}</div>
    </div>
  );
}
