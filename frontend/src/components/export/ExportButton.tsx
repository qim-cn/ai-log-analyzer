/**
 * 导出按钮组件
 * 下拉选择 Markdown 或 PDF 格式
 *
 * 下拉菜单用 absolute 相对按钮定位；点外部关闭用 document mousedown 监听，
 * 不用 fixed 遮罩--因为本按钮在 ChatPanel 头部 backdrop-blur-sm 里，fixed 遮罩
 * 会被 backdrop-filter 破坏（只覆盖头部小条、点外部关不掉）。
 */

import { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileDown, Loader2 } from 'lucide-react';
import { exportService } from '@/services/exportService';

interface ExportButtonProps {
  sessionId: string;
}

export function ExportButton({ sessionId }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点按钮/菜单外部 -> 关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handleExport = async (format: 'markdown' | 'pdf') => {
    setExporting(true);
    setOpen(false);
    try {
      if (format === 'markdown') {
        await exportService.exportMarkdown(sessionId);
      } else {
        await exportService.exportPdf(sessionId);
      }
    } catch (err) {
      alert('导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={exporting}
        className="p-1.5 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
        title="导出对话"
      >
        {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-surface-lg py-1 min-w-[140px] animate-fade-in">
          <button
            onClick={() => handleExport('markdown')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            <FileText size={14} />
            <span>Markdown</span>
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            <FileDown size={14} />
            <span>PDF</span>
          </button>
        </div>
      )}
    </div>
  );
}
