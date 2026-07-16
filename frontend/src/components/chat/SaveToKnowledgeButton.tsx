/**
 * 保存到知识库按钮
 * AI 回复下方显示，点击弹出保存表单
 * 支持 WebDAV 浏览远程目录选择保存位置
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2, Loader2, FolderOpen, Folder, ChevronRight,
  Save, X, RefreshCw, Globe,
} from 'lucide-react';
import { obsidianService, type FileTreeNode } from '@/services/obsidianService';

interface SaveToKnowledgeButtonProps {
  logFilename?: string;
  logSummary?: string;
  logSnippet?: string;
  analysis: string;
}

export function SaveToKnowledgeButton({
  logFilename,
  logSummary,
  logSnippet,
  analysis,
}: SaveToKnowledgeButtonProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savePath, setSavePath] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  // 远程目录浏览
  const [showBrowser, setShowBrowser] = useState(false);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState<string[]>([]);  // 当前导航路径段
  const [selectedDir, setSelectedDir] = useState('');            // 选中的目录（相对于 vault）

  // 加载指定路径的目录树
  const fetchTree = useCallback(async (relPath: string = '') => {
    setTreeLoading(true);
    try {
      const data = await obsidianService.getFileTree(relPath);
      setTree(data.tree || []);
    } catch (err) { console.error(err); }
    finally { setTreeLoading(false); }
  }, []);

  // 打开浏览器时加载根目录
  useEffect(() => {
    if (showBrowser) fetchTree('');
  }, [showBrowser, fetchTree]);

  // 进入子文件夹
  const enterFolder = (node: FileTreeNode) => {
    if (node.type !== 'folder') return;
    setCurrentPath([...currentPath, node.name]);
    fetchTree(node.path);
  };

  // 回到上级
  const goUp = () => {
    const newPath = currentPath.slice(0, -1);
    setCurrentPath(newPath);
    // 重新加载父目录 —— 从根遍历到当前层级
    const parentRel = newPath.join('/');
    fetchTree(parentRel);
  };

  // 选择当前目录作为保存目录
  const selectCurrentDir = () => {
    const dirPath = currentPath.join('/');
    setSavePath(dirPath);
    setSelectedDir(dirPath);
    setShowBrowser(false);
    setCurrentPath([]);
  };

  // 渲染面包屑
  const breadcrumb = currentPath.length > 0
    ? ['Vault', ...currentPath]
    : ['Vault'];

  const handleSave = async () => {
    if (!title.trim()) { setError('请输入故障标题'); return; }
    setSaving(true);
    setError('');
    try {
      await obsidianService.save({
        title: title.trim(),
        save_path: savePath.trim(),
        log_summary: logSummary || '',
        log_snippet: logSnippet || '',
        analysis,
        resolved: true,
      });
      setSaved(true);
      setTimeout(() => { setShowForm(false); setSaved(false); }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  };

  // 过滤只显示文件夹
  const folders = tree.filter(n => n.type === 'folder');

  return (
    <>
      {/* 保存按钮 */}
      <button
        onClick={() => {
          setTitle(logFilename?.replace(/\.[^.]+$/, '') + ' 故障' || '');
          setSavePath('');
          setSelectedDir('');
          setShowForm(true);
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground
                   hover:text-primary px-2 py-1 rounded-md hover:bg-primary/5
                   transition-colors"
      >
        <Save size={12} />
        <span>保存到知识库</span>
      </button>

      {/* 保存弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-lg w-full max-w-md mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="font-semibold text-sm">保存到已解决知识库</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded">
                <X size={14} className="text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 pb-3 space-y-3">
              {/* 保存路径 - 可手动输入或浏览选择 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                  <FolderOpen size={12} />
                  保存目录
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground/60 shrink-0">已解决/</span>
                  <input
                    type="text"
                    value={savePath}
                    onChange={(e) => setSavePath(e.target.value)}
                    placeholder="如: 7500S/HBA  (空=根目录)"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs
                               focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    onClick={() => { setShowBrowser(true); setCurrentPath([]); }}
                    className="p-1.5 hover:bg-muted rounded-lg transition-colors shrink-0"
                    title="浏览远程目录"
                  >
                    <Globe size={14} className="text-muted-foreground" />
                  </button>
                </div>
                {selectedDir && (
                  <div className="text-[10px] text-primary/70 mt-0.5">
                    已选择: {selectedDir || '(根目录)'}
                  </div>
                )}
              </div>

              {/* 目录浏览器 */}
              {showBrowser && (
                <div className="border border-border rounded-xl overflow-hidden">
                  {/* 浏览器 Header */}
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Globe size={10} />
                      {breadcrumb.map((seg, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && <ChevronRight size={8} className="opacity-40" />}
                          <span className={i === breadcrumb.length - 1 ? 'text-foreground font-medium' : ''}>{seg}</span>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setCurrentPath([]); fetchTree(''); }} className="p-0.5 hover:bg-muted rounded">
                        <RefreshCw size={11} className="text-muted-foreground" />
                      </button>
                      <button onClick={() => setShowBrowser(false)} className="p-0.5 hover:bg-muted rounded">
                        <X size={11} className="text-muted-foreground" />
                      </button>
                    </div>
                  </div>

                  {/* 浏览器列表 */}
                  <div className="max-h-48 overflow-y-auto p-1">
                    {/* 返回上级 */}
                    {currentPath.length > 0 && (
                      <button
                        onClick={goUp}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted text-left"
                      >
                        <Folder size={13} className="text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground">..</span>
                      </button>
                    )}

                    {treeLoading ? (
                      <div className="text-center py-4 text-[11px] text-muted-foreground">
                        <Loader2 size={14} className="animate-spin mx-auto mb-1" />
                        加载中...
                      </div>
                    ) : folders.length === 0 ? (
                      <div className="text-center py-4 text-[11px] text-muted-foreground">
                        此目录为空
                      </div>
                    ) : (
                      folders.map((node) => (
                        <button
                          key={node.path}
                          onClick={() => enterFolder(node)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted text-left group"
                        >
                          <ChevronRight size={12} className="text-muted-foreground shrink-0 opacity-40 group-hover:opacity-100" />
                          <Folder size={13} className="text-primary/70 shrink-0" />
                          <span className="text-[11px] truncate">{node.name}</span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* 选择当前目录 */}
                  <div className="border-t border-border px-3 py-2 flex justify-between items-center bg-muted/30">
                    <span className="text-[10px] text-muted-foreground">
                      当前: {currentPath.length > 0 ? currentPath.join('/') : '(根目录)'}
                    </span>
                    <button
                      onClick={selectCurrentDir}
                      className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium
                                 hover:opacity-90 transition-opacity"
                    >
                      选择此目录
                    </button>
                  </div>
                </div>
              )}

              {/* 标题 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  故障标题
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="如: HBA-PHY5-storcli2超时"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs
                             focus:outline-none focus:ring-2 focus:ring-primary/30"
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  autoFocus
                />
              </div>

              {error && <div className="text-xs text-destructive">{error}</div>}

              {saved && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <CheckCircle2 size={12} />
                  <span>已保存 → 已解决/{savePath || '(根)'}/{title}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground
                           hover:shadow-glow active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
