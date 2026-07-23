/**
 * Markdown 渲染器
 * 支持标准 Markdown + Obsidian 扩展语法
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Lightbulb, Tag, Folder, Calendar, Hash, FileText, ArrowUpRight } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';
import { cn } from '@/utils';

interface MarkdownRendererProps {
  content: string;
  onLinkClick?: (path: string) => void;
}

/** 安全提取 React children 的纯文本 */
function reactNodeToText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return reactNodeToText((node as any).props.children);
  }
  return '';
}

export function MarkdownRenderer({ content, onLinkClick }: MarkdownRendererProps) {
  // 解析 Obsidian frontmatter
  const { frontmatter, body } = useMemo(() => parseFrontmatter(content), [content]);

  // 预处理：Obsidian 扩展语法
  const processed = preprocessObsidian(body);

  return (
    <div>
      {/* Frontmatter 属性卡片 */}
      <FrontmatterCard frontmatter={frontmatter} />

      <div className="prose prose-sm dark:prose-invert max-w-none select-text
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
          // 标题加上 id，配合大纲面板跳转
          h1: ({ children, ...props }) => {
            const text = reactNodeToText(children).replace(/[^a-zA-Z0-9一-鿿]/g, '-').slice(0, 50);
            return <h1 id={`heading-${text}`} className="scroll-mt-20" {...props}>{children}</h1>;
          },
          h2: ({ children, ...props }) => {
            const text = reactNodeToText(children).replace(/[^a-zA-Z0-9一-鿿]/g, '-').slice(0, 50);
            return <h2 id={`heading-${text}`} className="scroll-mt-20" {...props}>{children}</h2>;
          },
          h3: ({ children, ...props }) => {
            const text = reactNodeToText(children).replace(/[^a-zA-Z0-9一-鿿]/g, '-').slice(0, 50);
            return <h3 id={`heading-${text}`} className="scroll-mt-20" {...props}>{children}</h3>;
          },
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
            // ==高亮== 占位 -> 渲染成 <mark>（可选中复制）
            if (href === '#cmdhl') {
              return <mark className="bg-yellow-500/20 text-yellow-300 px-1 rounded">{children}</mark>;
            }
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
    </div>
  );
}

// ============================================================
// 预处理 Obsidian 语法
// ============================================================

function preprocessObsidian(content: string): string {
  let processed = content;

  // ==高亮文本== → <mark>高亮文本</mark>
  // ==高亮文本== -> markdown 链接占位，由 a 组件渲染成 <mark>（可选中复制；
  // 不再用原生 <mark> HTML，避免 react-markdown 转义成字面标签）
  processed = processed.replace(/==([^=\n]+)==/g, '[$1](#cmdhl)');

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
    <div className={cn('rounded-lg border-l-4 p-3 my-3', config.color)}>
      <div className="flex items-center gap-2 font-medium text-sm mb-2">
        <Icon size={16} />
        <span>{config.title}</span>
      </div>
      <div className="text-sm opacity-90">{children}</div>
    </div>
  );
}

// ============================================================
// Obsidian 风格 Frontmatter 解析 + 渲染
// ============================================================

interface Frontmatter {
  title?: string;
  category?: string;
  tags?: string[];
  type?: string;
  created?: string;
  updated?: string;
  status?: string;
  related?: string[];
  [key: string]: unknown;
}

/** 解析 YAML frontmatter（轻量实现，不依赖外部库） */
function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yaml = match[1];
  const body = match[2] || '';
  const fm: Frontmatter = {};

  // 简易 YAML 解析
  const lines = yaml.split('\n');
  let currentKey = '';
  let inArray = false;
  let inRelated = false;

  for (const line of lines) {
    // 跳过空行
    if (!line.trim()) continue;

    // 数组中的行
    if (inArray) {
      if (line.trim().startsWith('- ')) {
        const val = line.trim().slice(2).trim();
        const arr = (fm[currentKey] as string[]) || [];
        arr.push(val);
        fm[currentKey] = arr;
        continue;
      } else {
        inArray = false;
      }
    }

    // 嵌套对象（related 字段）
    if (inRelated) {
      if (line.trim().startsWith('- ')) {
        const val = line.trim().slice(2).replace(/^"|"$/g, '');
        const arr = fm[currentKey] as string[] || [];
        arr.push(val);
        fm[currentKey] = arr;
        continue;
      } else {
        inRelated = false;
      }
    }

    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();

      // 嵌套对象标记
      if (val === '' && currentKey === 'related') {
        inRelated = true;
        fm[currentKey] = [];
        continue;
      }

      // 数组
      if (val.startsWith('[') && val.endsWith(']')) {
        fm[currentKey] = val.slice(1, -1).split(',').map(s =>
          s.trim().replace(/^"|"$/g, '')
        );
        inArray = false;
        continue;
      }

      // 空值 → 可能下面有数组
      if (val === '') {
        inArray = true;
        continue;
      }

      // 普通值
      fm[currentKey] = val.replace(/^"|"$/g, '');
      inArray = false;
    }
  }

  return { frontmatter: fm, body };
}

/** Obsidian 风格属性卡片 */
function FrontmatterCard({ frontmatter }: { frontmatter: Frontmatter }) {
  const hasContent = Object.keys(frontmatter).filter(k => frontmatter[k as keyof Frontmatter] != null && frontmatter[k as keyof Frontmatter] !== '').length > 0;
  if (!hasContent) return null;

  const { title, category, tags, type, created, updated, status } = frontmatter;

  return (
    <div className="mb-6 rounded-xl border border-border bg-card overflow-hidden">
      {/* 标题行 */}
      {title && (
        <div className="px-5 py-3 border-b border-border/50">
          <h1 className="text-lg font-bold text-foreground m-0">{title}</h1>
        </div>
      )}

      {/* 属性列表 */}
      <div className="px-5 py-3 grid grid-cols-2 gap-x-6 gap-y-2.5">
        {category && (
          <div className="flex items-center gap-2">
            <Folder size={13} className="text-primary/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground min-w-[48px]">分类</span>
            <span className="text-xs text-foreground font-medium truncate">{category}</span>
          </div>
        )}

        {type && (
          <div className="flex items-center gap-2">
            <FileText size={13} className="text-primary/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground min-w-[48px]">类型</span>
            <span className="text-xs text-foreground font-medium">{type}</span>
          </div>
        )}

        {status && (
          <div className="flex items-center gap-2">
            <Hash size={13} className="text-primary/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground min-w-[48px]">状态</span>
            <span className={cn(
              'text-xs font-medium px-1.5 py-0.5 rounded',
              status === 'active' ? 'bg-emerald-500/10 text-emerald-600' :
              status === 'draft' ? 'bg-amber-500/10 text-amber-600' :
              'bg-muted text-muted-foreground'
            )}>{status}</span>
          </div>
        )}

        {created && (
          <div className="flex items-center gap-2">
            <Calendar size={13} className="text-primary/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground min-w-[48px]">创建</span>
            <span className="text-xs text-foreground">{created}</span>
          </div>
        )}

        {updated && updated !== created && (
          <div className="flex items-center gap-2">
            <ArrowUpRight size={13} className="text-primary/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground min-w-[48px]">更新</span>
            <span className="text-xs text-foreground">{updated}</span>
          </div>
        )}
      </div>

      {/* Tags */}
      {tags && tags.length > 0 && (
        <div className="px-5 py-2.5 border-t border-border/50 flex items-center gap-2 flex-wrap">
          <Tag size={12} className="text-primary/50 shrink-0" />
          {tags.map(tag => (
            <span
              key={tag}
              className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
