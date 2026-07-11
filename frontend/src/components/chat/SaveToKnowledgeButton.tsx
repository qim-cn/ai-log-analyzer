/**
 * 保存到知识库按钮
 * 显示在 AI 回复下方
 */

import { useState } from 'react';
import { BookOpen, Loader2, CheckCircle2 } from 'lucide-react';
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
  const [showDialog, setShowDialog] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!title.trim()) {
      setError('请输入标题');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await obsidianService.save({
        title: title.trim(),
        log_summary: logSummary || '',
        log_snippet: logSnippet || '',
        analysis,
      });
      setSaved(true);
      setShowDialog(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 自动生成标题
  const generateTitle = () => {
    if (logFilename) {
      const name = logFilename.replace(/\.[^.]+$/, '');
      return `${name} 故障分析`;
    }
    return `服务器日志分析 ${new Date().toLocaleDateString('zh-CN')}`;
  };

  if (saved) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-success px-2 py-1">
        <CheckCircle2 size={12} />
        <span>已保存到知识库</span>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => {
          setTitle(generateTitle());
          setShowDialog(true);
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground
                   hover:text-primary px-2 py-1 rounded-md hover:bg-primary/5
                   transition-colors"
      >
        <BookOpen size={12} />
        <span>保存到知识库</span>
      </button>

      {/* 弹窗 */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDialog(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-surface-lg w-full max-w-md mx-4 animate-slide-up">
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
              <h3 className="font-semibold text-sm">保存到 Obsidian 知识库</h3>
            </div>

            {/* Content */}
            <div className="px-5 pb-3 space-y-3">
              <div>
                <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
                  笔记标题
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="输入故障标题"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm
                             focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="text-[11px] text-muted-foreground/60">
                将自动提取日志摘要和 AI 分析结果，按模板格式保存
              </div>

              {error && (
                <div className="text-xs text-destructive">{error}</div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setShowDialog(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium
                           bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-medium
                           bg-primary text-primary-foreground hover:shadow-glow
                           active:scale-95 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin" />
                    保存中...
                  </span>
                ) : (
                  '保存'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
