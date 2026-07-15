/**
 * 设置弹窗
 * AI 配置 + 知识库配置 + 模板管理 + 告警规则 + 审计日志 + Webhook
 */

import { useEffect, useState } from 'react';
import { X, RefreshCw, Loader2, BookOpen, Plus, Trash2, Pencil } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { obsidianService } from '@/services/obsidianService';
import { templateService } from '@/services/templateService';
import { RulesPanel } from '@/components/rules/RulesPanel';
import { AuditPanel } from '@/components/audit/AuditPanel';
import { WebhooksPanel } from '@/components/webhooks/WebhooksPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type { ObsidianSettings, AnalysisTemplate } from '@/types';
import { cn } from '@/utils';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = 'ai' | 'obsidian' | 'templates' | 'rules' | 'audit' | 'webhooks';

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const {
    aiSettings,
    models,
    fetchSettings,
    fetchModels,
    updateSettings,
  } = useSettingsStore();

  const [tab, setTab] = useState<SettingsTab>('ai');
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const { toast } = useToast();

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
  const [autoSave, setAutoSave] = useState(false);
  const [savingObsidian, setSavingObsidian] = useState(false);

  // 模板管理
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplatePrompt, setNewTemplatePrompt] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<AnalysisTemplate | null>(null);

  useEffect(() => {
    if (open) {
      fetchSettings();
      fetchModels();
      fetchObsidianSettings();
    }
  }, [open, fetchSettings, fetchModels]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) {
      document.addEventListener('keydown', handleKey);
      return () => document.removeEventListener('keydown', handleKey);
    }
  }, [open, onClose]);

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
      setAutoSave(settings.auto_save);
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
      toast('error', `保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveObsidian = async () => {
    setSavingObsidian(true);
    try {
      await obsidianService.updateSettings({
        webdav_url: webdavUrl,
        webdav_user: webdavUser,
        webdav_pass: webdavPass || undefined,
        vault_path: vaultPath,
        auto_save: autoSave,
      });
      await fetchObsidianSettings();
      toast('success', '知识库配置已保存');
    } catch (error) {
      toast('error', `保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSavingObsidian(false);
    }
  };

  // 模板管理函数
  const fetchTemplates = async () => {
    try {
      const data = await templateService.list();
      setTemplates(data.templates);
    } catch (err) {
      console.error('获取模板失败:', err);
    }
  };

  useEffect(() => {
    if (open && tab === 'templates') {
      fetchTemplates();
    }
  }, [open, tab]);

  const handleCreateTemplate = async () => {
    if (!newTemplateName || !newTemplatePrompt) {
      toast('warning', '请填写模板名称和内容');
      return;
    }
    try {
      await templateService.create(newTemplateName, newTemplatePrompt);
      setNewTemplateName('');
      setNewTemplatePrompt('');
      fetchTemplates();
    } catch (err) {
      toast('error', '创建失败');
      fetchTemplates();
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    setDeleteTemplateId(id);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTemplateId) return;
    try {
      await templateService.delete(deleteTemplateId);
      setDeleteTemplateId(null);
      fetchTemplates();
      toast('success', '模板已删除');
    } catch {
      toast('error', '删除失败，预设模板无法删除');
      setDeleteTemplateId(null);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!editingTemplate) return;
    try {
      await templateService.update(editingTemplate.id, editingTemplate.name, editingTemplate.prompt);
      setEditingTemplate(null);
      fetchTemplates();
      toast('success', '模板已更新');
    } catch {
      toast('error', '更新失败');
    }
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
          <button
            onClick={() => setTab('ai')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === 'ai'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            AI 配置
          </button>
          <button
            onClick={() => setTab('obsidian')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
              tab === 'obsidian'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <BookOpen size={14} />
            知识库
          </button>
          <button
            onClick={() => setTab('templates')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === 'templates'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            模板
          </button>
          <button
            onClick={() => setTab('rules')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === 'rules'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            告警
          </button>
          <button
            onClick={() => setTab('audit')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === 'audit'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            日志
          </button>
          <button
            onClick={() => setTab('webhooks')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === 'webhooks'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            通知
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'ai' ? (
            <>
              {/* Provider 切换 */}
              <div className="flex gap-2">
                <button
                  onClick={handleSelectOpenAI}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    provider === 'openai'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  )}
                >
                  OpenAI 兼容
                </button>
                <button
                  onClick={handleSelectOllama}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    provider === 'ollama'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  )}
                >
                  Ollama 本地
                </button>
              </div>

              {/* Base URL */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">API 地址</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* API Key */}
              {provider === 'openai' && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    API Key
                    {aiSettings?.api_key_set && (
                      <span className="text-xs text-muted-foreground ml-2">(已设置，留空不更新)</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {/* Model */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">模型</label>
                <div className="flex gap-2">
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">选择模型...</option>
                    {provider === 'openai' && (models?.openai_models || []).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {provider === 'ollama' && (models?.ollama_models || []).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <button onClick={fetchModels} className="px-2 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors" title="刷新模型列表">
                    <RefreshCw size={16} />
                  </button>
                </div>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="或手动输入模型名称"
                  className="w-full mt-2 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </>
          ) : tab === 'obsidian' ? (
            <>
              {/* Obsidian WebDAV 配置 */}
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={16} className="text-primary" />
                <span className="text-sm font-medium">Obsidian WebDAV 连接</span>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">WebDAV 地址</label>
                <input
                  type="text"
                  value={webdavUrl}
                  onChange={(e) => setWebdavUrl(e.target.value)}
                  placeholder="https://dav.example.com/dav/"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">用户名</label>
                  <input
                    type="text"
                    value={webdavUser}
                    onChange={(e) => setWebdavUser(e.target.value)}
                    placeholder="WebDAV 用户名"
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">密码</label>
                  <input
                    type="password"
                    value={webdavPass}
                    onChange={(e) => setWebdavPass(e.target.value)}
                    placeholder={obsidianSettings?.webdav_configured ? '已设置，留空不更新' : 'WebDAV 密码'}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">知识库路径</label>
                <input
                  type="text"
                  value={vaultPath}
                  onChange={(e) => setVaultPath(e.target.value)}
                  placeholder="/服务器维修笔记/DEBUG记录/"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="text-[11px] text-muted-foreground/60 mt-1">
                  Obsidian 仓库内的路径，以 / 开头
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSave}
                    onChange={(e) => setAutoSave(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
                <div>
                  <div className="text-sm font-medium">自动保存</div>
                  <div className="text-[11px] text-muted-foreground/60">AI 分析完成后自动保存到知识库</div>
                </div>
              </div>
            </>
          ) : tab === 'templates' ? (
            <>
              {/* 模板管理 */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium">分析模板管理</span>
                <span className="text-xs text-muted-foreground">管理员可自定义快捷分析模板</span>
              </div>

              {/* 创建新模板 */}
              <div className="border border-border rounded-lg p-3 space-y-2">
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="模板名称"
                  className="w-full px-3 py-1.5 rounded border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <textarea
                  value={newTemplatePrompt}
                  onChange={(e) => setNewTemplatePrompt(e.target.value)}
                  placeholder="模板内容（发送给 AI 的 prompt）"
                  rows={3}
                  className="w-full px-3 py-1.5 rounded border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
                <button
                  onClick={handleCreateTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
                >
                  <Plus size={14} />
                  添加模板
                </button>
              </div>

              {/* 模板列表 */}
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="border border-border rounded-lg p-3">
                    {editingTemplate?.id === tpl.id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editingTemplate.name}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                          className="w-full px-3 py-1.5 rounded border border-input bg-background text-sm"
                        />
                        <textarea
                          value={editingTemplate.prompt}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, prompt: e.target.value })}
                          rows={3}
                          className="w-full px-3 py-1.5 rounded border border-input bg-background text-sm resize-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={handleUpdateTemplate} className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs">保存</button>
                          <button onClick={() => setEditingTemplate(null)} className="px-3 py-1 bg-muted text-muted-foreground rounded text-xs">取消</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{tpl.name}</span>
                            {tpl.is_preset && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">预设</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate">{tpl.prompt}</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => setEditingTemplate(tpl)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                          {!tpl.is_preset && (
                            <button
                              onClick={() => handleDeleteTemplate(tpl.id)}
                              className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            取消
          </button>
          {tab === 'ai' ? (
            <button
              onClick={handleSaveAI}
              disabled={saving || !baseUrl}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : '保存'}
            </button>
          ) : tab === 'obsidian' ? (
            <button
              onClick={handleSaveObsidian}
              disabled={savingObsidian}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all disabled:opacity-50"
            >
              {savingObsidian ? <Loader2 size={16} className="animate-spin" /> : '保存'}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all"
            >
              完成
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTemplateId}
        title="删除模板"
        message="确定删除此模板？删除后不可恢复。"
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTemplateId(null)}
      />
    </div>
  );
}
