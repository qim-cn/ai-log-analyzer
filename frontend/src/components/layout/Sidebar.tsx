/**
 * 左侧会话列表侧边栏
 *
 * 支持按机型/状态/关键字筛选；新建对话时可填机型/SN（便于筛选与追溯）。
 */

import { useEffect, useState } from 'react';
import { MessageSquarePlus, Trash2, MessageSquare, Search } from 'lucide-react';
import { useSessionStore } from '@/stores';
import { cn, formatTime } from '@/utils';
import { MODEL_SUGGESTIONS } from '@/constants';
import { CreateSessionDialog } from './CreateSessionDialog';

interface SidebarProps {
  className?: string;
  onClose?: () => void;
}

export function Sidebar({ className, onClose }: SidebarProps) {
  const {
    sessions,
    currentSessionId,
    loading,
    fetchSessions,
    deleteSession,
    setCurrentSession,
  } = useSessionStore();

  const [filterModel, setFilterModel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchQ, setSearchQ] = useState('');

  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 筛选条件变化时重新拉取（搜索框防抖 300ms）
  useEffect(() => {
    const t = setTimeout(() => {
      fetchSessions({
        model: filterModel.trim() || undefined,
        status: filterStatus || undefined,
        q: searchQ.trim() || undefined,
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterModel, filterStatus, searchQ]);

  const handleSelect = (id: string) => {
    setCurrentSession(id);
    onClose?.();
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('确定删除这个会话？')) {
      await deleteSession(id);
    }
  };

  return (
    <div className={cn('flex flex-col h-full bg-card', className)}>
      {/* Header */}
      <div className="p-3 border-b border-border">
        <button
          onClick={() => setShowCreate(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5
                     bg-primary text-primary-foreground rounded-xl font-medium text-sm
                     hover:shadow-glow active:scale-[0.98] transition-all"
        >
          <MessageSquarePlus size={16} />
          <span>新建对话</span>
        </button>
      </div>

      {/* 筛选条 */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        <div className="flex gap-1.5">
          <input
            list="model-suggestions"
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            placeholder="机型"
            className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-1.5 py-1 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">全部</option>
            <option value="open">未解决</option>
            <option value="resolved">已解决</option>
          </select>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="搜索标题 / SN"
            className="w-full pl-7 pr-2 py-1 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {loading && sessions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">加载中...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">暂无会话</div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => handleSelect(session.id)}
              className={cn(
                'group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer',
                'hover:bg-muted transition-all duration-150',
                currentSessionId === session.id &&
                  'bg-primary/10 text-primary border border-primary/20'
              )}
            >
              <MessageSquare
                size={15}
                className={cn(
                  'shrink-0',
                  currentSessionId === session.id ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{session.title}</span>
                  {session.status === 'resolved' && (
                    <span
                      className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500"
                      title="已解决"
                    />
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 mt-0.5">
                  {session.model && (
                    <span className="px-1 rounded bg-muted text-[10px]">{session.model}</span>
                  )}
                  <span>{formatTime(session.updated_at)}</span>
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(e, session.id)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md
                           hover:bg-destructive/10 hover:text-destructive
                           transition-all duration-150"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* 新建会话弹窗（共享组件，与 MainLayout EmptyState 共用） */}
      <CreateSessionDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />

      {/* 机型建议（datalist，供筛选 input 与弹窗内机型 input 共用） */}
      <datalist id="model-suggestions">
        {MODEL_SUGGESTIONS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </div>
  );
}
