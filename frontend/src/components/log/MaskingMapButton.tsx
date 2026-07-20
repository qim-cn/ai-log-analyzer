/**
 * 脱敏映射查看入口 + 弹窗
 * 仅当日志有脱敏映射时显示；点击弹出按类型分组的 占位符 -> 原始值 映射表，
 * 让用户确认脱敏是否正确、有没有误伤
 */

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { LogFile } from '@/types';
import { logService } from '@/services';
import { Modal } from '@/components/ui/Modal';

/** 占位符类别 -> 展示名 */
const CATEGORY_LABELS: Record<string, string> = {
  IP: 'IP 地址',
  PHONE: '手机号',
  EMAIL: '邮箱',
  TOKEN: 'Token',
  APIKEY: 'API Key',
  IDCARD: '身份证号',
  OTHER: '其他',
};

interface MaskingMapButtonProps {
  logFile: LogFile;
}

export function MaskingMapButton({ logFile }: MaskingMapButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Record<string, number>>({});

  if (!logFile.has_masking_map) return null;

  const handleOpen = async () => {
    setLoading(true);
    try {
      const data = await logService.getMaskingMap(logFile.id);
      setMapping(data.mapping);
      setStats(data.stats);
      setOpen(true);
    } catch (err) {
      console.error('获取脱敏映射失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // 按占位符类别分组（[IP_1] -> IP）
  const groups: Record<string, [string, string][]> = {};
  for (const [placeholder, original] of Object.entries(mapping)) {
    const m = placeholder.match(/^\[([A-Z]+)_\d+\]$/);
    const category = m ? m[1] : 'OTHER';
    (groups[category] ||= []).push([placeholder, original]);
  }

  const total = Object.keys(mapping).length;

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full px-3 py-2 flex items-center gap-2 text-sm
                   border-t border-border hover:bg-accent transition-colors"
      >
        <ShieldCheck size={14} />
        <span>脱敏映射</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {loading ? '加载中...' : '查看'}
        </span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="脱敏映射"
        subtitle={`共 ${total} 个占位符 · 占位符 → 原始值，用于确认脱敏是否正确、有没有误伤`}
      >
        {total === 0 ? (
          <div className="text-center text-muted-foreground py-6 text-sm">
            该日志没有脱敏映射
          </div>
        ) : (
          Object.entries(groups).map(([category, items]) => (
            <div key={category} className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/50 text-xs font-medium flex items-center justify-between">
                <span>{CATEGORY_LABELS[category] || category}</span>
                <span className="text-muted-foreground">{stats[category] || items.length} 个</span>
              </div>
              <div className="divide-y divide-border">
                {items.map(([placeholder, original]) => (
                  <div key={placeholder} className="px-3 py-1.5 flex items-center gap-3 text-xs">
                    <span className="font-mono text-primary shrink-0">{placeholder}</span>
                    <span className="font-mono text-muted-foreground break-all">{original}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </Modal>
    </>
  );
}
