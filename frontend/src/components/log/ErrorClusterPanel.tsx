/**
 * 错误聚类面板
 * 把刷屏的报错按归一化模式归组，按次数降序展示，
 * 可展开查看原始样例行和首末出现时间
 */

import { useEffect, useState } from 'react';
import { Layers, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { errorClusterService, type ErrorCluster } from '@/services/errorClusterService';
import { cn } from '@/utils';

interface ErrorClusterPanelProps {
  logId: string;
}

export function ErrorClusterPanel({ logId }: ErrorClusterPanelProps) {
  const [clusters, setClusters] = useState<ErrorCluster[]>([]);
  const [totalErrorLines, setTotalErrorLines] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [openSample, setOpenSample] = useState<Set<number>>(new Set());

  useEffect(() => {
    const fetchClusters = async () => {
      setLoading(true);
      try {
        const data = await errorClusterService.getErrorClusters(logId);
        setClusters(data.clusters);
        setTotalErrorLines(data.total_error_lines);
      } catch (err) {
        console.error('获取错误聚类失败:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchClusters();
  }, [logId]);

  const toggleSample = (index: number) => {
    setOpenSample((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="border-t border-border">
      {/* Toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-sm
                   hover:bg-accent transition-colors"
      >
        <Layers size={14} />
        <span>错误聚类</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {loading ? '分析中...' : `${clusters.length} 种模式 / ${totalErrorLines} 行错误`}
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 size={16} className="animate-spin mr-2" />
              <span className="text-sm">分析聚类中...</span>
            </div>
          ) : clusters.length === 0 ? (
            <div className="text-center text-muted-foreground py-6 text-sm">
              未发现错误模式
            </div>
          ) : (
            clusters.map((cluster, index) => (
              <div
                key={index}
                className="border border-border rounded-lg p-2.5 text-sm"
              >
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => toggleSample(index)}
                >
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-red-500/20 text-red-400">
                    {cluster.count} 次
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {(cluster.ratio * 100).toFixed(1)}%
                  </span>
                  <span className="flex-1 min-w-0 text-xs font-mono truncate text-muted-foreground">
                    {cluster.pattern}
                  </span>
                  {openSample.has(index) ? (
                    <ChevronUp size={12} className="shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                  )}
                </div>

                {openSample.has(index) && (
                  <div className="mt-2 space-y-1">
                    {(cluster.first_seen || cluster.last_seen) && (
                      <div className="text-xs text-muted-foreground">
                        {cluster.first_seen && `首次: ${cluster.first_seen}`}
                        {cluster.first_seen && cluster.last_seen && ' · '}
                        {cluster.last_seen && `最后: ${cluster.last_seen}`}
                      </div>
                    )}
                    <div
                      className={cn(
                        'text-xs font-mono bg-muted/30 rounded p-2',
                        'text-muted-foreground/70 break-all'
                      )}
                    >
                      {cluster.sample}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
