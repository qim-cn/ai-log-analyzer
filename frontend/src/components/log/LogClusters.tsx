/**
 * 日志聚类视图
 */

import { useState, useEffect } from 'react';
import { Layers, Send, Loader2 } from 'lucide-react';
import { clusterService, type LogCluster } from '@/services/clusterService';
import { cn } from '@/utils';

interface LogClustersProps {
  logId: string;
  onAnalyze?: (prompt: string) => void;
}

export function LogClusters({ logId, onAnalyze }: LogClustersProps) {
  const [clusters, setClusters] = useState<LogCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    const fetchClusters = async () => {
      setLoading(true);
      try {
        const data = await clusterService.getClusters(logId);
        setClusters(data.clusters);
      } catch (err) {
        console.error('获取聚类失败:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchClusters();
  }, [logId]);

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleAnalyzeSelected = () => {
    if (!onAnalyze || selected.size === 0) return;
    const selectedClusters = Array.from(selected).map((i) => clusters[i]);
    const prompt = `请分析以下日志错误模式：\n\n${selectedClusters
      .map(
        (c, i) =>
          `**模式 ${i + 1}** (${c.count} 次):\n\`\`\`\n${c.samples[0]}\n\`\`\``
      )
      .join('\n\n')}`;
    onAnalyze(prompt);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-sm">分析聚类中...</span>
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8 text-sm">
        未发现错误模式
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Layers size={16} className="text-primary" />
          <span>错误聚类</span>
          <span className="text-xs text-muted-foreground">({clusters.length} 种模式)</span>
        </div>
        {selected.size > 0 && (
          <button
            onClick={handleAnalyzeSelected}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground
                       rounded-lg text-xs hover:opacity-90"
          >
            <Send size={12} />
            分析选中 ({selected.size})
          </button>
        )}
      </div>

      <div className="space-y-2">
        {clusters.map((cluster, index) => (
          <div
            key={index}
            onClick={() => toggleSelect(index)}
            className={cn(
              'border border-border rounded-lg p-3 cursor-pointer transition-all',
              selected.has(index)
                ? 'border-primary bg-primary/5'
                : 'hover:bg-muted/50'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs px-1.5 py-0.5 rounded font-medium',
                      cluster.level === 'error'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-yellow-500/20 text-yellow-400'
                    )}
                  >
                    {cluster.level.toUpperCase()}
                  </span>
                  <span className="text-sm font-medium">{cluster.count} 次</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
                  {cluster.pattern}
                </div>
              </div>
            </div>

            {/* 样本 */}
            {cluster.samples.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground/70 font-mono bg-muted/30 rounded p-2">
                {cluster.samples[0].substring(0, 200)}
                {cluster.samples[0].length > 200 && '...'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
