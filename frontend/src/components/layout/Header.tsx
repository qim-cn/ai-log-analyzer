/**
 * 顶部导航栏
 */

import { Moon, Sun, Settings, PanelRight, Menu } from 'lucide-react';
import { useThemeStore, useChatStore } from '@/stores';
import { cn } from '@/utils';

interface HeaderProps {
  onToggleSidebar?: () => void;
  onToggleLogPanel?: () => void;
  onOpenSettings?: () => void;
}

export function Header({
  onToggleSidebar,
  onToggleLogPanel,
  onOpenSettings,
}: HeaderProps) {
  const { theme, toggleTheme } = useThemeStore();
  const streaming = useChatStore((s) => s.streaming);

  return (
    <header className="h-12 border-b border-border bg-card/80 backdrop-blur-sm flex items-center px-3 gap-2">
      {/* 移动端菜单按钮 */}
      <button
        onClick={onToggleSidebar}
        className="lg:hidden p-1.5 hover:bg-muted rounded-lg transition-colors"
      >
        <Menu size={18} />
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className={cn(
          'w-7 h-7 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center shadow-glow transition-all duration-500',
          streaming && 'animate-pulse-glow'
        )}>
          <span className="text-white text-xs font-bold">AI</span>
        </div>
        <span className="font-semibold text-sm hidden sm:inline bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          AI Log Analyzer
        </span>
      </div>

      <div className="flex-1" />

      {/* Actions */}
      <button
        onClick={onToggleLogPanel}
        className="p-1.5 hover:bg-muted rounded-lg transition-colors"
        title="日志面板"
      >
        <PanelRight size={17} />
      </button>

      <button
        onClick={toggleTheme}
        className="p-1.5 hover:bg-muted rounded-lg transition-colors"
        title={theme === 'dark' ? '切换亮色' : '切换暗色'}
      >
        {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>

      <button
        onClick={onOpenSettings}
        className="p-1.5 hover:bg-muted rounded-lg transition-colors"
        title="设置"
      >
        <Settings size={17} />
      </button>
    </header>
  );
}
