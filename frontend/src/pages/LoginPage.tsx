/**
 * 登录页面
 */

import { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { authService } from '@/services/authService';
import { cn } from '@/utils';

interface LoginPageProps {
  onLogin: (token: string, user: unknown) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }

    setLoading(true);
    try {
      const data = await authService.login(username, password);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center shadow-glow-lg">
            <span className="text-white text-xl font-bold">AI</span>
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            AI Log Analyzer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            服务器日志智能分析系统
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
              autoComplete="username"
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
                'transition-all duration-150'
              )}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              autoComplete="current-password"
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
                'transition-all duration-150'
              )}
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'w-full py-2.5 rounded-xl text-sm font-medium',
              'bg-primary text-primary-foreground',
              'hover:shadow-glow active:scale-[0.98] transition-all duration-150',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                登录中...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <LogIn size={16} />
                登录
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
