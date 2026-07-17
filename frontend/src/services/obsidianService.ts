/**
 * Obsidian 知识库 API
 */

import type { ObsidianSettings } from '@/types';
import { http } from './http';

export interface NoteInfo {
  filename: string;
  date: string;
  title: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileTreeNode[];
}

export interface SearchResult {
  filename: string;
  path: string;
  title: string;
  snippet: string;
}

export interface ResolvedFile {
  filename: string;
  title: string;
  model: string;
  size: number;
  mtime: number;
}

export const obsidianService = {
  /** 保存分析结果。model=机型(子目录), repair_notes=维修操作, session_id=标记已解决 */
  save: (data: {
    title: string;
    model?: string;
    log_summary?: string;
    log_snippet?: string;
    analysis: string;
    repair_notes?: string;
    session_id?: string;
    resolved?: boolean;
  }) => http.post<{ success: boolean; filename: string; message: string }>('/obsidian/save', data),

  /** 获取笔记列表 */
  listNotes: () => http.get<{ notes: NoteInfo[] }>('/obsidian/notes'),

  /** 获取笔记内容 */
  getNote: (filename: string) =>
    http.get<{ filename: string; content: string }>(`/obsidian/notes/${encodeURIComponent(filename)}`),

  /** 获取文件树 */
  getFileTree: (path?: string) =>
    http.get<{ tree: FileTreeNode[] }>(`/obsidian/tree${path ? `?path=${encodeURIComponent(path)}` : ''}`),

  /** 获取文件内容 */
  getFileContent: (path: string) =>
    http.get<{ path: string; content: string }>(`/obsidian/file?path=${encodeURIComponent(path)}`),

  /** 全文搜索 */
  search: (query: string) =>
    http.get<{ results: SearchResult[]; total: number }>(`/obsidian/search?q=${encodeURIComponent(query)}`),

  /** 获取知识库配置 */
  getSettings: () => http.get<ObsidianSettings>('/obsidian/settings'),

  /** 更新知识库配置 */
  updateSettings: (data: {
    webdav_url?: string;
    webdav_user?: string;
    webdav_pass?: string;
    vault_path?: string;
    browse_paths?: string[];
    resolved_path?: string;
    auto_save?: boolean;
  }) => http.put<ObsidianSettings>('/obsidian/settings', data),

  /** 获取浏览目录配置 */
  getBrowsePaths: () => http.get<{ browse_paths: string[] }>('/obsidian/browse-paths'),

  /** 列出已解决故障记录 */
  listResolved: () => http.get<ResolvedFile[]>('/obsidian/resolved/list'),

  /** 读取已解决记录内容 */
  getResolvedFile: (filename: string) =>
    http.get<{ filename: string; content: string }>(`/obsidian/resolved/file?filename=${encodeURIComponent(filename)}`),

  /** 删除已解决记录（管理员） */
  deleteResolvedFile: (filename: string) =>
    http.delete<{ message: string }>(`/obsidian/resolved/file?filename=${encodeURIComponent(filename)}`),
};
