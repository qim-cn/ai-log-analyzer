/**
 * App 根组件
 * 处理登录状态和路由
 */

import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoginPage } from '@/pages/LoginPage';
import { UserManagePage } from '@/pages/UserManagePage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { DashboardPage } from '@/pages/DashboardPage';
import { useThemeStore } from '@/stores';
import type { User } from '@/types';

type Page = 'app' | 'users' | 'knowledge' | 'dashboard';

export default function App() {
  const theme = useThemeStore((s) => s.theme);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>('app');

  // 初始化主题
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // 检查登录状态
  useEffect(() => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        setCurrentUser(user);
        setIsLoggedIn(true);
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
  }, []);

  const handleLogin = (_token: string, user: unknown) => {
    setCurrentUser(user as User);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setCurrentUser(null);
    setIsLoggedIn(false);
    setPage('app');
  };

  // 未登录 → 登录页
  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // 用户管理页
  if (page === 'users') {
    return <UserManagePage onBack={() => setPage('app')} />;
  }

  // 知识库页
  if (page === 'knowledge') {
    return <KnowledgePage onBack={() => setPage('app')} />;
  }

  // 仪表盘页
  if (page === 'dashboard') {
    return <DashboardPage onBack={() => setPage('app')} />;
  }

  // 主界面
  return (
    <MainLayout
      currentUser={currentUser}
      onLogout={handleLogout}
      onOpenUsers={() => setPage('users')}
      onOpenKnowledge={() => setPage('knowledge')}
      onOpenDashboard={() => setPage('dashboard')}
    />
  );
}
