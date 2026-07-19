/**
 * 异常检测 API
 */

import { http } from './http';

export interface AnomalyAlert {
  pattern: string;
  count: number;
  sessions: number;
}

export interface AnomalyCandidate {
  cause: string;
  action: string;
}

export interface AnomalyResult {
  model: string;
  alerts: AnomalyAlert[];
  candidates: AnomalyCandidate[];
  days: number;
  threshold: number;
}

export const anomalyService = {
  /** 检测当前会话机型的近期多台相同失败 */
  check: (sessionId: string) =>
    http.get<AnomalyResult | null>(
      `/anomaly/check?session_id=${encodeURIComponent(sessionId)}`
    ),
};
