/**
 * 登录页面
 */

import { useEffect, useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { authService } from '@/services/authService';
import { cn } from '@/utils';

interface LoginPageProps {
  onLogin: (token: string, user: unknown) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 首次访问时检测是否已有管理员
  useEffect(() => {
    authService.checkSetup().then((res) => {
      setIsFirstTime(res.needsSetup);
    }).catch(() => {
      // 静默失败，保持普通登录模式
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }

    if (isFirstTime && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      if (isFirstTime) {
        await authService.setup(username, password);
        const loginData = await authService.login(username, password);
        localStorage.setItem('token', loginData.token);
        localStorage.setItem('user', JSON.stringify(loginData.user));
        onLogin(loginData.token, loginData.user);
      } else {
        const data = await authService.login(username, password);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        onLogin(data.token, data.user);
      }
    } catch (err) {
      console.error('[LoginPage]', err);
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
            {isFirstTime ? '首次使用，请创建管理员账号' : '服务器日志智能分析系统'}
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
              placeholder={isFirstTime ? '设置管理员用户名' : '输入用户名'}
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
            <label className="text-sm font-medium mb-1.5 block">
              {isFirstTime ? '设置密码' : '密码'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isFirstTime ? '设置密码（至少6位）' : '输入密码'}
              autoComplete={isFirstTime ? 'new-password' : 'current-password'}
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
                'transition-all duration-150'
              )}
            />
          </div>

          {isFirstTime && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
                autoComplete="new-password"
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm',
                  'placeholder:text-muted-foreground/50',
                  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
                  'transition-all duration-150'
                )}
              />
            </div>
          )}

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
                {isFirstTime ? '创建中...' : '登录中...'}
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <LogIn size={16} />
                {isFirstTime ? '创建管理员账号' : '登录'}
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
