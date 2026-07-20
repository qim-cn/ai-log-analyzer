/**
 * 自定义脱敏词管理面板（SettingsDialog "脱敏" tab）
 * 增删自定义脱敏规则（纯文本词或正则），保存到后端 /api/settings/masking，
 * 对之后上传的日志生效（占位符 [CUSTOM_N]）
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2, ShieldCheck, Loader2 } from 'lucide-react';
import { settingsService } from '@/services';

export function MaskingPatternsPanel() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchPatterns = async () => {
      setLoading(true);
      try {
        const data = await settingsService.getMaskingPatterns();
        setPatterns(data.patterns);
      } catch (err) {
        console.error('获取自定义脱敏规则失败:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPatterns();
  }, []);

  const handleAdd = () => {
    const p = newPattern.trim();
    if (!p || patterns.includes(p)) return;
    setPatterns([...patterns, p]);
    setNewPattern('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await settingsService.updateMaskingPatterns(patterns);
      setPatterns(data.patterns);
      alert('自定义脱敏规则已保存，对之后上传的日志生效');
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-primary" />
        <span className="text-sm font-medium">自定义脱敏词</span>
        <span className="text-xs text-muted-foreground">
          上传日志时替换为 [CUSTOM_N]，对之后上传的文件生效
        </span>
      </div>

      {/* 现有规则 */}
      {patterns.length === 0 ? (
        <div className="text-center text-muted-foreground py-6 text-sm">
          还没有自定义规则，在下面添加一个
        </div>
      ) : (
        <div className="space-y-2">
          {patterns.map((p, i) => (
            <div
              key={`${i}-${p}`}
              className="border border-border rounded-xl px-3 py-2 flex items-center gap-2"
            >
              <span className="flex-1 min-w-0 font-mono text-sm truncate">{p}</span>
              <button
                onClick={() => setPatterns(patterns.filter((_, j) => j !== i))}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 新增 */}
      <div className="border border-dashed border-muted-foreground/25 rounded-xl p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          新增规则（纯文本词或正则，非法正则按纯文本处理）
        </div>
        <input
          type="text"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="如：内部域名 或 db\d+-prod"
          className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-sm font-mono"
        />
        <button
          onClick={handleAdd}
          disabled={!newPattern.trim()}
          className="w-full py-2 rounded-xl text-sm font-medium bg-secondary text-secondary-foreground
                     hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5
                     disabled:opacity-50"
        >
          <Plus size={14} /> 添加到列表
        </button>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground
                   hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null} 保存配置
      </button>
    </div>
  );
}
