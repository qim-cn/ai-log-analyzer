/**
 * 右侧日志面板
 * 显示当前会话关联的日志文件列表，点击查看内容
 * 支持点击行追加引用、右键分析选中内容
 * 显示日志统计、脱敏映射入口、错误聚类、相似历史日志
 */

import { useEffect, useCallback, useState } from 'react';
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Microscope,
} from 'lucide-react';
import { LogUploader } from './LogUploader';
import { LogFileList } from './LogFileList';
import { LogViewer } from './LogViewer';
import { LogStats } from './LogStats';
import { ErrorClusterPanel } from './ErrorClusterPanel';
import { MaskingMapButton } from './MaskingMapButton';
import { SimilarLogsPanel } from './SimilarLogsPanel';
import { useLogStore, useChatStore } from '@/stores';
import { useInvestigationStore } from '@/stores/investigationStore';

interface LogPanelProps {
  sessionId: string;
}

export function LogPanel({ sessionId }: LogPanelProps) {
  const [showSimilar, setShowSimilar] = useState(false);
  const startInvestigation = useInvestigationStore((s) => s.start);

  const {
    logFiles,
    selectedLogId,
    selectedLogContent,
    fetchLogs,
    deleteLog,
    selectLog,
  } = useLogStore();

  const { setInputQuote } = useChatStore();

  useEffect(() => {
    fetchLogs(sessionId);
  }, [sessionId, fetchLogs]);

  const selectedFile = logFiles.find((f) => f.id === selectedLogId);

  // 点击日志行 → 追加到输入框作为引用
  const handleLineClick = useCallback(
    (lineNumber: number, lineContent: string) => {
      const quote = `> [${selectedFile?.filename}:${lineNumber}] ${lineContent}\n\n`;
      setInputQuote(quote);
    },
    [selectedFile?.filename, setInputQuote]
  );

  // 右键"分析选中日志" → 直接发送给 AI
  const handleAnalyzeSelection = useCallback(
    (selectedText: string) => {
      const prompt = `请分析以下日志内容：\n\n\`\`\`\n${selectedText}\n\`\`\``;
      window.dispatchEvent(
        new CustomEvent('analyze-log', { detail: { prompt } })
      );
    },
    []
  );


  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="border-b border-border">
        <div className="px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">日志分析</span>
            <span className="text-xs text-muted-foreground">
              {logFiles.length} 个文件
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <>
          {/* Upload + 深度排查入口 */}
          <div className="p-3 border-b border-border space-y-2">
            <LogUploader sessionId={sessionId} />
            {logFiles.length > 0 && (
              <button
                onClick={() => startInvestigation(sessionId)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Microscope size={13} />
                深度排查
              </button>
            )}
          </div>

          {/* File List or Viewer */}
          {selectedLogId && selectedLogContent ? (
            <LogViewer
              content={selectedLogContent}
              filename={selectedFile?.filename || ''}
              onClose={() => selectLog(null)}
              onLineClick={handleLineClick}
              onAnalyzeSelection={handleAnalyzeSelection}
            />
          ) : (
            <div className="flex-1 overflow-y-auto p-2">
              <LogFileList
                files={logFiles}
                selectedId={selectedLogId}
                onSelect={selectLog}
                onDelete={deleteLog}
              />
            </div>
          )}

          {/* Stats Panel */}
          {selectedLogId && !selectedLogContent && selectedFile && (
            <LogStats logId={selectedLogId} filename={selectedFile.filename} />
          )}

          {/* Masking Map Entry（仅有脱敏映射时显示） */}
          {selectedLogId && !selectedLogContent && selectedFile && (
            <MaskingMapButton logFile={selectedFile} />
          )}

          {/* Error Cluster Panel */}
          {selectedLogId && !selectedLogContent && (
            <ErrorClusterPanel logId={selectedLogId} sessionId={sessionId} />
          )}

          {/* Similar Logs Toggle */}
          {selectedLogId && !selectedLogContent && (
            <div className="border-t border-border">
              <button
                onClick={() => setShowSimilar(!showSimilar)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted"
              >
                <span className="text-sm font-medium">相似历史日志</span>
                {showSimilar ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {showSimilar && (
                <div className="p-3 pt-0">
                  <SimilarLogsPanel logId={selectedLogId} />
                </div>
              )}
            </div>
          )}
      </>
    </div>
  );
}
