/**
 * Linux 硬件测试知识库面板
 * 搜索 + 自定义添加/编辑/删除命令
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Search, Terminal, Copy, Check, ChevronRight, FolderTree, BookOpen,
  Plus, X, Pencil, Trash2, Save,
} from 'lucide-react';
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

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

const categoryColors: Record<string, string> = {
  'CPU 检测': 'text-blue-400 bg-blue-500/10',
  '内存检测': 'text-orange-400 bg-orange-500/10',
  '磁盘检测': 'text-red-400 bg-red-500/10',
  '网络检测': 'text-cyan-400 bg-cyan-500/10',
  'GPU 检测': 'text-purple-400 bg-purple-500/10',
  '温度与散热': 'text-yellow-400 bg-yellow-500/10',
  'PCI/IO 检测': 'text-indigo-400 bg-indigo-500/10',
  '整机压力': 'text-pink-400 bg-pink-500/10',
  '批量测试流程': 'text-green-400 bg-green-500/10',
};

const DEFAULT_FORM = { category: '', title: '', command: '', description: '', tags: '', solution: '' };

export function LinuxKnowledgePanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [results, setResults] = useState<KnowledgeEntry[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // 添加/编辑模式
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadCategories = useCallback(() => {
    fetch(`${API_BASE}/categories`)
      .then((r) => r.json())
      .then((d) => setCategories(d.data || []))
      .catch(console.error);
    fetch(`${API_BASE}/stats`)
      .then((r) => r.json())
      .then((d) => setTotalEntries(d.data?.total_entries || 0))
      .catch(console.error);
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

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
    } finally { setLoading(false); }
  }, [searchQuery, selectedCategory]);

  useEffect(() => { doSearch(); }, [selectedCategory, doSearch]);

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

  // 打开添加表单
  const openAdd = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  // 打开编辑表单
  const openEdit = (entry: KnowledgeEntry) => {
    setForm({
      category: entry.category,
      title: entry.title,
      command: entry.command,
      description: entry.description,
      tags: entry.tags,
      solution: entry.solution,
    });
    setEditingId(entry.id);
    setShowForm(true);
  };

  // 提交
  const handleSubmit = async () => {
    if (!form.category || !form.title || !form.command) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await fetch(`${API_BASE}/entry/${editingId}`, {
          method: 'PUT', headers: authHeaders(), body: JSON.stringify(form),
        });
      } else {
        await fetch(`${API_BASE}/entry`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      setEditingId(null);
      loadCategories();
      doSearch();
    } catch (err) { console.error(err); }
    finally { setSubmitting(false); }
  };

  // 删除
  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这条命令？')) return;
    try {
      await fetch(`${API_BASE}/entry/${id}`, { method: 'DELETE', headers: authHeaders() });
      loadCategories();
      doSearch();
      if (expandedId === id) setExpandedId(null);
    } catch (err) { console.error(err); }
  };

  // 判断登录状态
  const hasToken = !!localStorage.getItem('token');

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <Terminal size={15} className="text-primary" />
          <span className="font-medium text-sm">硬件测试命令</span>
          <span className="text-[11px] text-muted-foreground">{totalEntries} 条</span>
          <div className="flex-1" />
          {hasToken && (
            <button
              onClick={openAdd}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[11px] hover:opacity-90 transition-opacity"
            >
              <Plus size={12} /> 添加
            </button>
          )}
        </div>

        {/* 添加/编辑表单 */}
        {showForm && (
          <div className="mb-2 p-2 rounded-lg border border-primary/30 bg-muted/50 space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <input
                placeholder="分类 *" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="px-2 py-1 rounded border border-input bg-background text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
                list="category-list"
              />
              <datalist id="category-list">
                {categories.map((c) => <option key={c.category} value={c.category} />)}
              </datalist>
              <input
                placeholder="标题 *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="px-2 py-1 rounded border border-input bg-background text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <input
              placeholder="命令 *" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })}
              className="w-full px-2 py-1 rounded border border-input bg-background font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <input
              placeholder="描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-2 py-1 rounded border border-input bg-background text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <input
                placeholder="标签 (空格分隔)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className="px-2 py-1 rounded border border-input bg-background text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <input
                placeholder="解决方案" value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })}
                className="px-2 py-1 rounded border border-input bg-background text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={handleSubmit} disabled={submitting || !form.category || !form.title || !form.command}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-primary-foreground text-[11px] disabled:opacity-50"
              >
                <Save size={11} /> {submitting ? '保存中...' : editingId ? '更新' : '保存'}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-border text-[11px] hover:bg-muted"
              >
                <X size={11} /> 取消
              </button>
            </div>
          </div>
        )}

        {/* 搜索框 */}
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="搜索命令..."
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
            <div className="text-xs">输入关键词搜索命令</div>
            <div className="text-[10px] opacity-50 mt-1">如: SMART、CPU、stress、fio</div>
            {hasToken && (
              <button onClick={openAdd} className="mt-3 text-[11px] text-primary hover:underline">
                添加第一条命令
              </button>
            )}
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
                  <div className="flex items-center">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/30"
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
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded shrink-0', colorClass)}>
                        {entry.category}
                      </span>
                    </button>
                    {/* 编辑/删除按钮 */}
                    {hasToken && (
                      <div className="flex shrink-0 pr-2 gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(entry); }}
                          className="p-1 hover:bg-muted rounded transition-colors"
                          title="编辑"
                        >
                          <Pencil size={12} className="text-muted-foreground hover:text-foreground" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                          className="p-1 hover:bg-red-500/10 rounded transition-colors"
                          title="删除"
                        >
                          <Trash2 size={12} className="text-muted-foreground hover:text-red-500" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2">
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

                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                          <BookOpen size={10} /> 解决方案
                        </div>
                        <p className="text-xs text-foreground/80 leading-relaxed">{entry.solution}</p>
                      </div>

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
