/**
 * 日志对比 API
 */

import { http } from './http';

export interface CompareResult {
  total_lines_1: number;
  total_lines_2: number;
  added_lines: number;
  removed_lines: number;
  modified_lines: number;
  unchanged_lines: number;
  new_errors: string[];
  fixed_errors: string[];
  changed_params: string[];
  diff_lines: { type: string; content: string }[];
  summary: string;
}

export const compareService = {
  /** 对比两份日志 */
  compare: (logId1: string, logId2: string) =>
    http.post<CompareResult>('/logs/compare', { log_id_1: logId1, log_id_2: logId2 }),
};
