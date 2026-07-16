/**
 * SSE 流式请求 Hook
 * 支持断线自动重连
 */

import { useCallback, useRef } from 'react';

interface StreamOptions {
  onChunk: (content: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onThinking?: (message: string) => void;
  onSessionTitle?: (title: string) => void;
  maxRetries?: number;
}

export function useStreaming() {
  const abortRef = useRef<AbortController | null>(null);

  const stream = useCallback(
    async (path: string, body: unknown, options: StreamOptions) => {
      const { onChunk, onDone, onError, onThinking, maxRetries = 2 } = options;
      let retries = 0;

      const doStream = async () => {
        const token = localStorage.getItem('token');
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const response = await fetch(`/api${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('无法读取响应流');

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const data = JSON.parse(line.slice(6));
                if (data.status === 'thinking' && onThinking) {
                  onThinking(data.message);
                } else if (data.content) {
                  onChunk(data.content);
                } else if (data.done) {
                  if (data.session_title && options.onSessionTitle) {
                    options.onSessionTitle(data.session_title);
                  }
                  onDone();
                  return;
                } else if (data.error) {
                  onError(data.error);
                  return;
                }
              } catch {
                // skip invalid JSON
              }
            }
          }

          onDone();
        } catch (err: any) {
          if (err.name === 'AbortError') return;

          // 断线重连
          if (retries < maxRetries && !err.message?.includes('401')) {
            retries++;
            console.log(`SSE 重连 ${retries}/${maxRetries}...`);
            await new Promise((r) => setTimeout(r, 1000 * retries));
            return doStream();
          }

          onError(err.message || '连接失败');
        }
      };

      await doStream();
    },
    []
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { stream, abort };
}
