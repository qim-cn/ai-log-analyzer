/**
 * 右侧日志面板
 * 显示当前会话关联的日志文件列表，点击查看内容
 * 支持点击行追加引用、右键分析选中内容
 * 显示相似历史日志、时间线、分析向导
 */

import { useEffect, useCallback, useState } from 'react';
import {
  FileText,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { LogUploader } from './LogUploader';
import { LogFileList } from './LogFileList';
import { LogViewer } from './LogViewer';
import { LogStats } from './LogStats';
import { SimilarLogsPanel } from './SimilarLogsPanel';
import { LogTimeline } from './LogTimeline';
import { useLogStore, useChatStore } from '@/stores';
import { cn } from '@/utils/cn';

type PanelTab = 'files' | 'timeline';

interface LogPanelProps {
  sessionId: string;
}

export function LogPanel({ sessionId }: LogPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('files');
  const [showSimilar, setShowSimilar] = useState(false);

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
      {/* Header with Tabs */}
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

        {/* Tab Buttons */}
        <div className="flex px-3 gap-1">
          <button
            onClick={() => setActiveTab('files')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t-md transition-colors',
              activeTab === 'files'
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FileText className="inline h-3 w-3 mr-1" />
            文件
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t-md transition-colors',
              activeTab === 'timeline'
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Clock className="inline h-3 w-3 mr-1" />
            时间线
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'files' ? (
        <>
          {/* Upload */}
          <div className="p-3 border-b border-border">
            <LogUploader sessionId={sessionId} />
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
      ) : (
        <div className="flex-1 overflow-hidden">
          <LogTimeline sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}
