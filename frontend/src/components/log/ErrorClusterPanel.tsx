/**
 * 错误聚类面板
 * 把刷屏的报错按归一化模式归组，按次数降序展示，
 * 可展开查看原始样例行和首末出现时间；
 * 每个聚类支持"问 AI"（发送聚类信息请 AI 分析根因）
 * 和"分析该时段"（按首末出现时间切取日志片段请 AI 分析）
 */

import { useEffect, useState } from 'react';
import { Layers, ChevronDown, ChevronUp, Loader2, Send, Clock } from 'lucide-react';
import { errorClusterService, type ErrorCluster } from '@/services/errorClusterService';
import { logService } from '@/services';
import { cn, sendPromptToChat } from '@/utils';

interface ErrorClusterPanelProps {
  logId: string;
  sessionId?: string;
}

/** 发送给 AI 的日志片段最大行数（超出只带前若干行并说明） */
const MAX_SLICE_LINES_IN_PROMPT = 100;

export function ErrorClusterPanel({ logId, sessionId }: ErrorClusterPanelProps) {
  const [clusters, setClusters] = useState<ErrorCluster[]>([]);
  const [totalErrorLines, setTotalErrorLines] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [openSample, setOpenSample] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

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

  // 功能：错误聚类一键问 AI
  const handleAskAI = async (cluster: ErrorCluster) => {
    if (busy) return;
    setBusy(true);
    try {
      const timeInfo =
        cluster.first_seen || cluster.last_seen
          ? `（首次: ${cluster.first_seen || '未知'}，最后: ${cluster.last_seen || '未知'}）`
          : '';
      const prompt = [
        `日志中有一个错误聚类刷屏，请分析根因和排查方向：`,
        ``,
        `- 归一化模式：\`${cluster.pattern}\``,
        `- 出现次数：${cluster.count} 次，占全部错误行的 ${(cluster.ratio * 100).toFixed(1)}%${timeInfo}`,
        `- 原始样例行：`,
        '```',
        cluster.sample,
        '```',
      ].join('\n');
      await sendPromptToChat(sessionId, prompt);
    } catch (err) {
      console.error('发送失败:', err);
    } finally {
      setBusy(false);
    }
  };

  // 功能：按聚类的首末出现时间切取日志片段，发给 AI 分析该时段
  const handleAnalyzeWindow = async (cluster: ErrorCluster) => {
    if (busy) return;
    setBusy(true);
    try {
      const start = cluster.first_seen || undefined;
      const end = cluster.last_seen || undefined;
      const slice = await logService.getContentSlice(logId, start, end);
      if (!slice.content) {
        console.warn('该时间窗内没有日志内容');
        return;
      }
      const lines = slice.content.split('\n');
      const capped = lines.length > MAX_SLICE_LINES_IN_PROMPT;
      const body = capped
        ? lines.slice(0, MAX_SLICE_LINES_IN_PROMPT).join('\n')
        : slice.content;
      const prompt = [
        `以下是 ${start || '开头'} ~ ${end || '结尾'} 时间窗内的日志片段`,
        `（命中 ${slice.matched_lines} 行${slice.truncated ? '，切片过大已被服务端截断' : ''}${capped ? `，仅带前 ${MAX_SLICE_LINES_IN_PROMPT} 行` : ''}）：`,
        ``,
        '```',
        body,
        '```',
        ``,
        `请分析这个时段内发生了什么、主要错误和排查方向。`,
      ].join('\n');
      await sendPromptToChat(sessionId, prompt);
    } catch (err) {
      console.error('分析时间窗失败:', err);
    } finally {
      setBusy(false);
    }
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

                  {/* 问 AI */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAskAI(cluster);
                    }}
                    disabled={busy}
                    className="shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary disabled:opacity-40"
                    title="问 AI：分析该聚类的根因和排查方向"
                  >
                    <Send size={12} />
                  </button>

                  {/* 分析该时段（有首末时间才可用） */}
                  {(cluster.first_seen || cluster.last_seen) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAnalyzeWindow(cluster);
                      }}
                      disabled={busy}
                      className="shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary disabled:opacity-40"
                      title="分析该时段：按首末出现时间切取日志片段发给 AI"
                    >
                      <Clock size={12} />
                    </button>
                  )}

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
