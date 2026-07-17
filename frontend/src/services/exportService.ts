/**
 * 对话导出 API
 */

const BASE_URL = '/api';

export const exportService = {
  /** 导出为 Markdown */
  exportMarkdown: async (sessionId: string) => {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/export?format=markdown`, {
      credentials: 'include',
    });

    if (!response.ok) throw new Error('导出失败');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${sessionId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** 导出为 PDF */
  exportPdf: async (sessionId: string) => {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/export?format=pdf`, {
      credentials: 'include',
    });

    if (!response.ok) throw new Error('导出失败');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${sessionId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
