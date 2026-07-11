/**
 * 认证 API
 */

import type { User, LoginResponse } from '@/types';
import { http } from './http';

export const authService = {
  /** 登录 */
  login: (username: string, password: string) =>
    http.post<LoginResponse>('/auth/login', { username, password }),

  /** 获取当前用户 */
  me: () => http.get<User>('/auth/me'),

  /** 获取用户列表（管理员） */
  listUsers: () => http.get<{ users: User[] }>('/users'),

  /** 创建用户（管理员） */
  createUser: (username: string, password: string, role?: string) =>
    http.post<User>('/users', { username, password, role: role || 'user' }),

  /** 删除用户（管理员） */
  deleteUser: (userId: string) =>
    http.delete<null>(`/users/${userId}`),
};
