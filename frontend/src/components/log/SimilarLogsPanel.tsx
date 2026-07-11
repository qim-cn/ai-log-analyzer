/**
 * SimilarLogsPanel - 显示相似历史日志
 *
 * 上传新日志后自动查询相似的历史问题
 */

import { useEffect, useState } from 'react';
import { FileText, Loader2, ChevronRight, Lightbulb } from 'lucide-react';
import { logService } from '@/services/logService';
import type { SimilarLog } from '@/types';
import { cn } from '@/utils/cn';


interface SimilarLogsPanelProps {
  logId: string;
  onLogSelect?: (logId: string) => void;
}

export const SimilarLogsPanel: React.FC<SimilarLogsPanelProps> = ({
  logId,
  onLogSelect,
}) => {
  const [similarLogs, setSimilarLogs] = useState<SimilarLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSimilarLogs = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await logService.findSimilar(logId, 5);
        setSimilarLogs(result.similar_logs);
      } catch (err) {
        setError('Failed to fetch similar logs');
        console.error('Error fetching similar logs:', err);
      } finally {
        setLoading(false);
      }
    };

    if (logId) {
      fetchSimilarLogs();
    }
  }, [logId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Searching similar logs...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (similarLogs.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No similar logs found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground px-1">
        Similar Historical Logs
      </h3>
      <div className="space-y-1">
        {similarLogs.map((log) => (
          <button
            key={log.log_id}
            onClick={() => onLogSelect?.(log.log_id)}
            className={cn(
              'w-full text-left p-3 rounded-lg border border-border',
              'hover:bg-accent hover:border-accent-foreground/20',
              'transition-colors duration-150',
              'group'
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {log.summary || 'Unknown issue'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Similarity: {(log.similarity * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {log.solution && (
              <div className="mt-2 flex items-start gap-1.5 text-xs">
                <Lightbulb className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                <span className="text-green-600 dark:text-green-400 line-clamp-2">
                  {log.solution}
                </span>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
