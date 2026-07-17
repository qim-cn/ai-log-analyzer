/**
 * 日志内容查看器
 *
 * 功能：
 * - 行号显示
 * - 点击行引用到输入框
 * - 右键"分析选中日志"
 * - 级别筛选（ERROR/WARN/INFO）
 * - 正则搜索
 * - 时间范围筛选
 */

import { useMemo, useState, useCallback, useRef } from 'react';
import { X, Search, Filter } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/utils';

interface LogViewerProps {
  content: string;
  filename: string;
  onClose: () => void;
  onLineClick?: (lineNumber: number, lineContent: string) => void;
  onAnalyzeSelection?: (selectedText: string) => void;
}

export function LogViewer({
  content,
  filename,
  onClose,
  onLineClick,
  onAnalyzeSelection,
}: LogViewerProps) {
  const lines = useMemo(() => content.split('\n'), [content]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRegex, setSearchRegex] = useState(false);

  // 过滤行
  const filteredLines = useMemo(() => {
    return lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => {
        // 级别筛选
        if (levelFilter !== 'all') {
          const level = detectLogLevel(line);
          if (level !== levelFilter) return false;
        }
        // 搜索筛选
        if (searchQuery) {
          if (searchRegex) {
            try {
              const regex = new RegExp(searchQuery, 'i');
              if (!regex.test(line)) return false;
            } catch {
              return false;
            }
          } else {
            if (!line.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          }
        }
        return true;
      });
  }, [lines, levelFilter, searchQuery, searchRegex]);

  // 虚拟化：只渲染可视区内的行，避免大日志（数万行）一次性渲染导致卡死/崩溃
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 12,
  });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      setContextMenu({ x: e.clientX, y: e.clientY, text: selection });
    }
  }, []);

  const handleAnalyze = useCallback(() => {
    if (contextMenu?.text && onAnalyzeSelection) {
      onAnalyzeSelection(contextMenu.text);
    }
    setContextMenu(null);
  }, [contextMenu, onAnalyzeSelection]);

  const handleCopy = useCallback(() => {
    if (contextMenu?.text) {
      navigator.clipboard.writeText(contextMenu.text);
    }
    setContextMenu(null);
  }, [contextMenu]);

  return (
    <div className="h-full flex flex-col" onClick={() => setContextMenu(null)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="text-sm font-medium truncate">{filename}</div>
        <button onClick={onClose} className="p-1 hover:bg-muted rounded transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* 工具栏 */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap">
        {/* 级别筛选 */}
        <div className="flex items-center gap-1">
          <Filter size={12} className="text-muted-foreground" />
          {['all', 'error', 'warn', 'info'].map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                levelFilter === level
                  ? level === 'error' ? 'bg-red-500/20 text-red-400'
                    : level === 'warn' ? 'bg-yellow-500/20 text-yellow-400'
                    : level === 'info' ? 'bg-green-500/20 text-green-400'
                    : 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {level === 'all' ? '全部' : level.toUpperCase()}
            </button>
          ))}
        </div>

        {/* 搜索 */}
        <div className="flex-1 flex items-center gap-1">
          <Search size={12} className="text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索日志..."
            className="flex-1 px-2 py-0.5 rounded border border-input bg-background text-xs
                       focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <button
            onClick={() => setSearchRegex(!searchRegex)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-mono',
              searchRegex ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
            )}
          >
            .*
          </button>
        </div>

        {/* 统计 */}
        <span className="text-[10px] text-muted-foreground">
          {filteredLines.length}/{lines.length} 行
        </span>
      </div>

      {/* 内容 */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto p-2 font-mono text-xs leading-5"
        onContextMenu={handleContextMenu}
      >
        {filteredLines.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">无匹配内容</div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const { line, index } = filteredLines[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <LogLine
                    line={line}
                    lineNumber={index + 1}
                    onClick={onLineClick}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* 右键菜单 */}
        {contextMenu && (
          <div
            className="fixed z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleAnalyze}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
            >
              <Search size={14} />
              <span>分析选中日志</span>
            </button>
            <button
              onClick={handleCopy}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
            >
              <span>复制</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface LogLineProps {
  line: string;
  lineNumber: number;
  onClick?: (lineNumber: number, lineContent: string) => void;
}

function LogLine({ line, lineNumber, onClick }: LogLineProps) {
  const level = detectLogLevel(line);

  return (
    <div
      onClick={() => onClick?.(lineNumber, line)}
      className={cn(
        'flex hover:bg-accent/50 cursor-pointer',
        level === 'error' && 'log-error',
        level === 'warn' && 'log-warn',
        level === 'info' && 'log-info'
      )}
    >
      <span className="w-12 shrink-0 text-right pr-2 text-muted-foreground/50 select-none">
        {lineNumber}
      </span>
      <span className="whitespace-pre-wrap break-all">{line}</span>
    </div>
  );
}

function detectLogLevel(line: string): string | null {
  const upper = line.toUpperCase();
  if (/\b(ERROR|FATAL|CRITICAL|EXCEPTION|PANIC|FAIL)\b/.test(upper)) return 'error';
  if (/\b(WARN|WARNING|ALERT)\b/.test(upper)) return 'warn';
  if (/\b(INFO|DEBUG|TRACE)\b/.test(upper)) return 'info';
  return null;
}
