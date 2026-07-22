/**
 * AI Agent 自主排查视图
 * 上半部分：步骤时间线（可折叠卡片，状态图标 + 进度消息）
 * 下半部分：流式根因报告（MarkdownRenderer 渲染）
 */

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Microscope,
  SkipForward,
  X,
  XCircle,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/knowledge/MarkdownRenderer';
import { useInvestigationStore, type StepState } from '@/stores/investigationStore';

function StepIcon({ status }: { status: StepState['status'] }) {
  if (status === 'running') {
    return <Loader2 size={15} className="animate-spin text-primary shrink-0" />;
  }
  if (status === 'ok') {
    return <CheckCircle2 size={15} className="text-success shrink-0" />;
  }
  if (status === 'skipped') {
    return <SkipForward size={15} className="text-muted-foreground shrink-0" />;
  }
  return <XCircle size={15} className="text-warning shrink-0" />;
}

function StepCard({ step }: { step: StepState }) {
  const [expanded, setExpanded] = useState(step.status === 'running');

  return (
    <div className="border border-border rounded-lg bg-card/60 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <StepIcon status={step.status} />
        <span className="text-xs font-medium flex-1 whitespace-nowrap">
          步骤 {step.step} · {step.title}
        </span>
        {step.summary && (
          <span className="text-[11px] text-muted-foreground truncate max-w-[45%]">
            {step.summary}
          </span>
        )}
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {expanded && step.messages.length > 0 && (
        <div className="px-3 pb-2 pt-1.5 space-y-0.5 border-t border-border/50">
          {step.messages.map((m, i) => (
            <div key={i} className="text-[11px] text-muted-foreground leading-relaxed">
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function InvestigationView() {
  const { steps, report, running, error, cancel, close } = useInvestigationStore();

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="max-w-2xl mx-auto space-y-3">
        {/* 标题栏 */}
        <div className="flex items-center gap-2">
          <Microscope size={16} className="text-primary" />
          <span className="text-sm font-semibold flex-1">AI 自主排查</span>
          {running ? (
            <button
              onClick={cancel}
              className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-muted transition-colors"
            >
              取消
            </button>
          ) : (
            <button
              onClick={close}
              className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-muted transition-colors inline-flex items-center gap-1"
            >
              <X size={12} /> 关闭
            </button>
          )}
        </div>

        {/* 步骤时间线 */}
        <div className="space-y-2">
          {steps.map((s) => (
            <StepCard key={s.step} step={s} />
          ))}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* 流式报告 */}
        {report && (
          <div className="border border-border rounded-lg bg-card p-4">
            <MarkdownRenderer content={report} />
            {running && (
              <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
