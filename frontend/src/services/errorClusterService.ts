/**
 * 错误聚类 API
 */

import { http } from './http';

export interface ErrorCluster {
  /** 归一化模式 */
  pattern: string;
  /** 出现次数 */
  count: number;
  /** 首次出现时间（行内时间戳，可能为空） */
  first_seen: string | null;
  /** 最后出现时间 */
  last_seen: string | null;
  /** 一条原始样例行 */
  sample: string;
  /** 占全部错误行的比例 */
  ratio: number;
}

export const errorClusterService = {
  /** 获取日志错误聚类（按次数降序） */
  getErrorClusters: (logId: string, limit = 20) =>
    http.get<{ total_error_lines: number; clusters: ErrorCluster[] }>(
      `/logs/${logId}/error-clusters?limit=${limit}`
    ),
};
