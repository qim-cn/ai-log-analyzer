/**
 * AI 解决方案确认组件
 * 显示在 AI 回复下方：
 * 1. 询问是否解决
 * 2. 解决 → 弹出机型确认+故障标题
 * 3. 自动从日志中提取机型
 */

import { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, Loader2, Monitor } from 'lucide-react';
import { obsidianService } from '@/services/obsidianService';

interface SaveToKnowledgeButtonProps {
  logFilename?: string;
  logSummary?: string;
  logSnippet?: string;
  analysis: string;
}

/** 从日志片段中尝试提取机型 */
function detectModel(log: string): string {
  // 模式1: [root@host-model-xxx rt]#
  const hostMatch = log.match(/\[root@[\w-]+-(\d+[\w-]*)\s/);
  if (hostMatch) return hostMatch[1];

  // 模式2: 常见服务器型号关键字
  const modelPatterns = [
    /\b(R\d{3,4}[a-z]?\w*)\b/i,       // R750, R740xd, R7525
    /\b(DL\d{3,4}\w*)\b/i,            // DL380, DL360 Gen10
    /\b(SR\d{3,4}\w*)\b/i,            // SR650, SR550
    /\b(NF\d{3,4}\w*)\b/i,            // NF5280M5
    /\b(HPE\s*\w+\s*Gen\d+)\b/i,      // HPE ProLiant Gen10
    /\b(PowerEdge\s*\w+)\b/i,         // PowerEdge R750
    /\b(7\d{3}S?\w*)\b/i,             // 7500, 7500S
    /\b(ThinkSystem\s*\w+)\b/i,       // ThinkSystem SR650
  ];
  for (const p of modelPatterns) {
    const m = log.match(p);
    if (m) return m[1];
  }

  // 模式3: 文件路径中的型号 /dfcxact/.../xuanwu30/
  const pathMatch = log.match(/\/(\w+\d{2,3})\//);
  if (pathMatch) return pathMatch[1];

  return '';
}

export function SaveToKnowledgeButton({
  logFilename,
  logSummary,
  logSnippet,
  analysis,
}: SaveToKnowledgeButtonProps) {
  const [step, setStep] = useState<'ask' | 'form' | 'saving' | 'done' | 'dismissed'>('ask');
  const [model, setModel] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const detectedModel = useMemo(() => detectModel(logSnippet || ''), [logSnippet]);

  const handleSave = async () => {
    if (!model.trim()) { setError('请输入机型'); return; }
    if (!title.trim()) { setError('请输入故障原因'); return; }

    setStep('saving');
    setError('');
    try {
      await obsidianService.save({
        title: title.trim(),
        model: model.trim(),
        log_summary: logSummary || '',
        log_snippet: logSnippet || '',
        analysis,
        resolved: true,
      });
      setStep('done');
      setTimeout(() => setStep('dismissed'), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      setStep('form');
    }
  };

  if (step === 'dismissed') return null;

  if (step === 'done') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 px-2 py-1">
        <CheckCircle2 size={12} />
        <span>已保存 → 已解决/{model}/{title}</span>
      </div>
    );
  }

  if (step === 'saving') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1">
        <Loader2 size={12} className="animate-spin" />
        <span>保存中...</span>
      </div>
    );
  }

  // step === 'form' — 机型 + 标题填写
  if (step === 'form') {
    return (
      <div className="mt-2 border border-emerald-500/30 rounded-xl bg-card/70 p-3 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <Monitor size={13} className="text-primary" />
          <span className="text-xs font-medium">保存到已解决知识库</span>
        </div>

        {/* 机型 */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">机型</label>
          <input
            type="text" value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={detectedModel ? `检测到: ${detectedModel}` : '如: 7500S, R750'}
            className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
            autoFocus
          />
          {detectedModel && model !== detectedModel && (
            <button
              onClick={() => setModel(detectedModel)}
              className="text-[10px] text-primary hover:underline mt-0.5"
            >
              使用检测到的机型: {detectedModel}
            </button>
          )}
        </div>

        {/* 故障原因(标题) */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">故障原因</label>
          <input
            type="text" value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如: HBA-PHY5-storcli2超时"
            className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium
                       hover:bg-emerald-700 active:scale-95 transition-all"
          >
            <CheckCircle2 size={12} /> 确认保存
          </button>
          <button
            onClick={() => setStep('ask')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs
                       hover:bg-muted/80 active:scale-95 transition-all"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  // step === 'ask' — 是否解决
  return (
    <div className="mt-2 border border-border/60 rounded-xl bg-card/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-xs font-medium">该方案是否解决了问题？</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setModel(detectedModel);
            setTitle(logFilename?.replace(/\.[^.]+$/, '') + ' 故障' || '');
            setStep('form');
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium
                     hover:bg-emerald-700 active:scale-95 transition-all"
        >
          <CheckCircle2 size={12} />
          已解决，保存
        </button>
        <button
          onClick={() => setStep('dismissed')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium
                     hover:bg-muted/80 active:scale-95 transition-all"
        >
          <XCircle size={12} />
          未解决
        </button>
      </div>
    </div>
  );
}
