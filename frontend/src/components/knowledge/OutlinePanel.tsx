/**
 * 大纲导航组件
 * 自动提取 ## ### 标题生成目录，点击跳转
 */

import { useMemo } from 'react';
import { List } from 'lucide-react';
import { cn } from '@/utils';

interface OutlinePanelProps {
  content: string;
  onClick: (lineNumber: number) => void;
}

interface HeadingItem {
  level: number;
  text: string;
  line: number;
}

export function OutlinePanel({ content, onClick }: OutlinePanelProps) {
  const headings = useMemo(() => extractHeadings(content), [content]);

  if (headings.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-xs">
        无大纲
      </div>
    );
  }

  return (
    <div className="py-3">
      <div className="px-3 py-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <List size={13} />
        <span>大纲</span>
      </div>
      <div className="space-y-0.5 px-1">
        {headings.map((heading, index) => (
          <button
            key={index}
            onClick={() => onClick(heading.line)}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-muted transition-colors truncate',
              heading.level === 1 && 'font-semibold text-sm',
              heading.level === 2 && 'font-medium pl-3',
              heading.level === 3 && 'text-muted-foreground pl-5',
              heading.level >= 4 && 'text-muted-foreground/70 pl-7 text-[11px]'
            )}
            title={heading.text}
          >
            {heading.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function extractHeadings(content: string): HeadingItem[] {
  const lines = content.split('\n');
  const headings: HeadingItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 匹配 ATX 标题：# ## ### 等
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const text = match[2]
        .replace(/\*\*/g, '')  // 移除粗体
        .replace(/\*/g, '')    // 移除斜体
        .replace(/`/g, '')     // 移除代码
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // 移除链接，保留文本
        .trim();

      headings.push({
        level,
        text,
        line: i + 1,
      });
    }
  }

  return headings;
}
