/**
 * 保存到知识库按钮（会话级）
 *
 * 点击后从整段对话+日志编译出结构化案例草稿（6 段），用户编辑、补"维修操作"
 * 后保存为已解决案例。实现"修复闭环"：实际修复动作回填进知识库。
 *
 * 防呆：若用户没填"维修操作"（常见场景--AI 给了建议、用户线下执行修好了，
 * 但"修好了"没回到对话里，AI 整理时该字段为空），点"存为已解决"不直接卡死，
 * 而是弹出对话中 AI 给过的建议/命令列表让用户勾选"实际是按哪个方法解决的"，
 * 可多选 + 补充实际结果。
 *
 * 另有"存为未解决"出口：还没修好但想留个分析草稿时用，维修操作非必填。
 */

import { useMemo, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, ClipboardList, Loader2, Save } from 'lucide-react';
import { CMD_PREFIX } from '@/utils/command';
import { obsidianService } from '@/services/obsidianService';
import { repairTemplateService, type RepairTemplate } from '@/services/repairTemplateService';
import { cn } from '@/utils';
import { Modal } from '@/components/ui/Modal';

interface SaveToKnowledgeButtonProps {
  sessionId: string;
  disabled?: boolean;
}

interface Draft {
  log: string;
  cause: string;
  suggestion: string;
  debug: string;
  process: string;
  repair: string;
}

const EMPTY_DRAFT: Draft = { log: '', cause: '', suggestion: '', debug: '', process: '', repair: '' };

