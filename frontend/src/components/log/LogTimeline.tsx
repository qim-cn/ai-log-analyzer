/**
 * LogTimeline - 日志时间线可视化组件
 *
 * 时间轴展示错误分布，点击查看详细上下文
 */

import { useEffect, useState } from 'react';
import {
  Clock,
  AlertTriangle,
  AlertCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { timelineService } from '@/services/timelineService';
import type { TimelineData, TimelineEvent, LogContextData } from '@/types';
import { cn } from '@/utils/cn';

interface LogTimelineProps {
  sessionId: string;
  onErrorClick?: (event: TimelineEvent) => void;
}

export const LogTimeline: React.FC<LogTimelineProps> = ({
  sessionId,
  onErrorClick,
}) => {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<'minute' | 'hour' | 'day'>('hour');
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [context, setContext] = useState<LogContextData | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  const fetchTimeline = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await timelineService.getErrorTimeline(sessionId, interval);
      setData(result);
    } catch (err) {
      setError('Failed to fetch timeline');
      console.error('Error fetching timeline:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimeline();
  }, [sessionId, interval]);

  const handleEventClick = async (event: TimelineEvent) => {
    setSelectedEvent(event);
    setLoadingContext(true);

    try {
      const contextData = await timelineService.getLogContext(
        event.log_id,
        event.line_number,
        15
      );
      setContext(contextData);
    } catch (err) {
      console.error('Error fetching context:', err);
    } finally {
      setLoadingContext(false);
    }

    onErrorClick?.(event);
  };

  const getErrorIcon = (errorType: string) => {
    switch (errorType) {
      case 'FATAL':
      case 'CRITICAL':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'ERROR':
      case 'EXCEPTION':
        return <AlertCircle className="h-4 w-4 text-orange-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">
        {error}
      </div>
    );
  }

  if (!data || data.timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Clock className="h-12 w-12 mb-4 opacity-50" />
        <p>No errors found in timeline</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 控制栏 */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <span className="font-medium">Error Timeline</span>
          <span className="text-sm text-muted-foreground">
            ({data.total_errors} errors)
          </span>
        </div>
        <div className="flex gap-1">
          {(['minute', 'hour', 'day'] as const).map((int) => (
            <button
              key={int}
              onClick={() => setInterval(int)}
              className={cn(
                'px-3 py-1 text-xs rounded-md transition-colors',
                interval === int
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              )}
            >
              {int.charAt(0).toUpperCase() + int.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* 时间线图表 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="relative">
          {/* 时间轴线 */}
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border" />

          {/* 时间点 */}
          <div className="space-y-4">
            {data.timeline.map((group, index) => (
              <div key={index} className="relative flex items-start gap-4">
                {/* 时间标记 */}
                <div className="relative z-10 flex items-center justify-center w-16 shrink-0">
                  <div
                    className={cn(
                      'w-3 h-3 rounded-full border-2 border-background',
                      group.count > 10
                        ? 'bg-red-500'
                        : group.count > 5
                        ? 'bg-orange-500'
                        : 'bg-yellow-500'
                    )}
                  />
                </div>

                {/* 内容 */}
                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{group.time}</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 text-xs rounded-full',
                        group.count > 10
                          ? 'bg-red-500/10 text-red-500'
                          : group.count > 5
                          ? 'bg-orange-500/10 text-orange-500'
                          : 'bg-yellow-500/10 text-yellow-500'
                      )}
                    >
                      {group.count} errors
                    </span>
                  </div>

                  {/* 错误类型分布 */}
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(group.error_types).map(([type, count]) => (
                      <span
                        key={type}
                        className="px-2 py-0.5 text-xs bg-muted rounded"
                      >
                        {type}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 错误事件列表 */}
        {data.events.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-medium mb-3">Recent Errors</h3>
            <div className="space-y-1">
              {data.events.slice(0, 20).map((event, index) => (
                <button
                  key={index}
                  onClick={() => handleEventClick(event)}
                  className={cn(
                    'w-full flex items-start gap-3 p-2 rounded-md text-left transition-colors',
                    'hover:bg-muted',
                    selectedEvent === event && 'bg-muted'
                  )}
                >
                  {getErrorIcon(event.error_type)}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{event.content}</div>
                    <div className="text-xs text-muted-foreground">
                      {event.log_file}:{event.line_number} • {event.timestamp}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 上下文面板 */}
      {selectedEvent && (
        <div className="border-t border-border">
          <button
            onClick={() => {
              setSelectedEvent(null);
              setContext(null);
            }}
            className="w-full flex items-center justify-between p-3 hover:bg-muted"
          >
            <span className="text-sm font-medium">Context: {selectedEvent.log_file}:{selectedEvent.line_number}</span>
            {context ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {loadingContext ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : context ? (
            <div className="max-h-64 overflow-auto p-2 bg-muted/50">
              <pre className="text-xs font-mono">
                {context.context.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      'px-2 py-0.5',
                      line.is_target && 'bg-red-500/20 border-l-2 border-red-500'
                    )}
                  >
                    <span className="text-muted-foreground mr-2 select-none">
                      {String(line.line_number).padStart(4, ' ')}
                    </span>
                    {line.content}
                  </div>
                ))}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
