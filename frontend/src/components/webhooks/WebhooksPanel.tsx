/**
 * Webhook 管理面板
 */

import { useState, useEffect } from 'react';
import { Webhook, Plus, Trash2, Send, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import { webhookService, type Webhook as WebhookType } from '@/services/webhookService';
import { cn } from '@/utils';

const WEBHOOK_TYPES = [
  { value: 'wechat', label: '企业微信' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'feishu', label: '飞书' },
  { value: 'custom', label: '自定义' },
];

export function WebhooksPanel() {
  const [webhooks, setWebhooks] = useState<WebhookType[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('custom');
  const [newUrl, setNewUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchWebhooks = async () => {
    setLoading(true);
    try {
      const data = await webhookService.list();
      setWebhooks(data.webhooks);
    } catch (err) {
      console.error('获取 Webhook 失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWebhooks();
  }, []);

  const handleCreate = async () => {
    if (!newName || !newUrl) {
      alert('请填写名称和 URL');
      return;
    }
    setCreating(true);
    try {
      await webhookService.create({ name: newName, type: newType, url: newUrl });
      setNewName('');
      setNewUrl('');
      fetchWebhooks();
    } catch (err) {
      alert('创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (webhook: WebhookType) => {
    try {
      await webhookService.update(webhook.id, { enabled: webhook.enabled ? 0 : 1 });
      fetchWebhooks();
    } catch (err) {
      alert('更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此 Webhook？')) return;
    try {
      await webhookService.delete(id);
      fetchWebhooks();
    } catch (err) {
      alert('删除失败');
    }
  };

  const handleTest = async (id: string) => {
    try {
      await webhookService.test(id);
      alert('测试消息已发送');
    } catch (err) {
      alert('测试失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Webhook size={16} className="text-primary" />
        <span>Webhook 配置</span>
      </div>

      {/* 创建表单 */}
      <div className="border border-border rounded-lg p-3 space-y-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="名称（如：告警群）"
          className="w-full px-3 py-1.5 rounded border border-input bg-background text-sm
                     focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex gap-2">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="px-3 py-1.5 rounded border border-input bg-background text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {WEBHOOK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="Webhook URL"
            className="flex-1 px-3 py-1.5 rounded border border-input bg-background text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground
                     rounded text-sm hover:opacity-90 disabled:opacity-50"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          添加
        </button>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="text-center text-muted-foreground py-4 text-sm">加载中...</div>
      ) : webhooks.length === 0 ? (
        <div className="text-center text-muted-foreground py-4 text-sm">暂无配置</div>
      ) : (
        <div className="space-y-2">
          {webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className={cn(
                'border border-border rounded-lg p-3 flex items-center gap-3',
                !webhook.enabled && 'opacity-50'
              )}
            >
              <button onClick={() => handleToggle(webhook)} className="shrink-0">
                {webhook.enabled ? (
                  <ToggleRight size={20} className="text-primary" />
                ) : (
                  <ToggleLeft size={20} className="text-muted-foreground" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{webhook.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded">
                    {WEBHOOK_TYPES.find((t) => t.value === webhook.type)?.label || webhook.type}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">{webhook.url}</div>
              </div>

              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => handleTest(webhook.id)}
                  className="p-1 hover:bg-muted rounded transition-colors"
                  title="测试发送"
                >
                  <Send size={13} />
                </button>
                <button
                  onClick={() => handleDelete(webhook.id)}
                  className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
