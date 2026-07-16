/**
 * 知识库页面
 * 三栏布局：文件树 | 笔记内容 | 大纲
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Search,
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { obsidianService, type FileTreeNode } from '@/services/obsidianService';
import { MarkdownRenderer } from '@/components/knowledge/MarkdownRenderer';
import { OutlinePanel } from '@/components/knowledge/OutlinePanel';
import { LinuxKnowledgePanel } from '@/components/knowledge/LinuxKnowledgePanel';
import { cn } from '@/utils';

interface KnowledgePageProps {
  onBack: () => void;
  initialPath?: string;
}

export function KnowledgePage({ onBack, initialPath }: KnowledgePageProps) {
  const [activeView, setActiveView] = useState<'obsidian' | 'linux'>('obsidian');
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialPath || null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ path: string; title: string; snippet: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // 获取文件树
  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await obsidianService.getFileTree();
      setTree(data.tree);
    } catch (err) {
      console.error('获取文件树失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // 获取文件内容
  const fetchContent = useCallback(async (path: string) => {
    setLoadingContent(true);
    try {
      const data = await obsidianService.getFileContent(path);
      setFileContent(data.content);
    } catch (err) {
      setFileContent('加载失败');
    } finally {
      setLoadingContent(false);
    }
  }, []);

  // 点击文件
  const handleFileClick = useCallback(
    (path: string) => {
      setSelectedPath(path);
      fetchContent(path);
    },
    [fetchContent]
  );

  // 搜索
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const data = await obsidianService.search(searchQuery);
      setSearchResults(data.results);
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  // 大纲跳转
  const handleOutlineClick = useCallback((lineNumber: number) => {
    const element = document.getElementById(`line-${lineNumber}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="h-12 border-b border-border bg-card flex items-center px-4 gap-3">
        <button
          onClick={onBack}
          className="p-1.5 hover:bg-muted rounded-lg transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="font-semibold text-sm">知识库</div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setActiveView('obsidian')}
            className={cn(
              'px-3 py-1 rounded-md text-xs transition-colors',
              activeView === 'obsidian'
                ? 'bg-background text-foreground shadow-sm font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Obsidian
          </button>
          <button
            onClick={() => setActiveView('linux')}
            className={cn(
              'px-3 py-1 rounded-md text-xs transition-colors flex items-center gap-1',
              activeView === 'linux'
                ? 'bg-background text-foreground shadow-sm font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Terminal size={12} />
            Linux
          </button>
        </div>

        <div className="flex-1" />
        {activeView === 'obsidian' && (
          <button
            onClick={fetchTree}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw size={15} />
          </button>
        )}
      </div>

      {activeView === 'linux' ? (
        <div className="flex-1 overflow-hidden">
          <LinuxKnowledgePanel />
        </div>
      ) : (
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：文件树 */}
        <aside className="w-64 border-r border-border flex flex-col bg-card">
          {/* 搜索框 */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索笔记..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-input bg-background text-xs
                           focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* 文件列表 */}
          <div className="flex-1 overflow-y-auto p-2">
            {isSearching ? (
              <div className="text-center text-muted-foreground py-4 text-xs">搜索中...</div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-0.5">
                {searchResults.map((result) => (
                  <button
                    key={result.path}
                    onClick={() => {
                      handleFileClick(result.path);
                      setSearchResults([]);
                      setSearchQuery('');
                    }}
                    className="w-full flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-muted text-left"
                  >
                    <FileText size={14} className="text-muted-foreground shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{result.title}</div>
                      <div className="text-[10px] text-muted-foreground/60 truncate mt-0.5">
                        {result.snippet}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : loading ? (
              <div className="text-center text-muted-foreground py-4 text-xs">加载中...</div>
            ) : (
              <FileTree
                nodes={tree}
                selectedPath={selectedPath}
                onFileClick={handleFileClick}
              />
            )}
          </div>
        </aside>

        {/* 中间：笔记内容 */}
        <main className="flex-1 overflow-y-auto">
          {loadingContent ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              加载中...
            </div>
          ) : fileContent ? (
            <div className="max-w-[800px] mx-auto px-8 py-6">
              <MarkdownRenderer content={fileContent} onLinkClick={handleFileClick} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <FileText size={48} className="mx-auto mb-4 opacity-20" />
                <div className="text-sm">选择左侧文件查看内容</div>
              </div>
            </div>
          )}
        </main>

        {/* 右侧：大纲 */}
        {fileContent && (
          <aside className="w-56 border-l border-border bg-card overflow-y-auto">
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
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onFileClick={onFileClick}
          level={level}
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

function FileTreeNodeComponent({
  node,
  selectedPath,
  onFileClick,
  level,
}: FileTreeNodeComponentProps) {
  const [expanded, setExpanded] = useState(level < 2);

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg
                     hover:bg-muted transition-colors text-left"
          style={{ paddingLeft: `${level * 12 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown size={12} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="text-muted-foreground" />
          )}
          {expanded ? (
            <FolderOpen size={14} className="text-primary" />
          ) : (
            <Folder size={14} className="text-primary" />
          )}
          <span className="text-xs font-medium truncate">{node.name}</span>
        </button>
        {expanded && node.children && (
          <FileTree
            nodes={node.children}
            selectedPath={selectedPath}
            onFileClick={onFileClick}
            level={level + 1}
          />
        )}
      </div>
    );
  }

  // 文件
  const isSelected = selectedPath === node.path;
  return (
    <button
      onClick={() => onFileClick(node.path)}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors text-left',
        isSelected
          ? 'bg-primary/10 text-primary border border-primary/20'
          : 'hover:bg-muted'
      )}
      style={{ paddingLeft: `${level * 12 + 24}px` }}
    >
      <FileText size={13} className={isSelected ? 'text-primary' : 'text-muted-foreground'} />
      <span className="text-xs truncate">{node.name}</span>
    </button>
  );
}
