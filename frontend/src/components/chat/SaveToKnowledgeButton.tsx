/**
 * 保存到知识库按钮
 * 用户填写：机型 + 故障标题 + 维修操作（必填）
 */

import { useState } from 'react';
import { CheckCircle2, Loader2, Save, X } from 'lucide-react';
import { obsidianService } from '@/services/obsidianService';

interface SaveToKnowledgeButtonProps {
  logFilename?: string;
  logSummary?: string;
  logSnippet?: string;
  analysis: string;
  sessionId?: string;
}

export function SaveToKnowledgeButton({
  logSummary, logSnippet, analysis, sessionId,
}: SaveToKnowledgeButtonProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [model, setModel] = useState('');
  const [title, setTitle] = useState('');
  const [repairNotes, setRepairNotes] = useState('');
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!model.trim()) { setError('请输入机型'); return; }
    if (!title.trim()) { setError('请输入故障标题'); return; }
    if (!repairNotes.trim()) { setError('请填写维修操作'); return; }
    setSaving(true); setError('');
    try {
      await obsidianService.save({
        title: title.trim(),
        model: model.trim(),
        log_summary: logSummary || '',
        log_snippet: logSnippet || '',
        analysis,
        repair_notes: repairNotes.trim(),
        session_id: sessionId || '',
        resolved: true,
      });
      setSaved(true);
      setTimeout(() => { setShowForm(false); setSaved(false); }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <>
      <button
        onClick={() => {
          setModel(''); setTitle(''); setRepairNotes(''); setShowForm(true);
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground
                   hover:text-primary px-2 py-1 rounded-md hover:bg-primary/5 transition-colors"
      >
        <Save size={12} />
        <span>保存到知识库</span>
      </button>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-lg w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="font-semibold text-sm">保存到已解决知识库</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X size={14} className="text-muted-foreground" /></button>
            </div>

            <div className="px-5 pb-3 space-y-3">
              {/* 机型 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  机型 <span className="text-destructive">*</span>
                </label>
                <input type="text" value={model} onChange={e => setModel(e.target.value)}
                  placeholder="如: 7500S, 7DPC, R750"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs
                             focus:outline-none focus:ring-2 focus:ring-primary/30" autoFocus />
              </div>

              {/* 故障标题 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  故障标题 <span className="text-destructive">*</span>
                </label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="如: HBA-PHY5-storcli2超时"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs
                             focus:outline-none focus:ring-2 focus:ring-primary/30"
                  onKeyDown={e => e.key === 'Enter' && handleSave()} />
              </div>

              {/* 维修操作（必填） */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  维修操作 <span className="text-destructive">*</span>
                  <span className="text-[10px] opacity-60">（必填：实际处理过程）</span>
                </label>
                <textarea value={repairNotes} onChange={e => setRepairNotes(e.target.value)}
                  placeholder="如：重插拔Bay3背板连接器并清洁金手指后重跑测试通过，未更换任何部件"
                  rows={3}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs
                             focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
              </div>

              {error && <div className="text-xs text-destructive">{error}</div>}
              {saved && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <CheckCircle2 size={12} /> 已保存 → 已解决/{model || '根'}/{title}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground
                           hover:shadow-glow active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
