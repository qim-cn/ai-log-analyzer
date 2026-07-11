/**
 * 仪表盘页面
 * 管理员默认首页
 */

import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Activity,
  MessageSquare,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import { sessionService } from '@/services/sessionService';
import { statsService } from '@/services/statsService';
import { formatTime } from '@/utils';

interface DashboardPageProps {
  onBack: () => void;
}

interface Stats {
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  success_rate: number;
  avg_duration_ms: number;
  last_call_time: string | null;
  last_call_model: string | null;
  hourly_calls: Record<string, number>;
}

export function DashboardPage({ onBack }: DashboardPageProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [statsData, sessionsData] = await Promise.all([
          statsService.getStats(),
          sessionService.list(),
        ]);
        setStats(statsData);
        setSessionCount(sessionsData.sessions.length);
      } catch (err) {
        console.error('获取仪表盘数据失败:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-12 border-b border-border bg-card flex items-center px-4 gap-3">
        <button
          onClick={onBack}
          className="p-1.5 hover:bg-muted rounded-lg transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="font-semibold text-sm">仪表盘</div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* 统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={<MessageSquare size={20} />}
              label="总会话数"
              value={sessionCount}
              color="blue"
            />
            <StatCard
              icon={<Activity size={20} />}
              label="AI 调用次数"
              value={stats?.total_calls || 0}
              color="green"
            />
            <StatCard
              icon={<AlertTriangle size={20} />}
              label="失败次数"
              value={stats?.failed_calls || 0}
              color="red"
            />
            <StatCard
              icon={<BarChart3 size={20} />}
              label="平均响应"
              value={`${stats?.avg_duration_ms || 0}ms`}
              color="purple"
            />
          </div>

          {/* 详细信息 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* AI 调用统计 */}
            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-medium mb-4">AI 调用统计</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">总调用</span>
                  <span className="font-medium">{stats?.total_calls || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">成功率</span>
                  <span className="font-medium text-green-500">
                    {stats?.success_rate || 0}%
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">平均耗时</span>
                  <span className="font-medium">{stats?.avg_duration_ms || 0}ms</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">当前模型</span>
                  <span className="font-medium font-mono text-xs">
                    {stats?.last_call_model || '-'}
                  </span>
                </div>
                {stats?.last_call_time && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">最后调用</span>
                    <span className="font-medium">{formatTime(stats.last_call_time)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 按小时调用分布 */}
            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-medium mb-4">调用趋势（按小时）</h3>
              {stats?.hourly_calls && Object.keys(stats.hourly_calls).length > 0 ? (
                <div className="space-y-1">
                  {Object.entries(stats.hourly_calls)
                    .slice(-12)
                    .map(([hour, count]) => (
                      <div key={hour} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-muted-foreground shrink-0">
                          {hour.split(' ')[1]}
                        </span>
                        <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (count /
                                  Math.max(
                                    ...Object.values(stats.hourly_calls)
                                  )) *
                                  100
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="w-8 text-right text-muted-foreground">{count}</span>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  暂无调用数据
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: 'blue' | 'green' | 'red' | 'purple';
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-500/10 text-blue-500',
    green: 'bg-green-500/10 text-green-500',
    red: 'bg-red-500/10 text-red-500',
    purple: 'bg-purple-500/10 text-purple-500',
  };

  return (
    <div className="border border-border rounded-xl p-4 bg-card">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>{icon}</div>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </div>
  );
}
