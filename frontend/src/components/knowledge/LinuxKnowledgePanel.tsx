/**
 * Linux 故障排查知识库面板
 * 搜索内置的 88 条 Linux 命令知识
 */

import { useState, useEffect, useCallback } from 'react';
import { Search, Terminal, Copy, Check, ChevronRight, FolderTree, BookOpen } from 'lucide-react';
import { cn } from '@/utils';

interface KnowledgeEntry {
  id: number;
  category: string;
  title: string;
  command: string;
  description: string;
  tags: string;
  solution: string;
}

interface CategoryCount {
  category: string;
  count: number;
}

const API_BASE = '/api/knowledge/linux';

export function LinuxKnowledgePanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [results, setResults] = useState<KnowledgeEntry[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // 加载分类列表
  useEffect(() => {
    fetch(`${API_BASE}/categories`)
      .then((r) => r.json())
      .then((d) => setCategories(d.data || []))
      .catch(console.error);
    fetch(`${API_BASE}/stats`)
      .then((r) => r.json())
      .then((d) => setTotalEntries(d.data?.total_entries || 0))
      .catch(console.error);
  }, []);

  // 搜索
  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (selectedCategory) params.set('category', selectedCategory);
      params.set('limit', '50');
      const r = await fetch(`${API_BASE}/search?${params}`);
      const d = await r.json();
      setResults(d.data?.results || []);
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedCategory]);

  // 选分类自动搜索
  useEffect(() => {
    doSearch();
  }, [selectedCategory, doSearch]);

  const handleCopy = (command: string, id: number) => {
    navigator.clipboard.writeText(command).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleCategoryClick = (cat: string) => {
    setSelectedCategory(selectedCategory === cat ? '' : cat);
    setExpandedId(null);
  };

  // 颜色映射
  const categoryColors: Record<string, string> = {
    '系统信息': 'text-blue-400 bg-blue-500/10',
    '磁盘故障': 'text-red-400 bg-red-500/10',
    '内存故障': 'text-orange-400 bg-orange-500/10',
    'CPU 故障': 'text-yellow-400 bg-yellow-500/10',
    '网络故障': 'text-cyan-400 bg-cyan-500/10',
    '进程故障': 'text-purple-400 bg-purple-500/10',
    '日志排查': 'text-green-400 bg-green-500/10',
    '服务管理': 'text-emerald-400 bg-emerald-500/10',
    'Docker 故障': 'text-sky-400 bg-sky-500/10',
    '性能调优': 'text-pink-400 bg-pink-500/10',
    '安全排查': 'text-red-400 bg-red-500/10',
    '内核与驱动': 'text-indigo-400 bg-indigo-500/10',
    '备份恢复': 'text-amber-400 bg-amber-500/10',
    '包管理': 'text-teal-400 bg-teal-500/10',
    '快捷排查流程': 'text-violet-400 bg-violet-500/10',
  };

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <Terminal size={15} className="text-primary" />
          <span className="font-medium text-sm">Linux 故障排查</span>
          <span className="text-[11px] text-muted-foreground">{totalEntries} 条命令</span>
        </div>

        {/* 搜索框 */}
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); }}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="搜索命令、错误类型..."
            className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-input bg-background text-xs
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* 分类筛选 */}
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {categories.map((cat) => (
            <button
              key={cat.category}
              onClick={() => handleCategoryClick(cat.category)}
              className={cn(
                'px-2 py-0.5 rounded-md text-[10px] transition-colors flex items-center gap-1',
                selectedCategory === cat.category
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/70 text-muted-foreground'
              )}
            >
              <FolderTree size={10} />
              {cat.category}
              <span className="opacity-60">({cat.count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* 结果列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center text-muted-foreground py-8 text-xs">搜索中...</div>
        ) : results.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Terminal size={36} className="mx-auto mb-3 opacity-20" />
            <div className="text-xs">输入关键词搜索 Linux 命令</div>
            <div className="text-[10px] opacity-50 mt-1">如: OOM、磁盘、502、docker</div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {results.map((entry) => {
              const colorClass = categoryColors[entry.category] || 'text-muted-foreground bg-muted';
              const isExpanded = expandedId === entry.id;
              return (
                <div
                  key={entry.id}
                  className="rounded-xl border border-border/50 overflow-hidden hover:border-border transition-colors"
                >
                  {/* 标题行 */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/30"
                  >
                    <ChevronRight
                      size={13}
                      className={cn(
                        'text-muted-foreground shrink-0 transition-transform',
                        isExpanded && 'rotate-90'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{entry.title}</div>
                      <div className="text-[10px] text-muted-foreground/60 truncate mt-0.5">{entry.description}</div>
                    </div>
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded', colorClass)}>
                      {entry.category}
                    </span>
                  </button>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2">
                      {/* 命令 */}
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                          <Terminal size={10} /> 命令
                        </div>
                        <div className="flex items-center gap-2 bg-black dark:bg-zinc-900 rounded-lg px-3 py-2 font-mono text-xs text-green-400 relative group">
                          <code className="flex-1 break-all">{entry.command}</code>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopy(entry.command, entry.id); }}
                            className="p-1 hover:bg-white/10 rounded transition-colors shrink-0"
                          >
                            {copiedId === entry.id ? (
                              <Check size={13} className="text-green-400" />
                            ) : (
                              <Copy size={13} className="text-white/40 hover:text-white/80" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* 解决方案 */}
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                          <BookOpen size={10} /> 解决方案
                        </div>
                        <p className="text-xs text-foreground/80 leading-relaxed">{entry.solution}</p>
                      </div>

                      {/* 标签 */}
                      {entry.tags && (
                        <div className="flex flex-wrap gap-1">
                          {entry.tags.split(' ').map((tag) => (
                            <span
                              key={tag}
                              className="text-[9px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
