/**
 * 用户管理页面（仅管理员）
 */

import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Shield, User, Loader2 } from 'lucide-react';
import { authService } from '@/services/authService';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type { User as UserType } from '@/types';
import { cn, formatTime } from '@/utils';

interface UserManagePageProps {
  onBack: () => void;
}

export function UserManagePage({ onBack }: UserManagePageProps) {
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; username: string } | null>(null);
  const { toast } = useToast();

  const fetchUsers = async () => {
    try {
      const data = await authService.listUsers();
      setUsers(data.users);
    } catch (err) {
      console.error('获取用户列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newUsername || !newPassword) {
      setError('请输入用户名和密码');
      return;
    }

    if (newPassword.length < 6) {
      setError('密码长度不能少于 6 位');
      return;
    }

    setCreating(true);
    try {
      await authService.createUser(newUsername, newPassword);
      setNewUsername('');
      setNewPassword('');
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = (userId: string, username: string) => {
    setDeleteTarget({ id: userId, username });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await authService.deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      fetchUsers();
      toast('success', `用户 ${deleteTarget.username} 已删除`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '删除失败');
      setDeleteTarget(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 hover:bg-muted rounded-lg transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="font-semibold text-sm">用户管理</div>
          <div className="text-[11px] text-muted-foreground">
            {users.length} 个用户
          </div>
        </div>
      </div>

      {/* Create Form */}
      <div className="p-4 border-b border-border">
        <form onSubmit={handleCreate} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs font-medium mb-1 block text-muted-foreground">
              用户名
            </label>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="输入用户名"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium mb-1 block text-muted-foreground">
              密码
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 6 位"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium
                       hover:shadow-glow active:scale-95 transition-all disabled:opacity-50"
          >
            {creating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <span className="flex items-center gap-1.5">
                <Plus size={14} />
                添加
              </span>
            )}
          </button>
        </form>
        {error && (
          <div className="text-xs text-destructive mt-2">{error}</div>
        )}
      </div>

      {/* User List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-muted-foreground py-8">加载中...</div>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card
                           hover:bg-muted/50 transition-colors"
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                    user.role === 'admin'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {user.role === 'admin' ? (
                    <Shield size={16} />
                  ) : (
                    <User size={16} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{user.username}</span>
                    {user.role === 'admin' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                        管理员
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    创建于 {formatTime(user.created_at)}
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={() => handleDeleteClick(user.id, user.username)}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive
                             transition-colors"
                  title="删除用户"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除用户"
        message={deleteTarget ? `确定删除用户 ${deleteTarget.username}？此操作不可撤销。` : ''}
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