// 去掉 markdown 列表前缀（"1. "、"- "、"> " 等），让候选项更干净
const cleanLine = (t: string) =>
  t.replace(/^[\s>*-]*\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').trim();

export function SaveToKnowledgeButton({ sessionId, disabled }: SaveToKnowledgeButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');

  const [model, setModel] = useState('');
  const [title, setTitle] = useState('');
  const [d, setD] = useState<Draft>(EMPTY_DRAFT);

  // "选择解决方法"防呆面板状态
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pickNote, setPickNote] = useState('');

  // 维修操作模板
  const [showTpl, setShowTpl] = useState(false);
  const [tplLoading, setTplLoading] = useState(false);
  const [templates, setTemplates] = useState<RepairTemplate[]>([]);

  // 从 AI 建议 + DEBUG 命令里拆出候选方法，供用户勾选（按文本去重，避免建议/命令重复）
  const candidates = useMemo(() => {
    const out: { src: string; text: string }[] = [];
    const seen = new Set<string>();
    const push = (src: string, text: string) => {
      const t = cleanLine(text);
      const key = t.toLowerCase();
      if (t && !/^[-=*`_~#>\s]+$/.test(t) && !seen.has(key)) {
        seen.add(key);
        out.push({ src, text: t });
      }
    };
    d.suggestion.split('\n').forEach(l => push('建议', l));
    d.debug.split('\n').forEach(l => push('命令', l));
    return out;
  }, [d.suggestion, d.debug]);

  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    setPicking(false);
    setPicked(new Set());
    setPickNote('');
    setSavedMsg('');
    setModel('');
    setTitle('');
    setD(EMPTY_DRAFT);
    try {
      const draft = await obsidianService.compileDraft(sessionId);
      setD({
        log: draft.log || '',
        cause: draft.cause || '',
        suggestion: draft.suggestion || '',
        debug: draft.debug || '',
        process: draft.process || '',
        repair: draft.repair || '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '编译草稿失败，可手动填写后保存');
    } finally {
      setLoading(false);
    }
  };

  /** 把命令文本中的命令行包裹成 \`\`\`command 代码块（相邻命令合一） */
  const formatDebugCommands = (raw: string): string => {
    if (!raw.trim()) return '(待补充)';
    const lines = raw.split('\n');
    const out: string[] = [];
    let pending: string[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      out.push('```command');
      out.push(...pending);
      out.push('```');
      pending = [];
    };
    for (const line of lines) {
      if (CMD_PREFIX.test(line.trim()) && line.trim().length <= 300) {
        pending.push(line);
      } else {
        flush();
        out.push(line);
      }
    }
    flush();
    return out.join('\n');
  };

  /** 报错日志段包裹成 \`\`\`log 代码块 */
  const formatLogBlock = (raw: string): string => {
    const t = raw.trim();
    if (!t) return '(无)';
    // 已有代码块则不重复包裹
    if (t.startsWith('```')) return t;
    return '```log\n' + t + '\n```';
  };

  const assembleBody = (repairOverride?: string) =>
    [
      '## 📋 测试报错日志',
      formatLogBlock(d.log),
      '',
      '## 🎯 故障原因',
      d.cause.trim() || '(待补充)',
      '',
      '## 💡 AI 建议',
      d.suggestion.trim() || '(待补充)',
      '',
      '## 🔧 DEBUG 诊断命令',
      formatDebugCommands(d.debug),
      '',
      '## 🔬 定位过程',
      d.process.trim() || '(待补充)',
      '',
      '## 🛠️ 维修操作',
      (repairOverride ?? d.repair).trim() || '(待补充)',
    ].join('\n');

  // resolved=true 存到 已解决/，resolved=false 存为草稿（未解决）
  const doSave = async (repairOverride?: string, resolved = true) => {
    setSaving(true);
    setError('');
    try {
      await obsidianService.save({
        title: title.trim(),
        model: model.trim(),
        body: assembleBody(repairOverride),
        session_id: sessionId,
        resolved,
      });
      setSavedMsg(
        resolved
          ? `已保存 -> 已解决/${model || '根'}/${title}`
          : '已保存为草稿（未解决）'
      );
      setTimeout(() => { setOpen(false); setSavedMsg(''); setPicking(false); }, 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 存为已解决：维修操作必填，空则弹选择面板
  const handleSave = async () => {
    if (!model.trim()) { setError('请输入机型'); return; }
    if (!title.trim()) { setError('请输入故障标题'); return; }
    if (!d.repair.trim()) {
      if (candidates.length === 0) {
        setError('请填写维修操作（实际怎么修好的），或点"存为未解决"先存草稿');
        return;
      }
      setError('');
      setPicked(new Set());
      setPickNote('');
      setPicking(true);
      return;
    }
    await doSave(undefined, true);
  };

  // 存为未解决：维修操作可空，直接存草稿
  const handleSaveUnresolved = async () => {
    if (!model.trim()) { setError('请输入机型'); return; }
    if (!title.trim()) { setError('请输入故障标题'); return; }
    await doSave(undefined, false);
  };

  const handleConfirmPick = async () => {
    const chosen = candidates.filter((_, i) => picked.has(i));
    if (chosen.length === 0 && !pickNote.trim()) {
      setError('请勾选实际解决问题的方法，或补充说明');
      return;
    }
    const parts: string[] = chosen.map(c => `【${c.src}】${c.text}`);
    if (pickNote.trim()) parts.push(pickNote.trim());
    const repairText = parts.join('\n');
    setD(prev => ({ ...prev, repair: repairText }));
    setPicking(false);
    await doSave(repairText, true);
  };

  const togglePick = (i: number) =>
    setPicked(prev => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });

  const close = () => {
    if (saving) return;
    setPicking(false);
    setOpen(false);
  };

  const handleLoadTemplates = async () => {
    setTplLoading(true);
    try {
      const data = await repairTemplateService.list(model.trim() || undefined);
      setTemplates(data.templates || []);
    } catch {
      setTemplates([]);
    } finally {
      setTplLoading(false);
    }
  };

  const handleInsertTemplate = (text: string) => {
    setD((prev) => ({ ...prev, repair: (prev.repair ? prev.repair + '\n' : '') + text }));
    setShowTpl(false);
  };

  const footer = picking ? (
    <div className="flex justify-between gap-2">
      <button onClick={() => { setPicking(false); setError(''); }} disabled={saving}
        className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 flex items-center gap-1.5">
        <ArrowLeft size={14} /> 返回编辑
      </button>
      <button onClick={handleConfirmPick} disabled={saving}
        className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        {saving ? '保存中...' : '确认并保存'}
      </button>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-2">
      <button onClick={handleSaveUnresolved} disabled={saving || loading}
        title="还没修好？先存个分析草稿，维修操作可留空"
        className="px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
        存为未解决
      </button>
      <div className="flex gap-2">
        <button onClick={close} disabled={saving}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-50">
          取消
        </button>
        <button onClick={handleSave} disabled={saving || loading}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {saving ? '保存中...' : '存为已解决'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
          'border border-dashed border-muted-foreground/25 text-muted-foreground',
          'hover:border-emerald-500/40 hover:text-emerald-600 hover:bg-emerald-500/5',
          'transition-all duration-150',
          'disabled:opacity-40 disabled:cursor-not-allowed'
        )}
        title="保存到知识库（编译整段对话为案例）"
      >
        <Save size={12} />
        <span>保存知识库</span>
      </button>

      <Modal
        open={open}
        onClose={close}
        closable={!saving}
        title={picking ? '选择实际解决方法' : '保存到知识库'}
        subtitle={
          picking
            ? '勾选对话中 AI 给过、且实际解决问题的方法，可多选 + 补充实际结果'
            : '从整段对话编译草稿，补"维修操作"后存档（修复闭环）'
        }
        footer={footer}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> AI 正在整理对话为案例草稿...
          </div>
        ) : picking ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground leading-relaxed">
              还没填"维修操作"（常见：AI 给了建议、你线下执行修好了，但结果没回到对话里）。
              下面是对话中 AI 给过的方法，请勾选<b className="text-foreground">实际解决问题</b>的，
              可多选；并在下方补充实际结果（如：执行后重跑通过 / 是否换件）。
            </div>

            {candidates.length === 0 ? (
              <div className="text-xs text-destructive">
                未从对话中解析出候选方法，请点"返回编辑"手填维修操作，或点"存为未解决"先存草稿。
              </div>
            ) : (
              <div className="space-y-1.5">
                {candidates.map((c, i) => {
                  const on = picked.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => togglePick(i)}
                      className={cn(
                        'w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg border transition-colors',
                        on
                          ? 'border-emerald-500/50 bg-emerald-500/5'
                          : 'border-border hover:bg-muted'
                      )}
                    >
                      <span className={cn(
                        'mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0',
                        on ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground/40'
                      )}>
                        {on && <Check size={11} className="text-white" />}
                      </span>
                      <span className="flex-1 text-xs">
                        <span className="text-[10px] text-muted-foreground/60 mr-1">[{c.src}]</span>
                        <span className={on ? 'text-foreground' : 'text-muted-foreground'}>
                          {c.text}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                补充实际结果
              </label>
              <textarea
                value={pickNote}
                onChange={e => setPickNote(e.target.value)}
                rows={2}
                placeholder="如：执行上述命令发现 Bay3 松动，重插拔并清洁金手指后重跑通过，未换件"
                className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              />
            </div>

            {error && <div className="text-xs text-destructive">{error}</div>}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="机型" required>
                <input type="text" value={model} onChange={e => setModel(e.target.value)}
                  placeholder="如: 7500S, 7DPC, R750"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </Field>
              <Field label="故障标题" required>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="如: HBA-PHY5-storcli2超时"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </Field>
            </div>

            <TextArea label="📋 原始日志" value={d.log} onChange={v => setD({ ...d, log: v })} rows={4} />
            <TextArea label="🎯 故障原因" value={d.cause} onChange={v => setD({ ...d, cause: v })} rows={3} />
            <TextArea label="💡 AI 建议" value={d.suggestion} onChange={v => setD({ ...d, suggestion: v })} rows={3} />
            <TextArea label="🔧 DEBUG 诊断命令" value={d.debug} onChange={v => setD({ ...d, debug: v })} rows={3} mono />
            <TextArea label="🔬 定位过程" value={d.process} onChange={v => setD({ ...d, process: v })} rows={3} />
            <TextArea label="🛠️ 维修操作" value={d.repair} onChange={v => setD({ ...d, repair: v })}
              placeholder="实际怎么修好的。留空点&quot;存为已解决&quot;可从 AI 建议勾选；或点&quot;存为未解决&quot;先存草稿" rows={3} />

            {/* 插入维修操作模板 */}
            <div>
              <button
                type="button"
                onClick={() => { if (!showTpl) handleLoadTemplates(); setShowTpl(!showTpl); }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              >
                <ClipboardList size={12} />
                {showTpl ? '收起模板' : '插入维修操作模板'}
              </button>
              {showTpl && (
                <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                  {tplLoading ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" /> 加载模板...
                    </div>
                  ) : templates.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      暂无模板（{model ? `机型 ${model} ` : ''}已解决案例积累后自动生成）
                    </div>
                  ) : (
                    templates.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleInsertTemplate(t.text)}
                        className="w-full text-left px-2 py-1 rounded-md text-xs hover:bg-muted transition-colors border border-border"
                      >
                        <span className="text-muted-foreground/50 text-[10px]">×{t.count}</span>{' '}
                        {t.text}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {error && <div className="text-xs text-destructive">{error}</div>}
            {savedMsg && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                <CheckCircle2 size={12} /> {savedMsg}
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

function TextArea({
  label, value, onChange, rows = 3, mono, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
        {label}
      </label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={`w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}
