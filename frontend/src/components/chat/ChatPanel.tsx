/**
 * 聊天面板组件
 * 集成日志上传、消息列表、输入框
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Copy, Check, Paperclip, FileText, GitCompareArrows } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { SaveToKnowledgeButton } from './SaveToKnowledgeButton';
import { AnomalyBanner } from './AnomalyBanner';
import { ThinkingBubble } from './ThinkingBubble';
import { ChatInput } from './ChatInput';
import { ExportButton } from '@/components/export/ExportButton';
import { ComparePanel } from '@/components/compare/ComparePanel';
import { useChatStore, useSessionStore, useLogStore, useQuickPromptStore } from '@/stores';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '@/constants';
import { cn, formatFileSize } from '@/utils';

interface ChatPanelProps {
  sessionId: string;
}

export function ChatPanel({ sessionId }: ChatPanelProps) {
  const {
    messages,
    loading,
    streaming,
    streamingContent,
    thinking,
    thinkingMessage,
    fetchMessages,
    sendMessage,
    clearMessages,
    abortStreaming,
  } = useChatStore();

  const { logFiles, fetchLogs, uploadLog, uploading } = useLogStore();

  const quickPrompts = useQuickPromptStore((s) => s.prompts);

  const sessions = useSessionStore((s) => s.sessions);
  const currentSession = sessions.find((s) => s.id === sessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    // 切换会话时取消上一个会话仍在进行的流式回复，避免旧 chunk 串到新会话
    abortStreaming();
    clearMessages();
    fetchMessages(sessionId);
    fetchLogs(sessionId);
  }, [sessionId, fetchMessages, clearMessages, fetchLogs, abortStreaming]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSend = async (content: string) => {
    try {
      await sendMessage(sessionId, content);
    } catch (error) {
      console.error('发送失败:', error);
    }
  };

  // 文件上传
  const handleFileUpload = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ALLOWED_FILE_TYPES.join(',');
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE) {
        alert('文件大小超过 50MB 限制');
        return;
      }
      try {
        await uploadLog(sessionId, file);
      } catch (err) {
        alert(`上传失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    };
    input.click();
  }, [sessionId, uploadLog]);

  // 复制最后一条回复
  const [copied, setCopied] = React.useState(false);
  const handleCopyLast = useCallback(async () => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    if (lastAssistant) {
      await navigator.clipboard.writeText(lastAssistant.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [messages]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur-sm flex items-center">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {currentSession?.title || '对话'}
          </div>
          <div className="text-[11px] text-muted-foreground/60">
            {messages.length} 条消息{logFiles.length > 0 && ` · ${logFiles.length} 个日志文件`}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyLast}
            disabled={messages.length === 0}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors disabled:opacity-30"
            title="复制最后一条回复"
          >
            {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
          </button>
          <ExportButton sessionId={sessionId} />
          {logFiles.length >= 2 && (
            <button
              onClick={() => setShowCompare(!showCompare)}
              className={cn(
                'p-1.5 hover:bg-muted rounded-lg transition-colors',
                showCompare && 'bg-primary/10 text-primary'
              )}
              title="日志对比"
            >
              <GitCompareArrows size={15} />
            </button>
          )}
        </div>
      </div>

      <AnomalyBanner sessionId={sessionId} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            加载中...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center animate-fade-in max-w-md mx-4">
              <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-primary/20 to-accent/20 rounded-2xl flex items-center justify-center">
                <span className="text-2xl">💬</span>
              </div>
              <div className="text-base font-semibold mb-2">开始提问</div>
              <div className="text-sm text-muted-foreground mb-5 leading-relaxed">
                上传日志文件后，可以问 AI 关于错误原因、根因分析、排查步骤等问题
              </div>
            </div>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {thinking && !streamingContent && (
              <ThinkingBubble message={thinkingMessage} />
            )}

            {streaming && streamingContent && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  session_id: sessionId,
                  role: 'assistant',
                  content: streamingContent,
                  created_at: new Date().toISOString(),
                }}
                isStreaming
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 已上传文件条 */}
      {logFiles.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center gap-2 overflow-x-auto">
          <FileText size={13} className="text-muted-foreground shrink-0" />
          {logFiles.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground whitespace-nowrap"
            >
              {f.filename}
              <span className="text-[10px] opacity-50">{formatFileSize(f.file_size)}</span>
            </span>
          ))}
        </div>
      )}

      {/* 对比面板 */}
      {showCompare && (
        <div className="border-t border-border bg-card/80 max-h-[300px] overflow-y-auto">
          <ComparePanel
            logFiles={logFiles}
            onAnalyze={(summary) => handleSend(`请分析以下日志对比结果：\n\n${summary}`)}
          />
        </div>
      )}

      {/* Input 区域 */}
      <div className="border-t border-border bg-card/80 backdrop-blur-sm">
        {/* 快捷操作 + 上传按钮 */}
        <div className="px-4 pt-3 flex items-center gap-2 flex-wrap">
          {/* 上传按钮 */}
          <button
            onClick={handleFileUpload}
            disabled={uploading}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
              'border border-dashed border-muted-foreground/25 text-muted-foreground',
              'hover:border-primary/40 hover:text-primary hover:bg-primary/5',
              'transition-all duration-150',
              uploading && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Paperclip size={12} />
            <span>{uploading ? '上传中...' : '上传日志'}</span>
          </button>

          {/* 保存知识库按钮（紧挨上传日志） */}
          <SaveToKnowledgeButton sessionId={sessionId} disabled={messages.length === 0} />

          {/* 自定义快捷提问（在设置里管理），点击即发送 */}
          {quickPrompts.map((qp) => (
            <button
              key={qp.id}
              onClick={() => handleSend(qp.prompt)}
              disabled={streaming}
              title={qp.prompt}
              className={cn(
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium',
                'bg-muted text-muted-foreground whitespace-nowrap',
                'hover:bg-primary/10 hover:text-primary transition-all duration-150',
                streaming && 'opacity-50 cursor-not-allowed'
              )}
            >
              {qp.label}
            </button>
          ))}
        </div>

        {/* 输入框 */}
        <ChatInput onSend={handleSend} disabled={loading} streaming={streaming} />
      </div>
    </div>
  );
}
