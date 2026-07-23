/**
 * 知识库页面
 * 三栏布局：文件树 | 笔记内容 | 大纲
 * Tab: Obsidian | 已解决 | Linux
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Search, FileText, Folder, FolderOpen, ChevronRight, ChevronDown,
  RefreshCw, Terminal, CheckCircle2, Trash2, BookOpen, Loader2, ClipboardList,
} from 'lucide-react';
import { obsidianService, type FileTreeNode, type ResolvedFile } from '@/services/obsidianService';
import { MarkdownRenderer } from '@/components/knowledge/MarkdownRenderer';
import { OutlinePanel } from '@/components/knowledge/OutlinePanel';
import { LinuxKnowledgePanel } from '@/components/knowledge/LinuxKnowledgePanel';
import { useInvestigationStore } from '@/stores/investigationStore';
import { cn } from '@/utils';

interface KnowledgePageProps {
  onBack: () => void;
  initialPath?: string;
}

export function KnowledgePage({ onBack, initialPath }: KnowledgePageProps) {
  const [activeView, setActiveView] = useState<'obsidian' | 'resolved' | 'linux'>('resolved');
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialPath || null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ path: string; title: string; snippet: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sopOpen, setSopOpen] = useState(false);
  const [sopModel, setSopModel] = useState('');
  const [sopFault, setSopFault] = useState('');
  const startSOP = useInvestigationStore((s) => s.startSOP);

  // 已解决列表
  const [resolvedFiles, setResolvedFiles] = useState<ResolvedFile[]>([]);
  const [resolvedLoading, setResolvedLoading] = useState(false);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      // 读配置：只加载设置中选中的浏览目录
      const cfg = await obsidianService.getBrowsePaths();
      const paths: string[] = cfg.browse_paths || [];
      if (paths.length > 0) {
        const trees = await Promise.all(paths.map(p => obsidianService.getFileTree(p)));
        const combined: FileTreeNode[] = [];
        trees.forEach((t, i) => {
          const dirName = paths[i] || '(根目录)';
          const items = (t.tree || []).filter((n: FileTreeNode) =>
            n.type === 'folder' || /\.(md|canvas|txt|ppt|pptx|pdf|json|log|csv|sh|py|yaml|yml|conf)$/i.test(n.name));
          if (items.length > 0) {
            combined.push({ name: dirName, path: paths[i], type: 'folder', children: items });
          }
        });
        setTree(combined);
      } else {
        // 没有选择 → 加载根目录
        const d = await obsidianService.getFileTree();
        setTree(d.tree || []);
      }
    } catch (err) { console.error('获取文件树失败:', err); }
    finally { setLoading(false); }
  }, []);

  const fetchResolved = useCallback(async () => {
    setResolvedLoading(true);
    try {
      const d = await obsidianService.listResolved();
      setResolvedFiles(d || []);
    } catch (err) { console.error(err); }
    finally { setResolvedLoading(false); }
  }, []);

  useEffect(() => { fetchTree(); fetchResolved(); }, [fetchTree, fetchResolved, activeView]);

  const fetchContent = useCallback(async (path: string) => {
    setLoadingContent(true);
    try {
      const d = await obsidianService.getFileContent(path);
      setFileContent(d.content || '');
    } catch (err) { setFileContent('加载失败'); }
    finally { setLoadingContent(false); }
  }, []);

  const fetchResolvedContent = useCallback(async (filename: string) => {
    setLoadingContent(true);
    try {
      const d = await obsidianService.getResolvedFile(filename);
      setFileContent(d.content || '空文件');
      setSelectedPath(filename);
    } catch (err) { setFileContent('加载失败'); }
    finally { setLoadingContent(false); }
  }, []);

  const handleFileClick = useCallback((path: string) => {
    setSelectedPath(path);
    fetchContent(path);
  }, [fetchContent]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const data = await obsidianService.search(searchQuery);
      setSearchResults(data.results);
    } catch (err) { console.error('搜索失败:', err); }
    finally { setIsSearching(false); }
  }, [searchQuery]);

  const handleOutlineClick = useCallback((lineNumber: number) => {
    const element = document.getElementById(`line-${lineNumber}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // 点击标签：触发搜索（已解决搜索列表 / Obsidian 搜索笔记）
  // 点击标签：跳转到 Obsidian 搜索相关笔记
  const handleTagClick = useCallback(async (tag: string) => {
    setActiveView('obsidian');
    setSearchQuery(tag);
    setIsSearching(true);
    try {
      const data = await obsidianService.search(tag);
      setSearchResults(data.results);
    } catch (err) { console.error('搜索失败:', err); }
    finally { setIsSearching(false); }
  }, []);

  const isAdmin = localStorage.getItem('user') ? (() => { try { return JSON.parse(localStorage.getItem('user') || '{}').role === 'admin'; } catch { return false; } })() : false;

  const handleDeleteResolved = async (filename: string) => {
    if (!confirm('确定删除这条已解决记录？')) return;
    try {
      await obsidianService.deleteResolvedFile(filename);
      fetchResolved();
      if (selectedPath === filename) { setSelectedPath(null); setFileContent(null); }
    } catch (err) { alert('删除失败'); }
  };

  const refreshAll = () => { fetchTree(); fetchResolved(); };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="h-12 border-b border-border bg-card flex items-center px-4 gap-3 shrink-0">
        <button onClick={onBack} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="font-semibold text-sm">知识库</div>

        {/* View Tabs —— 统一图标 */}
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
          <button onClick={() => setActiveView('resolved')} className={cn(
            'px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5',
            activeView === 'resolved' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}>
            <CheckCircle2 size={12} className="text-emerald-500" /> 已解决
          </button>
          <button onClick={() => setActiveView('obsidian')} className={cn(
            'px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5',
            activeView === 'obsidian' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}>
            <BookOpen size={12} /> Obsidian
          </button>
          <button onClick={() => setActiveView('linux')} className={cn(
            'px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5',
            activeView === 'linux' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}>
            <Terminal size={12} /> Linux
          </button>
        </div>

        <div className="flex-1" />
        <button
          onClick={() => setSopOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <ClipboardList size={13} /> 生成 SOP
        </button>
        <button onClick={refreshAll} className="p-1.5 hover:bg-muted rounded-lg transition-colors" title="刷新">
          <RefreshCw size={15} className="text-muted-foreground" />
        </button>
      </div>

      {/* SOP 生成弹窗 */}
      {sopOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSopOpen(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-lg w-full max-w-md mx-4 p-5 space-y-4">
            <h3 className="font-semibold text-sm">生成维修 SOP</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">机型</label>
                <input value={sopModel} onChange={e => setSopModel(e.target.value)}
                  placeholder="如 7500S" list="model-suggestions"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">故障描述</label>
                <input value={sopFault} onChange={e => setSopFault(e.target.value)}
                  placeholder="如 内存ECC"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setSopOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80">取消</button>
              <button
                onClick={() => {
                  if (sopModel.trim() && sopFault.trim()) {
                    startSOP(sopModel.trim(), sopFault.trim(), '');
                    setSopOpen(false);
                  }
                }}
                disabled={!sopModel.trim() || !sopFault.trim()}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Linux 面板全屏 */}
      {activeView === 'linux' && (
        <div className="flex-1 overflow-hidden">
          <LinuxKnowledgePanel />
        </div>
      )}

      {/* 已解决面板 */}
      {activeView === 'resolved' && (
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-64 border-r border-border flex flex-col bg-card/60">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <CheckCircle2 size={13} className="text-emerald-500" />
                已解决故障
              </div>
              <div className="text-[11px] text-muted-foreground/50 mt-0.5">共 {resolvedFiles.length} 条记录</div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {resolvedLoading ? (
                <div className="flex items-center justify-center py-12 text-xs text-muted-foreground/50">加载中…</div>
              ) : resolvedFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle2 size={28} className="text-muted-foreground/15 mb-2" />
                  <div className="text-xs text-muted-foreground/50">暂无已解决记录</div>
                  <div className="text-[10px] text-muted-foreground/30 mt-0.5">在聊天中将案例保存到知识库</div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {resolvedFiles.map((f) => (
                    <div key={f.filename} className="group flex items-center">
                      <button
                        onClick={() => fetchResolvedContent(f.filename)}
                        className={cn(
                          'flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all',
                          selectedPath === f.filename
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'hover:bg-muted/60'
                        )}
                      >
                        <FileText size={13} className={cn('shrink-0', selectedPath === f.filename ? 'text-emerald-500' : 'text-muted-foreground/60')} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] truncate font-medium">{f.title}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {f.model ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">{f.model}</span>
                            ) : <span className="text-[10px] text-muted-foreground/40 italic">无型号</span>}
                          </div>
                        </div>
                      </button>
                      {isAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteResolved(f.filename); }}
                          className="p-1 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all shrink-0 ml-0.5"
                          title="删除"
                        >
                          <Trash2 size={12} className="text-muted-foreground/40 hover:text-destructive transition-colors" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
          <main className="flex-1 overflow-y-auto bg-background">
            {loadingContent ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-xs">加载中…</span>
                </div>
              </div>
            ) : fileContent && selectedPath ? (
              <div className="max-w-[800px] mx-auto px-8 py-6">
                <MarkdownRenderer content={fileContent} onLinkClick={handleFileClick} onTagClick={handleTagClick} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 size={26} className="text-emerald-500/40" />
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">选择左侧已解决记录</div>
                  <div className="text-xs text-muted-foreground/40 mt-1">查看详细故障排查过程</div>
                </div>
              </div>
            )}
          </main>
          {fileContent && selectedPath && (
            <aside className="w-56 border-l border-border bg-card/60 overflow-y-auto">
              <OutlinePanel content={fileContent} onClick={handleOutlineClick} />
            </aside>
          )}
        </div>
      )}

      {/* Obsidian 面板 */}
      {activeView === 'obsidian' && (
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 border-r border-border flex flex-col bg-card/60">
          <div className="px-3 py-2.5 border-b border-border space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <BookOpen size={13} /> 文件浏览
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索笔记…"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-input bg-background text-xs
                           focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {isSearching ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground/50"><Loader2 size={14} className="animate-spin mr-1.5" />搜索中…</div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] text-muted-foreground/50 uppercase tracking-wider">搜索结果 · {searchResults.length} 条</div>
                {searchResults.map((result) => (
                  <button
                    key={result.path}
                    onClick={() => { handleFileClick(result.path); setSearchResults([]); setSearchQuery(''); }}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/60 text-left transition-colors"
                  >
                    <FileText size={13} className="text-muted-foreground/60 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium truncate">{result.title}</div>
                      <div className="text-[10px] text-muted-foreground/50 truncate mt-0.5 leading-relaxed">{result.snippet}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground/50"><Loader2 size={14} className="animate-spin mr-1.5" />加载中…</div>
            ) : (
              <FileTree nodes={tree} selectedPath={selectedPath} onFileClick={handleFileClick} />
            )}
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto bg-background">
          {loadingContent ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-xs">加载中…</span>
              </div>
            </div>
          ) : fileContent ? (
            <div className="max-w-[800px] mx-auto px-8 py-6">
              <MarkdownRenderer content={fileContent} onLinkClick={handleFileClick} onTagClick={handleTagClick} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <BookOpen size={26} className="text-primary/40" />
                </div>
                <div className="text-sm font-medium text-muted-foreground">选择左侧文件查看内容</div>
                <div className="text-xs text-muted-foreground/40 mt-1">浏览 Obsidian 知识库中的笔记</div>
              </div>
            </div>
          )}
        </main>
        {fileContent && (
          <aside className="w-56 border-l border-border bg-card/60 overflow-y-auto">
            <OutlinePanel content={fileContent} onClick={handleOutlineClick} />
          </aside>
        )}
      </div>
      )}
    </div>
  );
}

// ============================================================
// 文件树组件
// ============================================================

interface FileTreeProps {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  onFileClick: (path: string) => void;
  level?: number;
}

function FileTree({ nodes, selectedPath, onFileClick, level = 0 }: FileTreeProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <FileTreeNodeComponent
          key={node.path} node={node} selectedPath={selectedPath}
          onFileClick={onFileClick} level={level}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeComponentProps {
  node: FileTreeNode;
  selectedPath: string | null;
  onFileClick: (path: string) => void;
  level: number;
}

function FileTreeNodeComponent({ node, selectedPath, onFileClick, level }: FileTreeNodeComponentProps) {
  const [expanded, setExpanded] = useState(level < 2);

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors text-left"
          style={{ paddingLeft: `${level * 12 + 8}px` }}
        >
          {expanded ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
          {expanded ? <FolderOpen size={14} className="text-primary" /> : <Folder size={14} className="text-primary" />}
          <span className="text-xs font-medium truncate">{node.name}</span>
        </button>
        {expanded && node.children && (
          <FileTree nodes={node.children} selectedPath={selectedPath} onFileClick={onFileClick} level={level + 1} />
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  return (
    <button
      onClick={() => onFileClick(node.path)}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors text-left',
        isSelected ? 'bg-primary/10 text-primary border border-primary/20' : 'hover:bg-muted'
      )}
      style={{ paddingLeft: `${level * 12 + 24}px` }}
    >
      <FileText size={13} className={isSelected ? 'text-primary' : 'text-muted-foreground'} />
      <span className="text-xs truncate">{node.name}</span>
    </button>
  );
}
