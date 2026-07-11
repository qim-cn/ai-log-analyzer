/**
 * 日志聚类 API
 */

import { http } from './http';

export interface LogCluster {
  pattern: string;
  count: number;
  samples: string[];
  level: string;
}

export const clusterService = {
  /** 获取日志聚类 */
  getClusters: (logId: string) =>
    http.get<{ clusters: LogCluster[]; total: number }>(`/logs/${logId}/clusters`),
};
