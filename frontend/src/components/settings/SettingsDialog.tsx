/**
 * 设置弹窗 — AI配置 + 知识库（已解决路径 / Obsidian浏览目录）
 */

import { useEffect, useState, useCallback } from 'react';
import { X, RefreshCw, Loader2, BookOpen, Globe, Folder, FileText, ChevronRight, Plus } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { obsidianService, type FileTreeNode } from '@/services/obsidianService';
import { RulesPanel } from '@/components/rules/RulesPanel';
import { AuditPanel } from '@/components/audit/AuditPanel';
import { WebhooksPanel } from '@/components/webhooks/WebhooksPanel';
import { cn } from '@/utils';

interface SettingsDialogProps { open: boolean; onClose: () => void; }
type SettingsTab = 'ai' | 'obsidian' | 'rules' | 'audit' | 'webhooks';

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

  // 目录浏览器
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserTarget, setBrowserTarget] = useState<'browse' | 'resolved'>('browse');
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState('');
  const [currentPath, setCurrentPath] = useState<string[]>([]);

  const fetchTree = useCallback(async (relPath: string = '') => {
    setTreeLoading(true); setTreeError('');
    try {
      const r = await fetch(`/api/obsidian/tree${relPath ? `?path=${encodeURIComponent(relPath)}` : ''}`);
      const d = await r.json();
      if (d.code === 0) setTree(d.data?.tree || []);
      else setTreeError(d.message || '加载失败');
    } catch (err: any) { setTreeError(err.message || '网络错误'); }
    finally { setTreeLoading(false); }
  }, []);

  useEffect(() => { if (showBrowser) { setCurrentPath([]); fetchTree(''); } }, [showBrowser, fetchTree]);

  const enterFolder = (node: FileTreeNode) => {
    if (node.type !== 'folder') return;
    setCurrentPath([...currentPath, node.name]);
    fetchTree(node.path);
  };

  const goUp = () => {
    const p = currentPath.slice(0, -1); setCurrentPath(p);
    fetchTree(p.join('/'));
  };

  // 添加当前目录到浏览列表
  const addBrowsePath = () => {
    const p = currentPath.length > 0 ? currentPath.join('/') : '';
    if (!browsePaths.includes(p)) setBrowsePaths([...browsePaths, p]);
  };

  const selectResolvedPath = () => {
    const p = currentPath.length > 0 ? currentPath.join('/') : '';
    setResolvedPath(p);
    setShowBrowser(false);
    setCurrentPath([]);
  };

  const selectCurrentAction = () => {
    if (browserTarget === 'resolved') selectResolvedPath();
    else addBrowsePath();
  };

  const removeBrowsePath = (p: string) => setBrowsePaths(browsePaths.filter(x => x !== p));

  const breadcrumb = ['Vault', ...currentPath];

  // 加载
  useEffect(() => {
    if (open) { fetchSettings(); fetchModels(); fetchObsidianSettings(); }
  }, [open, fetchSettings, fetchModels]);

  useEffect(() => {
    if (aiSettings) { setBaseUrl(aiSettings.base_url); setModel(aiSettings.model); setApiKey(''); }
  }, [aiSettings]);

  const fetchObsidianSettings = async () => {
    try {
      const s = await obsidianService.getSettings();
      setWebdavUrl(s.webdav_url);
      setWebdavUser(s.webdav_user);
      setBrowsePaths(s.browse_paths || []);
      setResolvedPath(s.resolved_path || '');
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
    try {
      await updateSettings({ provider, base_url: baseUrl, api_key: apiKey || undefined, model });
      onClose();
    } catch (err: any) { alert(`保存失败: ${err.message}`); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-lg w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm">设置</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5">
          {(['ai','obsidian','rules','audit','webhooks'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {t === 'ai' ? 'AI 配置' : t === 'obsidian' ? <><BookOpen size={14} />知识库</> : t === 'rules' ? '告警' : t === 'audit' ? '日志' : '通知'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'ai' ? (
            <>
              <div className="flex gap-2">
                <button onClick={() => setProvider('openai')} className={cn('flex-1 px-3 py-2 rounded-lg text-sm font-medium', provider === 'openai' ? 'bg-primary text-primary-foreground' : 'bg-secondary')}>OpenAI 兼容</button>
                <button onClick={() => setProvider('ollama')} className={cn('flex-1 px-3 py-2 rounded-lg text-sm font-medium', provider === 'ollama' ? 'bg-primary text-primary-foreground' : 'bg-secondary')}>Ollama 本地</button>
              </div>
              <div><label className="text-sm font-medium mb-1.5 block">API 地址</label><input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" /></div>
              {provider === 'openai' && (
                <div><label className="text-sm font-medium mb-1.5 block">API Key {aiSettings?.api_key_set && <span className="text-xs text-muted-foreground">(已设置)</span>}</label><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" /></div>
              )}
              <div><label className="text-sm font-medium mb-1.5 block">模型</label>
                <div className="flex gap-2"><select value={model} onChange={e => setModel(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm"><option value="">选择...</option>{(models ? (provider==='openai' ? (models.openai_models || []) : (models.ollama_models || [])) : []).map((m: string) => <option key={m} value={m}>{m}</option>)}</select><button onClick={fetchModels} className="px-2 py-2 bg-secondary rounded-lg"><RefreshCw size={16} /></button></div>
                <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="或手动输入" className="w-full mt-2 px-3 py-2 rounded-lg border border-input bg-background text-sm" />
              </div>
            </>
          ) : tab === 'obsidian' ? (
            <>
              <div className="flex items-center gap-2 mb-2"><BookOpen size={16} className="text-primary" /><span className="text-sm font-medium">Obsidian 知识库配置</span></div>

              {/* WebDAV 连接 */}
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="text-xs font-medium text-muted-foreground">WebDAV 连接</div>
                <input type="text" value={webdavUrl} onChange={e => setWebdavUrl(e.target.value)} placeholder="http://192.168.31.5:5005/Obsidian Vault" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={webdavUser} onChange={e => setWebdavUser(e.target.value)} placeholder="用户名" className="px-3 py-2 rounded-lg border border-input bg-background text-sm" />
                  <input type="password" value={webdavPass} onChange={e => setWebdavPass(e.target.value)} placeholder="密码（留空不更新）" className="px-3 py-2 rounded-lg border border-input bg-background text-sm" />
                </div>
              </div>

              {/* Obsidian 浏览目录（多选） */}
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground">Obsidian 浏览目录</div>
                  <button onClick={() => { setBrowserTarget('browse'); setShowBrowser(!showBrowser); }} className={cn("p-1.5 rounded-lg border border-border hover:bg-muted flex items-center gap-1 text-[11px]", showBrowser && browserTarget==='browse' && "bg-primary/10 border-primary/30")}>
                    <Globe size={13} /> {showBrowser ? '收起' : '浏览选择'}
                  </button>
                </div>

                {/* 已选目录 */}
                {browsePaths.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {browsePaths.map(p => (
                      <span key={p} className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-[11px]">
                        <Folder size={11} /> {p || '(根目录)'}
                        <button onClick={() => removeBrowsePath(p)} className="hover:text-destructive"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
                {browsePaths.length === 0 && <div className="text-[11px] text-muted-foreground/60">未选择，将显示全部</div>}

                {/* 目录浏览器 */}
                {showBrowser && (
                  <div className="border border-primary/30 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Globe size={10} />
                        {breadcrumb.map((seg, i) => (
                          <span key={i} className="flex items-center gap-0.5">
                            {i > 0 && <ChevronRight size={8} className="opacity-40" />}
                            <span className={i === breadcrumb.length - 1 ? 'text-foreground font-medium' : ''}>{seg}</span>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setCurrentPath([]); fetchTree(''); }} className="p-0.5 hover:bg-muted rounded"><RefreshCw size={11} className="text-muted-foreground" /></button>
                        <button onClick={() => setShowBrowser(false)} className="p-0.5 hover:bg-muted rounded"><X size={11} className="text-muted-foreground" /></button>
                      </div>
                    </div>

                    <div className="max-h-36 overflow-y-auto p-1">
                      {currentPath.length > 0 && (
                        <button onClick={goUp} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted text-left">
                          <Folder size={13} className="text-muted-foreground" /><span className="text-[11px] text-muted-foreground">..</span>
                        </button>
                      )}
                      {treeError ? (
                        <div className="text-center py-4 text-[11px] text-destructive">{treeError}</div>
                      ) : treeLoading ? (
                        <div className="text-center py-4 text-[11px] text-muted-foreground"><Loader2 size={14} className="animate-spin mx-auto mb-1" />加载中...</div>
                      ) : tree.length === 0 ? (
                        <div className="text-center py-4 text-[11px] text-muted-foreground">此目录为空</div>
                      ) : (
                        tree.map(node => (
                          <button key={node.path}
                            onClick={() => { if (node.type === 'folder') enterFolder(node); }}
                            className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left group', node.type === 'folder' ? 'hover:bg-muted' : 'opacity-60')}>
                            {node.type === 'folder' ? <><ChevronRight size={12} className="text-muted-foreground shrink-0 opacity-40 group-hover:opacity-100" /><Folder size={13} className="text-primary/70 shrink-0" /></>
                            : <FileText size={13} className="text-muted-foreground shrink-0" />}
                            <span className={cn("text-[11px] truncate", node.type === 'file' ? 'italic' : '')}>{node.name}</span>
                          </button>
                        ))
                      )}
                    </div>

                    <div className="border-t border-border px-3 py-2 flex justify-between items-center bg-muted/30">
                      <span className="text-[10px] text-muted-foreground">当前: {currentPath.length > 0 ? currentPath.join(' / ') : '(根目录)'}</span>
                      <button onClick={selectCurrentAction} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90">
                        <Plus size={11} /> {browserTarget === 'resolved' ? '设为已解决目录' : '添加此目录'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 已解决保存目录 */}
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground">已解决保存目录</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground/60 shrink-0">已解决/</span>
                  <input type="text" value={resolvedPath} onChange={e => setResolvedPath(e.target.value)}
                    placeholder="留空=根目录" className="flex-1 px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs" />
                  <button onClick={() => { setBrowserTarget('resolved'); setShowBrowser(!showBrowser); }}
                    className={cn("p-1.5 rounded-lg border border-border hover:bg-muted shrink-0", showBrowser && browserTarget==='resolved' && "bg-primary/10 border-primary/30")}>
                    <Globe size={13} />
                  </button>
                </div>
              </div>

              {/* 保存 */}
              <button onClick={handleSaveObsidian} disabled={savingObsidian}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5">
                {savingObsidian ? <Loader2 size={16} className="animate-spin" /> : null} 保存配置
              </button>
            </>
          ) : tab === 'rules' ? <RulesPanel /> : tab === 'audit' ? <AuditPanel /> : tab === 'webhooks' ? <WebhooksPanel /> : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80">取消</button>
          {tab === 'ai' && <button onClick={handleSaveAI} disabled={saving || !baseUrl} className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : '保存'}</button>}
          {(tab !== 'ai' && tab !== 'obsidian') && <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90">完成</button>}
        </div>
      </div>
    </div>
  );
}
