/**
 * KnowledgeGraph - 知识图谱可视化组件
 *
 * 使用 iframe 嵌入 pyvis 生成的 HTML
 */

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
import { knowledgeService } from '@/services/knowledgeService';
import { cn } from '@/utils/cn';

export const KnowledgeGraph: React.FC = () => {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fetchGraph = async () => {
    setLoading(true);
    setError(null);

    try {
      const graphHtml = await knowledgeService.getGraph();
      setHtml(graphHtml);
    } catch (err) {
      setError('Failed to load knowledge graph');
      console.error('Error fetching knowledge graph:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, []);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading knowledge graph...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-destructive">{error}</p>
        <button
          onClick={fetchGraph}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative border border-border rounded-lg overflow-hidden',
        isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'h-[600px]'
      )}
    >
      {/* Toolbar */}
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <button
          onClick={fetchGraph}
          className="p-2 bg-background/80 backdrop-blur-sm rounded-md hover:bg-background border border-border"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          onClick={toggleFullscreen}
          className="p-2 bg-background/80 backdrop-blur-sm rounded-md hover:bg-background border border-border"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Iframe */}
      {html && (
        <iframe
          srcDoc={html}
          className="w-full h-full border-0"
          title="Knowledge Graph"
          sandbox="allow-scripts"
        />
      )}
    </div>
  );
};
