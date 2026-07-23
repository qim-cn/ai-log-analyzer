/**
 * 设置弹窗 — AI配置 + 知识库（已解决路径 / Obsidian浏览目录）
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { X, RefreshCw, Loader2, BookOpen, Globe, Folder, FileText, ChevronRight, Plus, Bot, BellRing, ScrollText, Webhook, MessageSquare, ShieldCheck } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { obsidianService, type FileTreeNode } from '@/services/obsidianService';
import { RulesPanel } from '@/components/rules/RulesPanel';
import { AuditPanel } from '@/components/audit/AuditPanel';
import { WebhooksPanel } from '@/components/webhooks/WebhooksPanel';
import { QuickPromptsPanel } from './QuickPromptsPanel';
import { MaskingPatternsPanel } from './MaskingPatternsPanel';
import { cn } from '@/utils';

interface SettingsDialogProps { open: boolean; onClose: () => void; }
type SettingsTab = 'ai' | 'obsidian' | 'rules' | 'audit' | 'webhooks' | 'prompts' | 'masking';

/** 目录浏览器（独立实例） */
function DirBrowser({ show, onClose, onSelect, btnLabel }: {
  show: boolean; onClose: () => void;
  onSelect: (path: string) => void; btnLabel: string;
}) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState<string[]>([]);
  const initialized = useRef(false);

  const load = useCallback(async (relPath: string = '') => {
    setLoading(true); setError('');
    try {
      const d = await obsidianService.getFileTree(relPath || undefined);
      setTree(d.tree || []);
    } catch (err: any) { setError(err.message || '网络错误'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (show && !initialized.current) { setPath([]); load(''); initialized.current = true; } }, [show, load]);
  useEffect(() => { if (!show) initialized.current = false; }, [show]);

  if (!show) return null;

  const bc = ['Vault', ...path];

  return (
    <div className="border border-primary/30 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Globe size={10} />
          {bc.map((seg, i) => <span key={i} className="flex items-center gap-0.5">{i > 0 && <ChevronRight size={8} className="opacity-40" />}<span className={i === bc.length - 1 ? 'text-foreground font-medium' : ''}>{seg}</span></span>)}
        </div>
        <div className="flex gap-1">
          <button onClick={() => { setPath([]); load(''); }} className="p-0.5 hover:bg-muted rounded"><RefreshCw size={11} className="text-muted-foreground" /></button>
          <button onClick={onClose} className="p-0.5 hover:bg-muted rounded"><X size={11} className="text-muted-foreground" /></button>
        </div>
      </div>

      <div className="max-h-36 overflow-y-auto p-1">
        {path.length > 0 && (
          <button onClick={() => { const p = path.slice(0, -1); setPath(p); load(p.join('/')); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted text-left">
            <Folder size={13} className="text-muted-foreground" /><span className="text-[11px] text-muted-foreground">..</span>
          </button>
        )}
        {error ? <div className="text-center py-4 text-[11px] text-destructive">{error}</div>
        : loading ? <div className="text-center py-4 text-[11px] text-muted-foreground"><Loader2 size={14} className="animate-spin mx-auto mb-1" />加载中...</div>
        : tree.length === 0 ? <div className="text-center py-4 text-[11px] text-muted-foreground">此目录为空</div>
        : tree.map(node => (
          <button key={node.path}
            onClick={() => { if (node.type === 'folder') { setPath([...path, node.name]); load(node.path); } }}
            className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left group', node.type === 'folder' ? 'hover:bg-muted' : 'opacity-60')}>
            {node.type === 'folder' ? <><ChevronRight size={12} className="text-muted-foreground shrink-0 opacity-40 group-hover:opacity-100" /><Folder size={13} className="text-primary/70 shrink-0" /></>
            : <FileText size={13} className="text-muted-foreground shrink-0" />}
            <span className={cn("text-[11px] truncate", node.type === 'file' ? 'italic' : '')}>{node.name}</span>
          </button>
        ))}
      </div>

      <div className="border-t border-border px-3 py-2 flex justify-between items-center bg-muted/30">
        <span className="text-[10px] text-muted-foreground">当前: {path.length > 0 ? path.join(' / ') : '(根目录)'}</span>
        <button onClick={() => { onSelect(path.join('/')); onClose(); }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90">
          <Plus size={11} /> {btnLabel}
        </button>
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { aiSettings, models, fetchSettings, fetchModels, updateSettings } = useSettingsStore();
  const [tab, setTab] = useState<SettingsTab>('ai');

  // AI
  const [provider, setProvider] = useState<'openai' | 'ollama'>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);

  // Obsidian
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPass, setWebdavPass] = useState('');
  const [browsePaths, setBrowsePaths] = useState<string[]>([]);
  const [resolvedPath, setResolvedPath] = useState('');
  const [savingObsidian, setSavingObsidian] = useState(false);
  const [browseBrowserOpen, setBrowseBrowserOpen] = useState(false);
  const [resolvedBrowserOpen, setResolvedBrowserOpen] = useState(false);

  useEffect(() => { if (open) { fetchSettings(); fetchModels(); fetchObsidianSettings(); } }, [open, fetchSettings, fetchModels]);
  useEffect(() => { if (aiSettings) { setBaseUrl(aiSettings.base_url); setModel(aiSettings.model); setApiKey(''); } }, [aiSettings]);

  const fetchObsidianSettings = async () => {
    try {
      const s = await obsidianService.getSettings();
      setWebdavUrl(s.webdav_url); setWebdavUser(s.webdav_user);
      setBrowsePaths(s.browse_paths || []); setResolvedPath(s.resolved_path || '');
    } catch (err) { console.error(err); }
  };

  const handleSaveObsidian = async () => {
    setSavingObsidian(true);
    try {
      await obsidianService.updateSettings({ webdav_url: webdavUrl, webdav_user: webdavUser, webdav_pass: webdavPass || undefined, browse_paths: browsePaths, resolved_path: resolvedPath });
      await fetchObsidianSettings();
      alert('知识库配置已保存');
    } catch (err: any) { alert(`保存失败: ${err.message}`); }
    finally { setSavingObsidian(false); }
  };

  const handleSaveAI = async () => {
    setSaving(true);
    try { await updateSettings({ provider, base_url: baseUrl, api_key: apiKey || undefined, model }); onClose(); }
    catch (err: any) { alert(`保存失败: ${err.message}`); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-lg w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-base">设置</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg transition-colors"><X size={18} /></button>
        </div>

        {/* Tab 栏 —— 图标+文字，紧凑一致 */}
        <div className="flex border-b border-border px-3 gap-0.5 overflow-x-auto">
          {([
            ['ai', Bot, 'AI'],
            ['obsidian', BookOpen, '知识库'],
            ['rules', BellRing, '告警'],
            ['audit', ScrollText, '日志'],
            ['webhooks', Webhook, '通知'],
            ['prompts', MessageSquare, '快捷提问'],
            ['masking', ShieldCheck, '脱敏'],
          ] as const).map(([key, Icon, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 shrink-0 transition-colors rounded-t-md',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
              )}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {tab === 'ai' ? (
            <>
              {/* 提供商切换 */}
              <div className="flex gap-1 p-1 bg-muted rounded-xl">
                <button onClick={()=>setProvider('openai')} className={cn('flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',provider==='openai'?'bg-card text-foreground shadow-sm':'text-muted-foreground hover:text-foreground')}>OpenAI 兼容</button>
                <button onClick={()=>setProvider('ollama')} className={cn('flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',provider==='ollama'?'bg-card text-foreground shadow-sm':'text-muted-foreground hover:text-foreground')}>Ollama 本地</button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">API 地址</label>
                  <input type="text" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary/50 outline-none transition-all" />
                </div>
                {provider==='openai'&&<div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">API Key {aiSettings?.api_key_set&&<span className="normal-case text-[11px] text-success font-normal">· 已设置</span>}</label>
                  <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-..." className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary/50 outline-none transition-all" />
                </div>}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">模型</label>
                  <div className="flex gap-2 mb-2">
                    <select value={model} onChange={e=>setModel(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30">
                      <option value="">选择已有模型…</option>
                      {(models?((provider==='openai'?models.openai_models:models.ollama_models)||[]):[]).map((m:string)=><option key={m} value={m}>{m}</option>)}
                    </select>
                    <button onClick={fetchModels} className="px-3 py-2 bg-muted rounded-lg text-sm hover:bg-muted/80 transition-colors" title="刷新列表"><RefreshCw size={16}/></button>
                  </div>
                  <input type="text" value={model} onChange={e=>setModel(e.target.value)} placeholder="或手动输入模型名称…" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all" />
                </div>
              </div>
            </>
          ) : tab === 'obsidian' ? (
            <div className="space-y-4">
              {/* WebDAV */}
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2"><Globe size={14} className="text-primary/70" /><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">WebDAV 连接</span></div>
                <input type="text" value={webdavUrl} onChange={e=>setWebdavUrl(e.target.value)} placeholder="http://192.168.31.5:5005/Obsidian Vault" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all" />
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[11px] text-muted-foreground mb-1 block">用户名</label><input type="text" value={webdavUser} onChange={e=>setWebdavUser(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
                  <div><label className="text-[11px] text-muted-foreground mb-1 block">密码</label><input type="password" value={webdavPass} onChange={e=>setWebdavPass(e.target.value)} placeholder="留空不更新" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
                </div>
              </div>

              {/* Obsidian 浏览目录 */}
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2"><Folder size={14} className="text-primary/70" /><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">浏览目录</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {browsePaths.map(p => (
                    <span key={p} className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-[11px]">
                      <Folder size={11} /> {p || '(根目录)'}
                      <button onClick={() => setBrowsePaths(browsePaths.filter(x => x !== p))} className="hover:text-destructive"><X size={11} /></button>
                    </span>
                  ))}
                  {browsePaths.length === 0 && <span className="text-[11px] text-muted-foreground/50 italic">未设置，将显示全部</span>}
                </div>
                <button onClick={() => { setBrowseBrowserOpen(!browseBrowserOpen); setResolvedBrowserOpen(false); }}
                  className={cn("px-3 py-1.5 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 hover:bg-muted transition-colors", browseBrowserOpen && "bg-primary/10 border-primary/30")}>
                  <Globe size={12} /> {browseBrowserOpen ? '收起浏览器' : '浏览添加目录'}
                </button>
                <DirBrowser show={browseBrowserOpen} onClose={() => setBrowseBrowserOpen(false)}
                  onSelect={(p) => { if (!browsePaths.includes(p)) setBrowsePaths([...browsePaths, p]); }}
                  btnLabel="添加此目录" />
              </div>

              {/* 已解决保存目录 */}
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2"><BookOpen size={14} className="text-primary/70" /><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">已解决保存目录</span></div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">/resolved/</span>
                  <input type="text" value={resolvedPath} onChange={e => setResolvedPath(e.target.value)}
                    placeholder="留空 = 根目录" className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all" />
                  <button onClick={() => { setResolvedBrowserOpen(!resolvedBrowserOpen); setBrowseBrowserOpen(false); }}
                    className={cn("p-2 rounded-lg border border-border hover:bg-muted shrink-0 transition-colors", resolvedBrowserOpen && "bg-primary/10 border-primary/30")}>
                    <Globe size={14} />
                  </button>
                </div>
                <DirBrowser show={resolvedBrowserOpen} onClose={() => setResolvedBrowserOpen(false)}
                  onSelect={(p) => setResolvedPath(p)}
                  btnLabel="设为已解决目录" />
              </div>
            </div>
          ) : tab==='rules' ? <RulesPanel /> : tab==='audit' ? <AuditPanel /> : tab==='webhooks' ? <WebhooksPanel /> : tab==='prompts' ? <QuickPromptsPanel /> : tab==='masking' ? <MaskingPatternsPanel /> : null}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <span className="text-[11px] text-muted-foreground/50">
            {tab === 'ai' ? '修改后需保存生效' : tab === 'obsidian' ? '修改后需保存生效' : ''}
          </span>
          <div className="flex gap-2 ml-auto">
            {tab === 'ai' ? (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">取消</button>
                <button onClick={handleSaveAI} disabled={saving||!baseUrl} className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5">
                  {saving ? <Loader2 size={16} className="animate-spin"/> : null} 保存
                </button>
              </>
            ) : tab === 'obsidian' ? (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">取消</button>
                <button onClick={handleSaveObsidian} disabled={savingObsidian} className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5">
                  {savingObsidian ? <Loader2 size={16} className="animate-spin"/> : null} 保存
                </button>
              </>
            ) : (
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity">完成</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
