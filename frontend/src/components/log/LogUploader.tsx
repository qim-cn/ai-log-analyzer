/**
 * 日志文件上传组件
 * 支持拖拽或点击上传，带进度反馈
 */

import { useCallback, useState } from 'react';
import { Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { useLogStore } from '@/stores';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/utils';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '@/constants';

interface LogUploaderProps {
  sessionId: string;
}

export function LogUploader({ sessionId }: LogUploaderProps) {
  const { uploading, uploadLog } = useLogStore();
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_FILE_TYPES.includes(ext)) {
        toast('error', `不支持的文件类型: ${ext}`);
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast('error', `文件大小超过限制 (最大 50MB)`);
        return;
      }

      try {
        await uploadLog(sessionId, file);
        setUploadSuccess(true);
        setTimeout(() => setUploadSuccess(false), 2000);
      } catch (error) {
        toast('error', `上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [sessionId, uploadLog]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  const handleClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ALLOWED_FILE_TYPES.join(',');
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFile(file);
    };
    input.click();
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      className={cn(
        'border-2 border-dashed rounded-xl p-4 text-center cursor-pointer',
        'transition-all duration-200',
        dragging
          ? 'border-primary bg-primary/5 scale-[1.02]'
          : 'border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/50',
        uploading && 'opacity-60 cursor-not-allowed pointer-events-none',
        uploadSuccess && 'border-success/50 bg-success/5'
      )}
    >
      {uploading ? (
        <div className="flex items-center justify-center gap-2.5 text-muted-foreground">
          <Loader2 size={18} className="animate-spin text-primary" />
          <span className="text-sm">解析中...</span>
        </div>
      ) : uploadSuccess ? (
        <div className="flex items-center justify-center gap-2 text-success">
          <CheckCircle2 size={18} />
          <span className="text-sm font-medium">上传成功</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
          <Upload size={18} className={dragging ? 'text-primary' : ''} />
          <div className="text-sm">
            <span className="font-medium text-foreground">点击或拖拽上传</span>
          </div>
          <div className="text-[11px] text-muted-foreground/60">
            .log .txt .csv · 最大 50MB
          </div>
        </div>
      )}
    </div>
  );
}
