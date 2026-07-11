/**
 * 异常检测和趋势预测类型定义
 */

/** 异常点 */
export interface AnomalyPoint {
  index: number;
  timestamp: string | null;
  error_count: number;
  zscore: number;
  is_outlier_iqr: boolean;
  severity: 'high' | 'medium' | 'low';
}

/** 异常检测结果 */
export interface AnomalyResult {
  anomalies: AnomalyPoint[];
  metrics: {
    error_counts: number[];
    timestamps: string[];
    mean: number;
    std: number;
    q1: number;
    q3: number;
  };
}

/** 异常模式统计 */
export interface AnomalySummary {
  top_patterns: Array<{
    pattern: string;
    count: number;
    first_seen: string;
    last_seen: string;
  }>;
  total_patterns: number;
}

/** 趋势预测 */
export interface TrendPrediction {
  trend: 'increasing' | 'decreasing' | 'stable' | 'unknown' | 'insufficient_data';
  predictions: Array<{
    day: number;
    predicted_errors: number;
    timestamp: string;
  }>;
  confidence: number;
  current_rate: number;
  average_rate: number;
}

/** 容量分析 */
export interface CapacityAnalysis {
  status: string;
  current_storage_mb: number;
  daily_growth_mb: number;
  predictions: Array<{
    days: number;
    predicted_mb: number;
    predicted_gb: number;
  }>;
  recommendations: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
}

/** 性能瓶颈 */
export interface Bottleneck {
  type: string;
  total_count: number;
  severity: string;
  suggestion: string;
  files: string[];
}

/** 瓶颈检测结果 */
export interface BottleneckResult {
  bottlenecks: Bottleneck[];
  warnings: Array<{
    level: string;
    message: string;
    suggestion: string;
  }>;
  total_issues: number;
}

/** 趋势分析完整结果 */
export interface TrendAnalysis {
  trend: TrendPrediction;
  capacity: CapacityAnalysis;
  bottlenecks: BottleneckResult;
}

/** 全局趋势统计 */
export interface TrendSummary {
  daily_trend: Array<{
    date: string;
    count: number;
  }>;
  total_days: number;
}
