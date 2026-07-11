/**
 * 审计日志查看面板
 */

import { useState, useEffect } from 'react';
import { Shield, ChevronLeft, ChevronRight } from 'lucide-react';
import { auditService, type AuditLog } from '@/services/auditService';
import { formatTime } from '@/utils';

const ACTION_LABELS: Record<string, string> = {
  login: '登录',
  login_failed: '登录失败',
  logout: '登出',
  upload_log: '上传日志',
  send_message: '发送对话',
  save_to_knowledge: '保存到知识库',
  create_user: '创建用户',
  delete_user: '删除用户',
  update_settings: '修改设置',
  create_rule: '创建规则',
  delete_rule: '删除规则',
};

export function AuditPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 30;

  const fetchLogs = async (p: number) => {
    setLoading(true);
    try {
      const data = await auditService.list(p, limit);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      console.error('获取审计日志失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(page);
  }, [page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Shield size={16} className="text-primary" />
        <span>操作日志</span>
        <span className="text-xs text-muted-foreground">共 {total} 条</span>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-8 text-sm">加载中...</div>
      ) : logs.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 text-sm">暂无记录</div>
      ) : (
        <>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">时间</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">用户</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">操作</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">详情</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(log.created_at)}
                    </td>
                    <td className="px-3 py-2 text-xs">{log.username}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                      {log.detail || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="p-1.5 hover:bg-muted rounded transition-colors disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 hover:bg-muted rounded transition-colors disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
