/**
 * 审计日志 API
 */

import { http } from './http';

export interface AuditLog {
  id: string;
  user_id: string;
  username: string;
  action: string;
  detail: string | null;
  created_at: string;
}

export interface AuditResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

export const auditService = {
  /** 获取审计日志（分页） */
  list: (page: number = 1, limit: number = 50) =>
    http.get<AuditResponse>(`/audit?page=${page}&limit=${limit}`),
};
