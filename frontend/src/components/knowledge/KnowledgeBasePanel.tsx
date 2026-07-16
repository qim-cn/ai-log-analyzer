/**
 * 知识库面板
 * 侧边栏展示已有笔记列表、知识图谱和异常检测
 */

import { useState, useEffect } from 'react';
import { BookOpen, FileText, ChevronRight, RefreshCw, Network, Activity, Terminal } from 'lucide-react';
import { obsidianService, type NoteInfo } from '@/services/obsidianService';
import { KnowledgeGraph } from './KnowledgeGraph';
import { AnomalyDashboard } from './AnomalyDashboard';
import { LinuxKnowledgePanel } from './LinuxKnowledgePanel';
import { cn } from '@/utils';

type Tab = 'notes' | 'graph' | 'anomalies' | 'linux';

interface KnowledgeBasePanelProps {
  className?: string;
}

export function KnowledgeBasePanel({ className }: KnowledgeBasePanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('notes');
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const data = await obsidianService.listNotes();
      setNotes(data.notes);
    } catch (err) {
      console.error('获取笔记列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, []);

  const handleSelectNote = async (filename: string) => {
    setSelectedNote(filename);
    setLoadingContent(true);
    try {
      const data = await obsidianService.getNote(filename);
      setNoteContent(data.content);
    } catch (err) {
      setNoteContent('加载失败');
    } finally {
      setLoadingContent(false);
    }
  };

  return (
    <div className={cn('h-full flex flex-col bg-card', className)}>
      {/* Header with Tabs */}
      <div className="border-b border-border">
        <div className="px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={15} className="text-primary" />
            <span className="font-medium text-sm">知识库</span>
          </div>
          {activeTab === 'notes' && (
            <button
              onClick={fetchNotes}
              disabled={loading}
              className="p-1 hover:bg-muted rounded transition-colors"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
        {/* Tab Buttons */}
        <div className="flex px-3 gap-1">
          <button
            onClick={() => setActiveTab('notes')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t-md transition-colors',
              activeTab === 'notes'
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            笔记
          </button>
          <button
            onClick={() => setActiveTab('graph')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t-md transition-colors flex items-center gap-1',
              activeTab === 'graph'
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Network size={12} />
            知识图谱
          </button>
          <button
            onClick={() => setActiveTab('anomalies')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t-md transition-colors flex items-center gap-1',
              activeTab === 'anomalies'
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Activity size={12} />
            异常检测
          </button>
          <button
            onClick={() => setActiveTab('linux')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t-md transition-colors flex items-center gap-1',
              activeTab === 'linux'
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Terminal size={12} />
            Linux
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'graph' ? (
          <div className="h-full">
            <KnowledgeGraph />
          </div>
        ) : activeTab === 'anomalies' ? (
          <div className="h-full">
            <AnomalyDashboard />
          </div>
        ) : activeTab === 'linux' ? (
          <div className="h-full">
            <LinuxKnowledgePanel />
          </div>
        ) : selectedNote ? (
          <div className="h-full flex flex-col">
            <button
              onClick={() => { setSelectedNote(null); setNoteContent(null); }}
              className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground
                         hover:bg-muted transition-colors flex items-center gap-1"
            >
              ← 返回列表
            </button>
            <div className="flex-1 overflow-y-auto p-3">
              {loadingContent ? (
                <div className="text-center text-muted-foreground py-8 text-sm">加载中...</div>
              ) : (
                <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground leading-relaxed">
                  {noteContent}
                </pre>
              )}
            </div>
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">
            {loading ? '加载中...' : '暂无笔记'}
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {notes.map((note) => (
              <button
                key={note.filename}
                onClick={() => handleSelectNote(note.filename)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                           hover:bg-muted transition-colors text-left group"
              >
                <FileText size={14} className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate font-medium">{note.title}</div>
                  <div className="text-[11px] text-muted-foreground/60">{note.date}</div>
                </div>
                <ChevronRight size={13} className="text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
