/**
 * 向聊天直接发送一条消息（复用 chatStore 的流式发送流程，不另造轮子）
 *
 * 没有活动会话时按现有逻辑新建会话（与 MainLayout EmptyState 的 createSession 一致）。
 * 供"问 AI"类按钮使用（错误聚类、时间窗分析等）。
 */

import type { LogFile } from '@/types';
import { errorClusterService } from '@/services/errorClusterService';
import { useChatStore, useSessionStore } from '@/stores';

export async function sendPromptToChat(
  sessionId: string | undefined,
  prompt: string
): Promise<void> {
  let sid = sessionId;
  if (!sid) {
    const session = await useSessionStore.getState().createSession();
    sid = session.id;
  }
  await useChatStore.getState().sendMessage(sid, prompt);
}

/**
 * 上传日志后自动出第一份分析：
 * 取 TOP 错误聚类组装 prompt 发到当前会话；无错误模式则发通用总结请求。
 * 聚类接口读的是已入库内容，上传接口返回时即可用。
 * 失败静默（不阻断上传成功的流程）。
 */
export async function analyzeUploadedLog(
  sessionId: string,
  logFile: LogFile
): Promise<void> {
  try {
    const data = await errorClusterService.getErrorClusters(logFile.id, 5);

    let prompt: string;
    if (data.total_error_lines > 0 && data.clusters.length > 0) {
      const items = data.clusters
        .map((c, i) => {
          const timeRange =
            c.first_seen || c.last_seen
              ? `，时段 ${c.first_seen || '?'} ~ ${c.last_seen || '?'}`
              : '';
          return `${i + 1}. ${c.pattern}（出现 ${c.count} 次${timeRange}）`;
        })
        .join('\n');
      prompt = [
        `刚上传了日志 ${logFile.filename}，共 ${data.total_error_lines} 行错误。TOP 错误模式：`,
        items,
        '',
        '请给出初步诊断和排查优先级建议。',
      ].join('\n');
    } else {
      prompt =
        `刚上传了日志 ${logFile.filename}（共 ${logFile.line_count} 行），` +
        '未发现明显的错误模式。请总结这份日志的基本情况和需要关注的问题。';
    }

    await sendPromptToChat(sessionId, prompt);
  } catch (err) {
    console.error('上传后自动分析失败:', err);
  }
}
