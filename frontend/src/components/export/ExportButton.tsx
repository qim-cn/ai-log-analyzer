/**
 * 导出按钮组件
 * 下拉选择 Markdown 或 PDF 格式
 */

import { useState } from 'react';
import { Download, FileText, FileDown, Loader2 } from 'lucide-react';
import { exportService } from '@/services/exportService';
import { useToast } from '@/components/ui/Toast';

interface ExportButtonProps {
  sessionId: string;
}

export function ExportButton({ sessionId }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async (format: 'markdown' | 'pdf') => {
    setExporting(true);
    setOpen(false);
    try {
      if (format === 'markdown') {
        await exportService.exportMarkdown(sessionId);
      } else {
        await exportService.exportPdf(sessionId);
      }
      toast('success', '导出成功');
    } catch {
      toast('error', '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={exporting}
        className="p-1.5 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
        title="导出对话"
      >
        {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
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
        </>
      )}
    </div>
  );
}
