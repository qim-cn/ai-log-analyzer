/**
 * 左侧会话列表侧边栏
 */

import { useEffect, useState } from 'react';
import { MessageSquarePlus, Trash2, MessageSquare } from 'lucide-react';
import { useSessionStore } from '@/stores';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { cn, formatTime } from '@/utils';

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
    createSession,
    deleteSession,
    setCurrentSession,
  } = useSessionStore();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleCreate = async () => {
    await createSession();
    toast('success', '会话已创建');
    onClose?.();
  };

  const handleSelect = (id: string) => {
    setCurrentSession(id);
    onClose?.();
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteTarget(id);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await deleteSession(deleteTarget);
    toast('success', '会话已删除');
    setDeleteTarget(null);
  };

  return (
    <div className={cn('flex flex-col h-full bg-card', className)}>
      {/* Header */}
      <div className="p-3 border-b border-border">
        <button
          onClick={handleCreate}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5
                     bg-primary text-primary-foreground rounded-xl font-medium text-sm
                     hover:shadow-glow active:scale-[0.98] transition-all"
        >
          <MessageSquarePlus size={16} />
          <span>新建对话</span>
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {loading && sessions.length === 0 ? (
          <div className="space-y-2 p-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">
            暂无会话
          </div>
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
                  currentSessionId === session.id
                    ? 'text-primary'
                    : 'text-muted-foreground'
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">
                  {session.title}
                </div>
                <div className="text-[11px] text-muted-foreground/60 mt-0.5">
                  {formatTime(session.updated_at)}
                </div>
              </div>
              <button
                onClick={(e) => handleDeleteClick(e, session.id)}
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除会话"
        message="确定删除这个会话？删除后不可恢复。"
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
