/**
 * 大纲导航组件
 * 提取 ## ### 标题生成目录，点击跳转到对应标题元素
 */

import { useMemo } from 'react';
import { List } from 'lucide-react';
import { cn } from '@/utils';

interface OutlinePanelProps {
  content: string;
  onClick?: (lineNumber: number) => void;
}

interface HeadingItem {
  level: number;
  text: string;
}

export function OutlinePanel({ content }: OutlinePanelProps) {
  const headings = useMemo(() => extractHeadings(content), [content]);

  if (headings.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-xs">
        无大纲
      </div>
    );
  }

  const scrollTo = (text: string) => {
    const id = `heading-${text.slice(0, 40).replace(/[^a-zA-Z0-9一-鿿]/g, '-')}`;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
            onClick={() => scrollTo(heading.text)}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-muted transition-colors truncate',
              heading.level === 1 && 'font-semibold text-sm',
              heading.level === 2 && 'font-medium pl-4',
              heading.level === 3 && 'text-muted-foreground pl-6',
              heading.level >= 4 && 'text-muted-foreground/70 pl-8 text-[11px]'
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
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      const text = match[2]
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/`/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      headings.push({ level: match[1].length, text });
    }
  }

  return headings;
}
