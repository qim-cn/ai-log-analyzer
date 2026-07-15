/**
 * 告警规则管理面板
 */

import { useState, useEffect } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';
import { ruleService, type AlertRule } from '@/services/ruleService';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/utils';

export function RulesPanel() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newCondition, setNewCondition] = useState('');
  const [newWindow, setNewWindow] = useState('5m');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchRules = async () => {
    setLoading(true);
    try {
      const data = await ruleService.list();
      setRules(data.rules);
    } catch (err) {
      console.error('获取规则失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleCreate = async () => {
    if (!newName || !newCondition) {
      toast('warning', '请填写规则名称和条件');
      return;
    }
    setCreating(true);
    try {
      await ruleService.create({
        name: newName,
        condition: newCondition,
        time_window: newWindow,
      });
      setNewName('');
      setNewCondition('');
      fetchRules();
    } catch (err) {
      toast('error', '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (rule: AlertRule) => {
    try {
      await ruleService.update(rule.id, { enabled: rule.enabled ? 0 : 1 });
      fetchRules();
    } catch {
      toast('error', '更新失败');
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeleteTarget(id);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await ruleService.delete(deleteTarget);
      setDeleteTarget(null);
      fetchRules();
      toast('success', '规则已删除');
    } catch {
      toast('error', '删除失败');
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">告警规则管理</div>

      {/* 创建表单 */}
      <div className="border border-border rounded-lg p-3 space-y-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="规则名称（如：错误过多）"
          className="w-full px-3 py-1.5 rounded border border-input bg-background text-sm
                     focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <input
          type="text"
          value={newCondition}
          onChange={(e) => setNewCondition(e.target.value)}
          placeholder="条件（如：error_count > 10）"
          className="w-full px-3 py-1.5 rounded border border-input bg-background text-sm
                     focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex gap-2">
          <select
            value={newWindow}
            onChange={(e) => setNewWindow(e.target.value)}
            className="px-3 py-1.5 rounded border border-input bg-background text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="1m">1 分钟</option>
            <option value="5m">5 分钟</option>
            <option value="10m">10 分钟</option>
            <option value="30m">30 分钟</option>
            <option value="1h">1 小时</option>
          </select>
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
        <div className="text-[11px] text-muted-foreground/60">
          条件格式：字段 运算符 值，如 error_count &gt; 10, fatal_count &gt; 0
        </div>
      </div>

      {/* 规则列表 */}
      {loading ? (
        <div className="text-center text-muted-foreground py-4 text-sm">加载中...</div>
      ) : rules.length === 0 ? (
        <div className="text-center text-muted-foreground py-4 text-sm">暂无规则</div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={cn(
                'border border-border rounded-lg p-3 flex items-start gap-3',
                !rule.enabled && 'opacity-50'
              )}
            >
              <button
                onClick={() => handleToggle(rule)}
                className="mt-0.5 shrink-0"
              >
                {rule.enabled ? (
                  <ToggleRight size={20} className="text-primary" />
                ) : (
                  <ToggleLeft size={20} className="text-muted-foreground" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{rule.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded">
                    {rule.time_window}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 font-mono">
                  {rule.condition}
                </div>
              </div>

              <button
                onClick={() => handleDeleteClick(rule.id)}
                className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除规则"
        message="确定删除此告警规则？"
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
