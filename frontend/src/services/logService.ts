/**
 * 日志文件 API
 */

import type { LogFile, LogStatistics, SimilarLog } from '@/types';
import { http, uploadFile } from './http';

export const logService = {
  /** 上传日志文件 */
  upload: (sessionId: string, file: File) =>
    uploadFile<LogFile>('/logs/upload', file, { session_id: sessionId }),

  /** 获取会话下的日志文件列表 */
  list: (sessionId: string) =>
    http.get<{ files: LogFile[] }>(`/logs/${sessionId}`),

  /** 获取日志统计信息 */
  getStatistics: (logId: string) =>
    http.get<LogStatistics>(`/logs/${logId}/statistics`),

  /** 查找相似的历史日志 */
  findSimilar: (logId: string, limit: number = 5) =>
    http.get<{ similar_logs: SimilarLog[] }>(`/logs/${logId}/similar?limit=${limit}`),

  /** 删除日志文件 */
  delete: (logId: string) =>
    http.delete<null>(`/logs/${logId}`),
};
