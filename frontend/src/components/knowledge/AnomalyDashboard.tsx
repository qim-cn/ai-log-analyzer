/**
 * AnomalyDashboard - 异常检测仪表盘
 *
 * 显示异常检测结果、趋势预测和瓶颈预警
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  HardDrive,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { knowledgeService } from '@/services/knowledgeService';
import type {
  AnomalyResult,
  AnomalySummary,
  TrendAnalysis,
  TrendSummary,
} from '@/types';
import { cn } from '@/utils/cn';

interface AnomalyDashboardProps {
  sessionId?: string;
}

export const AnomalyDashboard: React.FC<AnomalyDashboardProps> = ({ sessionId }) => {
  const [anomalies, setAnomalies] = useState<AnomalyResult | AnomalySummary | null>(null);
  const [trends, setTrends] = useState<TrendAnalysis | TrendSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [anomalyData, trendData] = await Promise.all([
        knowledgeService.getAnomalies(sessionId),
        knowledgeService.getTrends(sessionId),
      ]);

      setAnomalies(anomalyData);
      setTrends(trendData);
    } catch (err) {
      setError('Failed to fetch data');
      console.error('Error fetching anomaly data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-destructive">{error}</p>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5" />
          异常检测与趋势分析
        </h2>
        <button
          onClick={fetchData}
          className="p-2 hover:bg-muted rounded-md transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* 异常统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="异常检测"
          value={anomalies && 'anomalies' in anomalies ? anomalies.anomalies.length : 0}
          icon={<AlertTriangle className="h-5 w-5 text-yellow-500" />}
          description="检测到的异常点"
        />
        <StatCard
          title="趋势方向"
          value={getTrendLabel(trends)}
          icon={getTrendIcon(trends)}
          description="错误趋势预测"
        />
        <StatCard
          title="瓶颈问题"
          value={trends && 'bottlenecks' in trends ? trends.bottlenecks.total_issues : 0}
          icon={<Activity className="h-5 w-5 text-red-500" />}
          description="性能瓶颈"
        />
      </div>

      {/* 异常列表 */}
      {anomalies && 'anomalies' in anomalies && anomalies.anomalies.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">异常点列表</h3>
          <div className="space-y-2">
            {anomalies.anomalies.map((anomaly, index) => (
              <div
                key={index}
                className={cn(
                  'flex items-center justify-between p-3 rounded-md',
                  anomaly.severity === 'high' ? 'bg-red-500/10' : 'bg-yellow-500/10'
                )}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle
                    className={cn(
                      'h-4 w-4',
                      anomaly.severity === 'high' ? 'text-red-500' : 'text-yellow-500'
                    )}
                  />
                  <div>
                    <div className="text-sm font-medium">
                      错误数: {anomaly.error_count}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Z-score: {anomaly.zscore.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {anomaly.timestamp ? new Date(anomaly.timestamp).toLocaleString() : 'N/A'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 趋势预测 */}
      {trends && 'trend' in trends && trends.trend.predictions.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">趋势预测</h3>
          <div className="space-y-2">
            {trends.trend.predictions.map((pred, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 hover:bg-muted rounded-md"
              >
                <span className="text-sm">第 {pred.day} 天</span>
                <span className="text-sm font-medium">
                  预计错误: {pred.predicted_errors}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 容量分析 */}
      {trends && 'capacity' in trends && trends.capacity.recommendations.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">容量建议</h3>
          <div className="space-y-2">
            {trends.capacity.recommendations.map((rec, index) => (
              <div
                key={index}
                className={cn(
                  'p-3 rounded-md',
                  rec.severity === 'high' ? 'bg-red-500/10' : 'bg-yellow-500/10'
                )}
              >
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  <span className="text-sm">{rec.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 瓶颈预警 */}
      {trends && 'bottlenecks' in trends && trends.bottlenecks.warnings.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">瓶颈预警</h3>
          <div className="space-y-2">
            {trends.bottlenecks.warnings.map((warning, index) => (
              <div
                key={index}
                className={cn(
                  'p-3 rounded-md',
                  warning.level === 'critical' ? 'bg-red-500/10' : 'bg-yellow-500/10'
                )}
              >
                <div className="flex items-center gap-2">
                  {getBottleneckIcon(warning.level)}
                  <div>
                    <div className="text-sm font-medium">{warning.message}</div>
                    <div className="text-xs text-muted-foreground">{warning.suggestion}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 全局趋势统计 */}
      {trends && 'daily_trend' in trends && trends.daily_trend.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">每日错误趋势</h3>
          <div className="h-48 flex items-end gap-1">
            {trends.daily_trend.map((day, index) => {
              const maxCount = Math.max(...trends.daily_trend.map((d) => d.count));
              const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0;

              return (
                <div
                  key={index}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <div className="text-xs text-muted-foreground">{day.count}</div>
                  <div
                    className="w-full bg-primary rounded-t"
                    style={{ height: `${height}%` }}
                  />
                  <div className="text-[10px] text-muted-foreground">
                    {day.date.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// 辅助组件
const StatCard: React.FC<{
  title: string;
  value: number | string;
  icon: React.ReactNode;
  description: string;
}> = ({ title, value, icon, description }) => (
  <div className="border border-border rounded-lg p-4">
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{title}</span>
      {icon}
    </div>
    <div className="mt-2 text-2xl font-bold">{value}</div>
    <div className="text-xs text-muted-foreground">{description}</div>
  </div>
);

// 辅助函数
const getTrendLabel = (trends: TrendAnalysis | TrendSummary | null): string => {
  if (!trends || 'daily_trend' in trends) return 'N/A';
  const trendMap: Record<string, string> = {
    increasing: '上升',
    decreasing: '下降',
    stable: '稳定',
    unknown: '未知',
  };
  return trendMap[trends.trend.trend] || 'N/A';
};

const getTrendIcon = (trends: TrendAnalysis | TrendSummary | null) => {
  if (!trends || 'daily_trend' in trends) return <Minus className="h-5 w-5 text-gray-500" />;
  const iconMap: Record<string, React.ReactNode> = {
    increasing: <TrendingUp className="h-5 w-5 text-red-500" />,
    decreasing: <TrendingDown className="h-5 w-5 text-green-500" />,
    stable: <Minus className="h-5 w-5 text-blue-500" />,
  };
  return iconMap[trends.trend.trend] || <Minus className="h-5 w-5 text-gray-500" />;
};

const getBottleneckIcon = (level: string) => {
  switch (level) {
    case 'critical':
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    default:
      return <Activity className="h-4 w-4 text-gray-500" />;
  }
};
