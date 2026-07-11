/**
 * AI 调用统计 API
 */

import { http } from './http';

export interface AIStats {
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  success_rate: number;
  total_tokens: number;
  avg_duration_ms: number;
  last_call_time: string | null;
  last_call_model: string | null;
  last_call_duration_ms: number;
  hourly_calls: Record<string, number>;
}

export const statsService = {
  /** 获取 AI 调用统计 */
  getStats: () => http.get<AIStats>('/stats'),
};
