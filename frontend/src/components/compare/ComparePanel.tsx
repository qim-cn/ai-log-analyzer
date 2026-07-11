/**
 * 日志对比面板
 */

import { useState } from 'react';
import { GitCompareArrows, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { compareService, type CompareResult } from '@/services/compareService';
import type { LogFile } from '@/types';

interface ComparePanelProps {
  logFiles: LogFile[];
  onAnalyze?: (summary: string) => void;
}

export function ComparePanel({ logFiles, onAnalyze }: ComparePanelProps) {
  const [file1Id, setFile1Id] = useState('');
  const [file2Id, setFile2Id] = useState('');
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState('');

  const handleCompare = async () => {
    if (!file1Id || !file2Id) {
      setError('请选择两份日志文件');
      return;
    }
    if (file1Id === file2Id) {
      setError('请选择不同的文件');
      return;
    }

    setComparing(true);
    setError('');
    try {
      const data = await compareService.compare(file1Id, file2Id);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '对比失败');
    } finally {
      setComparing(false);
    }
  };

  const handleAiAnalyze = () => {
    if (result && onAnalyze) {
      onAnalyze(result.summary);
    }
  };

  if (logFiles.length < 2) {
    return (
      <div className="text-center text-muted-foreground py-8 text-sm">
        需要至少上传两份日志才能对比
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <GitCompareArrows size={16} className="text-primary" />
        <span>日志对比分析</span>
      </div>

      {/* 文件选择 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">修复前</label>
          <select
            value={file1Id}
            onChange={(e) => setFile1Id(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">选择文件...</option>
            {logFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.filename}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">修复后</label>
          <select
            value={file2Id}
            onChange={(e) => setFile2Id(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">选择文件...</option>
            {logFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.filename}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 对比按钮 */}
      <button
        onClick={handleCompare}
        disabled={comparing || !file1Id || !file2Id}
        className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium
                   hover:shadow-glow active:scale-95 transition-all disabled:opacity-50"
      >
        {comparing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            对比中...
          </span>
        ) : (
          '开始对比'
        )}
      </button>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {/* 对比结果 */}
      {result && (
        <div className="space-y-3">
          {/* 统计 */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-green-500/10 rounded-lg p-2">
              <div className="text-lg font-bold text-green-500">+{result.added_lines}</div>
              <div className="text-[10px] text-muted-foreground">新增</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-2">
              <div className="text-lg font-bold text-red-500">-{result.removed_lines}</div>
              <div className="text-[10px] text-muted-foreground">删除</div>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <div className="text-lg font-bold">{result.unchanged_lines}</div>
              <div className="text-[10px] text-muted-foreground">未变</div>
            </div>
          </div>

          {/* 关键差异 */}
          {result.fixed_errors.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-green-500 mb-1">
                <CheckCircle2 size={12} />
                已修复的错误
              </div>
              <div className="space-y-1">
                {result.fixed_errors.slice(0, 5).map((err, i) => (
                  <div key={i} className="text-xs text-muted-foreground bg-green-500/5 px-2 py-1 rounded">
                    ✓ {err}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.new_errors.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-red-500 mb-1">
                <AlertTriangle size={12} />
                新增的错误
              </div>
              <div className="space-y-1">
                {result.new_errors.slice(0, 5).map((err, i) => (
                  <div key={i} className="text-xs text-muted-foreground bg-red-500/5 px-2 py-1 rounded">
                    ✗ {err}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI 分析按钮 */}
          <button
            onClick={handleAiAnalyze}
            className="w-full py-2 bg-secondary text-secondary-foreground rounded-lg text-xs
                       hover:bg-secondary/80 transition-colors"
          >
            🤖 让 AI 分析差异
          </button>
        </div>
      )}
    </div>
  );
}
