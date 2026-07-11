/**
 * 日志文件列表组件
 */

import { FileText, Trash2, Clock, HardDrive } from 'lucide-react';
import type { LogFile } from '@/types';
import { cn, formatFileSize, formatTime } from '@/utils';

interface LogFileListProps {
  files: LogFile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function LogFileList({
  files,
  selectedId,
  onSelect,
  onDelete,
}: LogFileListProps) {
  if (files.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8 text-sm">
        暂无日志文件
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {files.map((file) => (
        <div
          key={file.id}
          onClick={() => onSelect(file.id)}
          className={cn(
            'group flex items-start gap-2 p-2.5 rounded-lg cursor-pointer',
            'hover:bg-accent transition-colors',
            selectedId === file.id && 'bg-accent'
          )}
        >
          <FileText size={16} className="shrink-0 mt-0.5 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate font-medium">{file.filename}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span className="flex items-center gap-0.5">
                <HardDrive size={10} />
                {formatFileSize(file.file_size)}
              </span>
              <span>{file.line_count.toLocaleString()} 行</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-0.5">
              <Clock size={10} />
              {formatTime(file.created_at)}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(file.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive
                       transition-all shrink-0"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
