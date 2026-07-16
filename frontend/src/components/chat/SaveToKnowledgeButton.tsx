/**
 * AI 解决方案确认组件
 * 显示在 AI 回复下方，询问用户问题是否解决
 * 已解决 → 保存到知识库；未解决 → 不保存
 */

import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { obsidianService } from '@/services/obsidianService';

interface SaveToKnowledgeButtonProps {
  logFilename?: string;
  logSummary?: string;
  logSnippet?: string;
  analysis: string;
}

export function SaveToKnowledgeButton({
  logFilename,
  logSummary,
  logSnippet,
  analysis,
}: SaveToKnowledgeButtonProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showTitleInput, setShowTitleInput] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const handleResolved = async () => {
    const finalTitle = title.trim() || logFilename?.replace(/\.[^.]+$/, '') + ' 故障分析' || `故障分析 ${new Date().toLocaleDateString('zh-CN')}`;

    setSaving(true);
    setError('');
    try {
      await obsidianService.save({
        title: finalTitle,
        log_summary: logSummary || '',
        log_snippet: logSnippet || '',
        analysis,
        resolved: true,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  if (dismissed) return null;

  if (saved) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 px-2 py-1">
        <CheckCircle2 size={12} />
        <span>已保存到知识库 → 已解决/</span>
      </div>
    );
  }

  return (
    <div className="mt-2 border border-border/60 rounded-xl bg-card/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-xs font-medium">该方案是否解决了问题？</span>
      </div>

      {showTitleInput && (
        <div className="mb-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="故障标题（可选）"
            className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
            onKeyDown={(e) => e.key === 'Enter' && handleResolved()}
          />
        </div>
      )}

      {error && <div className="text-xs text-destructive mb-2">{error}</div>}

      <div className="flex items-center gap-2">
        <button
          onClick={() => { setShowTitleInput(true); if (showTitleInput) handleResolved(); }}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium
                     hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          {saving ? '保存中...' : '已解决，保存'}
        </button>
        <button
          onClick={handleDismiss}
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
