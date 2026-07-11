/**
 * 时间线相关类型定义
 */

/** 时间线事件 */
export interface TimelineEvent {
  timestamp: string;
  line_number: number;
  error_type: string;
  content: string;
  log_file: string;
  log_id: string;
}

/** 时间线分组 */
export interface TimelineGroup {
  time: string;
  count: number;
  error_types: Record<string, number>;
}

/** 时间线数据 */
export interface TimelineData {
  timeline: TimelineGroup[];
  total_errors: number;
  events: TimelineEvent[];
}

/** 日志上下文 */
export interface LogContextLine {
  line_number: number;
  content: string;
  is_target: boolean;
}

/** 日志上下文数据 */
export interface LogContextData {
  log_id: string;
  filename: string;
  target_line: number;
  context: LogContextLine[];
}
