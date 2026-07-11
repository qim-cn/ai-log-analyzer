/**
 * 日志统计面板
 * 显示按级别、来源、时间的聚合统计
 */

import { useEffect, useState } from 'react';
import { BarChart3, AlertTriangle, Clock, Server } from 'lucide-react';
import type { LogStatistics } from '@/types';
import { logService } from '@/services';
import { cn } from '@/utils';

interface LogStatsProps {
  logId: string;
  filename?: string;
}

export function LogStats({ logId }: LogStatsProps) {
  const [stats, setStats] = useState<LogStatistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const data = await logService.getStatistics(logId);
        setStats(data);
      } catch (err) {
        console.error('获取统计失败:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [logId]);

  if (loading) {
    return (
      <div className="p-3 border-t border-border text-center text-sm text-muted-foreground">
        加载统计...
      </div>
    );
  }

  if (!stats) return null;

  const total = stats.total_lines || 1;

  return (
    <div className="border-t border-border">
      {/* Toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-sm
                   hover:bg-accent transition-colors"
      >
        <BarChart3 size={14} />
        <span>日志统计</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {expanded ? '收起' : '展开'}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Level Distribution */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
              <AlertTriangle size={12} />
              <span>级别分布</span>
            </div>
            <div className="space-y-1">
              {['error', 'warning', 'info', 'debug'].map((level) => {
                const count = stats.level_counts[level] || 0;
                const pct = (count / total) * 100;
                return (
                  <div key={level} className="flex items-center gap-2 text-xs">
                    <span className="w-14 text-muted-foreground capitalize">
                      {level}
                    </span>
                    <div className="flex-1 h-3 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          level === 'error' && 'bg-red-500',
                          level === 'warning' && 'bg-yellow-500',
                          level === 'info' && 'bg-green-500',
                          level === 'debug' && 'bg-blue-500'
                        )}
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-muted-foreground">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Source Distribution */}
          {Object.keys(stats.source_counts).length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
                <Server size={12} />
                <span>来源 Top 5</span>
              </div>
              <div className="space-y-1">
                {Object.entries(stats.source_counts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([source, count]) => (
                    <div
                      key={source}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="truncate max-w-[150px]">{source}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Error Types */}
          {Object.keys(stats.error_types).length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
                <AlertTriangle size={12} className="text-red-500" />
                <span>错误类型</span>
              </div>
              <div className="space-y-1">
                {Object.entries(stats.error_types)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="truncate max-w-[150px] text-red-400">
                        {type}
                      </span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Time Range */}
          {stats.time_start && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock size={12} />
              <span>
                {stats.time_start} ~ {stats.time_end}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
