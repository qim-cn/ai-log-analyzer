/**
 * 时间线 API
 */

import type { TimelineData, LogContextData } from '@/types';
import { http } from './http';

export const timelineService = {
  /** 获取错误时间线数据 */
  getErrorTimeline: (sessionId: string, interval: string = 'hour') =>
    http.get<TimelineData>(`/timeline/errors?session_id=${sessionId}&interval=${interval}`),

  /** 获取日志行的上下文 */
  getLogContext: (logId: string, lineNumber: number, contextLines: number = 20) =>
    http.get<LogContextData>(`/timeline/context?log_id=${logId}&line_number=${lineNumber}&context_lines=${contextLines}`),
};
