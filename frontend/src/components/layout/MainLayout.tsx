/**
 * 主布局组件
 * 三栏布局：左侧会话列表 | 中间对话区 | 右侧知识库面板
 */

import { useState, useEffect } from 'react';
import { LogOut, Users, BookOpen, LayoutDashboard } from 'lucide-react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ConversationCommandsPanel } from '@/components/chat/ConversationCommandsPanel';
import { LinuxKnowledgePanel } from '@/components/knowledge/LinuxKnowledgePanel';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { ToastProvider } from '@/components/ui/Toast';
import { useSessionStore } from '@/stores';
import { cn } from '@/utils';
import type { User } from '@/types';

interface MainLayoutProps {
  currentUser: User | null;
  onLogout: () => void;
  onOpenUsers: () => void;
  onOpenKnowledge: () => void;
  onOpenDashboard: () => void;
}

export function MainLayout({ currentUser, onLogout, onOpenUsers, onOpenKnowledge, onOpenDashboard }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [knowledgePanelOpen, setKnowledgePanelOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 右侧面板两个 tab：对话命令 / Linux命令
  const [rightTab, setRightTab] = useState<'commands' | 'linux'>('commands');

  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <ToastProvider>
      <div className="h-screen flex flex-col">
        <Header
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleLogPanel={() => setKnowledgePanelOpen(!knowledgePanelOpen)}
          onOpenSettings={
            // 设置入口仅管理员可见
            currentUser?.role === 'admin' ? () => setSettingsOpen(true) : undefined
          }
        />

        <div className="flex-1 flex overflow-hidden relative">
          {/* 移动端遮罩 */}
          {sidebarOpen && (
            <div
              className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* 左侧会话列表 */}
          <aside
            className={cn(
              'w-64 border-r border-border shrink-0 flex flex-col',
              'lg:relative lg:translate-x-0',
              'fixed inset-y-12 left-0 z-50 transition-transform duration-200',
              sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
            )}
          >
            <div className="flex-1 overflow-hidden">
              <Sidebar onClose={() => setSidebarOpen(false)} />
            </div>

            {/* 底部用户信息 */}
            <div className="border-t border-border p-3 space-y-1">
              <button
                onClick={onOpenKnowledge}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm
                           hover:bg-muted transition-colors text-muted-foreground"
              >
                <BookOpen size={15} />
                <span>知识库</span>
              </button>

              {currentUser?.role === 'admin' && (
                <>
                  <button
                    onClick={onOpenDashboard}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm
                               hover:bg-muted transition-colors text-muted-foreground"
                  >
                    <LayoutDashboard size={15} />
                    <span>仪表盘</span>
                  </button>
                  <button
                    onClick={onOpenUsers}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm
                               hover:bg-muted transition-colors text-muted-foreground"
                  >
                    <Users size={15} />
                    <span>用户管理</span>
                  </button>
                </>
              )}

              <button
                onClick={onLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm
                           hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"
              >
                <LogOut size={15} />
                <span>退出登录</span>
              </button>

              <div className="px-3 py-1.5 text-[11px] text-muted-foreground/50 truncate">
                {currentUser?.username} · {currentUser?.role === 'admin' ? '管理员' : '普通用户'}
              </div>
            </div>
          </aside>

          {/* 中间对话区 */}
          <main className="flex-1 min-w-0">
            {currentSessionId ? (
              <ChatPanel sessionId={currentSessionId} />
            ) : (
              <EmptyState />
            )}
          </main>

          {/* 右侧面板：对话命令 / Linux命令 */}
          {currentSessionId && knowledgePanelOpen && (
            <aside className="w-80 border-l border-border shrink-0 hidden md:flex flex-col">
              <div className="flex border-b border-border px-3 gap-1 shrink-0">
                {(['commands', 'linux'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setRightTab(t)}
                    className={cn(
                      'px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                      rightTab === t
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t === 'commands' ? '对话命令' : 'Linux命令'}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-hidden">
                {rightTab === 'commands' ? (
                  <ConversationCommandsPanel />
                ) : (
                  <LinuxKnowledgePanel />
                )}
              </div>
            </aside>
          )}
        </div>

        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </ToastProvider>
  );
}

function EmptyState() {
  const createSession = useSessionStore((s) => s.createSession);

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center animate-fade-in max-w-md mx-4">
        <div className="w-16 h-16 mx-auto mb-5 bg-gradient-to-br from-primary/20 to-accent/20 rounded-2xl flex items-center justify-center">
          <span className="text-3xl">📋</span>
        </div>
        <div className="text-lg font-semibold mb-1.5">开始分析日志</div>
        <div className="text-sm text-muted-foreground mb-5">
          创建一个新对话，上传日志文件，AI 帮你分析
        </div>
        <button
          onClick={() => createSession()}
          className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium
                     hover:shadow-glow active:scale-95 transition-all"
        >
          新建对话
        </button>
      </div>
    </div>
  );
}
