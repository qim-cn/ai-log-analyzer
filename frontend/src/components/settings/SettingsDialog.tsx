/**
 * 设置弹窗
 * AI 配置 + 知识库配置 + 告警规则 + 审计日志 + Webhook
 */

import { useEffect, useState, useCallback } from 'react';
import { X, RefreshCw, Loader2, BookOpen, Globe, Folder, FileText, ChevronRight } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { obsidianService, type FileTreeNode } from '@/services/obsidianService';
import { RulesPanel } from '@/components/rules/RulesPanel';
import { AuditPanel } from '@/components/audit/AuditPanel';
import { WebhooksPanel } from '@/components/webhooks/WebhooksPanel';
import type { ObsidianSettings } from '@/types';
import { cn } from '@/utils';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = 'ai' | 'obsidian' | 'rules' | 'audit' | 'webhooks';

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const {
    aiSettings,
    models,
    fetchSettings,
    fetchModels,
    updateSettings,
  } = useSettingsStore();

  const [tab, setTab] = useState<SettingsTab>('ai');

  // AI 设置
  const [provider, setProvider] = useState<'openai' | 'ollama'>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);

  // Obsidian 设置
  const [obsidianSettings, setObsidianSettings] = useState<ObsidianSettings | null>(null);
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPass, setWebdavPass] = useState('');
  const [vaultPath, setVaultPath] = useState('');
  const [savingObsidian, setSavingObsidian] = useState(false);

  // 远程目录浏览
  const [showBrowser, setShowBrowser] = useState(false);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [browserSelected, setBrowserSelected] = useState('');

  const fetchTree = useCallback(async (relPath: string = '') => {
    setTreeLoading(true);
    try {
      const data = await obsidianService.getFileTree(relPath);
      setTree(data.tree || []);
    } catch (err) { console.error(err); }
    finally { setTreeLoading(false); }
  }, []);

  useEffect(() => {
    if (showBrowser) { setCurrentPath([]); setBrowserSelected(''); fetchTree(''); }
  }, [showBrowser, fetchTree]);

  const enterFolder = (node: FileTreeNode) => {
    if (node.type !== 'folder') return;
    setCurrentPath([...currentPath, node.name]);
    fetchTree(node.path);
  };

  const goUp = () => {
    const newPath = currentPath.slice(0, -1);
    setCurrentPath(newPath);
    fetchTree(newPath.join('/'));
  };

  const selectCurrentDir = () => {
    const p = currentPath.length > 0 ? '/' + currentPath.join('/') + '/' : '/';
    setVaultPath(p);
    setBrowserSelected(currentPath.length > 0 ? currentPath.join(' / ') : '(根目录)');
    setShowBrowser(false);
    setCurrentPath([]);
  };

  const breadcrumb = currentPath.length > 0
    ? ['Vault', ...currentPath]
    : ['Vault'];

  useEffect(() => {
    if (open) {
      fetchSettings();
      fetchModels();
      fetchObsidianSettings();
    }
  }, [open, fetchSettings, fetchModels]);

  useEffect(() => {
    if (aiSettings) {
      setBaseUrl(aiSettings.base_url);
      setModel(aiSettings.model);
      setApiKey('');
    }
  }, [aiSettings]);

  const fetchObsidianSettings = async () => {
    try {
      const settings = await obsidianService.getSettings();
      setObsidianSettings(settings);
      setWebdavUrl(settings.webdav_url);
      setWebdavUser(settings.webdav_user);
      setVaultPath(settings.vault_path);
    } catch (err) {
      console.error('获取知识库配置失败:', err);
    }
  };

  const handleSelectOllama = () => {
    setProvider('ollama');
    if (aiSettings) setBaseUrl(aiSettings.ollama_base_url);
  };

  const handleSelectOpenAI = () => {
    setProvider('openai');
    if (aiSettings) setBaseUrl(aiSettings.base_url);
  };

  const handleSaveAI = async () => {
    setSaving(true);
    try {
      await updateSettings({
        provider,
        base_url: baseUrl,
        api_key: apiKey || undefined,
        model,
      });
      onClose();
    } catch (error) {
      alert(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally { setSaving(false); }
  };

  const handleSaveObsidian = async () => {
    setSavingObsidian(true);
    try {
      await obsidianService.updateSettings({
        webdav_url: webdavUrl,
        webdav_user: webdavUser,
        webdav_pass: webdavPass || undefined,
        vault_path: vaultPath,
        auto_save: false,
      });
      await fetchObsidianSettings();
      alert('知识库配置已保存');
    } catch (error) {
      alert(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally { setSavingObsidian(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-surface-lg w-full max-w-lg mx-4 animate-slide-up max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm">设置</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5">
          <button onClick={() => setTab('ai')} className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            tab === 'ai' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>AI 配置</button>

          <button onClick={() => setTab('obsidian')} className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
            tab === 'obsidian' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}><BookOpen size={14} />知识库</button>

          <button onClick={() => setTab('rules')} className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            tab === 'rules' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>告警</button>

          <button onClick={() => setTab('audit')} className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            tab === 'audit' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>日志</button>

          <button onClick={() => setTab('webhooks')} className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            tab === 'webhooks' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>通知</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'ai' ? (
            <>
              <div className="flex gap-2">
                <button onClick={handleSelectOpenAI} className={cn(
                  'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  provider === 'openai' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                )}>OpenAI 兼容</button>
                <button onClick={handleSelectOllama} className={cn(
                  'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  provider === 'ollama' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                )}>Ollama 本地</button>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">API 地址</label>
                <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>

              {provider === 'openai' && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    API Key
                    {aiSettings?.api_key_set && <span className="text-xs text-muted-foreground ml-2">(已设置，留空不更新)</span>}
                  </label>
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-1.5 block">模型</label>
                <div className="flex gap-2">
                  <select value={model} onChange={(e) => setModel(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">选择模型...</option>
                    {provider === 'openai' && (models?.openai_models || []).map((m) => <option key={m} value={m}>{m}</option>)}
                    {provider === 'ollama' && (models?.ollama_models || []).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button onClick={fetchModels} className="px-2 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors" title="刷新模型列表">
                    <RefreshCw size={16} />
                  </button>
                </div>
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)}
                  placeholder="或手动输入模型名称"
                  className="w-full mt-2 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </>
          ) : tab === 'obsidian' ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={16} className="text-primary" />
                <span className="text-sm font-medium">Obsidian WebDAV 连接</span>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">WebDAV 地址</label>
                <input type="text" value={webdavUrl} onChange={(e) => setWebdavUrl(e.target.value)}
                  placeholder="http://192.168.31.5:5005/Obsidian Vault"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">用户名</label>
                  <input type="text" value={webdavUser} onChange={(e) => setWebdavUser(e.target.value)}
                    placeholder="WebDAV 用户名"
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">密码</label>
                  <input type="password" value={webdavPass} onChange={(e) => setWebdavPass(e.target.value)}
                    placeholder={obsidianSettings?.webdav_configured ? '已设置，留空不更新' : 'WebDAV 密码'}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">知识库路径</label>
                <div className="flex gap-1.5">
                  <input type="text" value={vaultPath} onChange={(e) => setVaultPath(e.target.value)}
                    placeholder="/服务器维修笔记/AI分析记录/"
                    className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  <button
                    onClick={() => setShowBrowser(!showBrowser)}
                    className="p-2 hover:bg-muted rounded-lg transition-colors shrink-0 border border-border"
                    title="浏览远程目录"
                  >
                    <Globe size={16} className={showBrowser ? 'text-primary' : 'text-muted-foreground'} />
                  </button>
                </div>
                {browserSelected && (
                  <div className="text-[11px] text-primary/70 mt-1">已选择: {browserSelected}</div>
                )}
              </div>

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
                      <button onClick={() => { setCurrentPath([]); fetchTree(''); }} className="p-0.5 hover:bg-muted rounded">
                        <RefreshCw size={11} className="text-muted-foreground" />
                      </button>
                      <button onClick={() => setShowBrowser(false)} className="p-0.5 hover:bg-muted rounded">
                        <X size={11} className="text-muted-foreground" />
                      </button>
                    </div>
                  </div>

                  <div className="max-h-40 overflow-y-auto p-1">
                    {currentPath.length > 0 && (
                      <button onClick={goUp} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted text-left">
                        <Folder size={13} className="text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground">..</span>
                      </button>
                    )}
                    {treeLoading ? (
                      <div className="text-center py-4 text-[11px] text-muted-foreground">
                        <Loader2 size={14} className="animate-spin mx-auto mb-1" />加载中...
                      </div>
                    ) : tree.length === 0 ? (
                      <div className="text-center py-4 text-[11px] text-muted-foreground">此目录为空</div>
                    ) : (
                      tree.map((node) => (
                        <button key={node.path}
                          onClick={() => { if (node.type === 'folder') enterFolder(node); }}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left group',
                            node.type === 'folder' ? 'hover:bg-muted cursor-pointer' : 'opacity-70'
                          )}>
                          {node.type === 'folder' ? (
                            <ChevronRight size={12} className="text-muted-foreground shrink-0 opacity-40 group-hover:opacity-100" />
                          ) : (
                            <FileText size={12} className="text-muted-foreground/40 shrink-0" />
                          )}
                          {node.type === 'folder' ? (
                            <Folder size={13} className="text-primary/70 shrink-0" />
                          ) : (
                            <FileText size={13} className="text-muted-foreground shrink-0" />
                          )}
                          <span className="text-[11px] truncate">{node.name}</span>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="border-t border-border px-3 py-2 flex justify-between items-center bg-muted/30">
                    <span className="text-[10px] text-muted-foreground">
                      当前: {currentPath.length > 0 ? '/' + currentPath.join('/') + '/' : '(根目录)'}
                    </span>
                    <button onClick={selectCurrentDir}
                      className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity">
                      选择此目录
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : tab === 'rules' ? (
            <RulesPanel />
          ) : tab === 'audit' ? (
            <AuditPanel />
          ) : tab === 'webhooks' ? (
            <WebhooksPanel />
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
            取消
          </button>
          {tab === 'ai' ? (
            <button onClick={handleSaveAI} disabled={saving || !baseUrl}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : '保存'}
            </button>
          ) : tab === 'obsidian' ? (
            <button onClick={handleSaveObsidian} disabled={savingObsidian}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all disabled:opacity-50">
              {savingObsidian ? <Loader2 size={16} className="animate-spin" /> : '保存'}
            </button>
          ) : (
            <button onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all">
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
