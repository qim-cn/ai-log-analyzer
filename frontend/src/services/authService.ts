/**
 * 认证 API
 */

import type { User, LoginResponse } from '@/types';
import { http } from './http';

export const authService = {
  /** 检查是否需要首次设置 */
  checkSetup: () => http.get<{ needsSetup: boolean }>('/auth/setup'),

  /** 首次设置管理员 */
  setup: (username: string, password: string) =>
    http.post<User>('/auth/setup', { username, password }),

  /** 登录 */
  login: (username: string, password: string) =>
    http.post<LoginResponse>('/auth/login', { username, password }),

  /** 获取当前用户 */
  me: () => http.get<User>('/auth/me'),

  /** 重置密码（管理员） */
  resetPassword: (userId: string, newPassword: string) =>
    http.post<null>('/auth/reset-password', { user_id: userId, new_password: newPassword }),

  /** 获取用户列表（管理员） */
  listUsers: () => http.get<{ users: User[] }>('/users'),

  /** 创建用户（管理员） */
  createUser: (username: string, password: string, role?: string) =>
    http.post<User>('/users', { username, password, role: role || 'user' }),

  /** 删除用户（管理员） */
  deleteUser: (userId: string) =>
    http.delete<null>(`/users/${userId}`),
};
