/**
 * 统一 HTTP 客户端
 * 鉴权由 httpOnly cookie 自动携带（credentials: 'include'），401 时跳转登录页
 */

const BASE_URL = '/api';

interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

function clearAuth() {
  // token 由 httpOnly cookie 管理，JS 无法读取/清除；这里只清理本地用户信息。
  // cookie 由 /auth/logout 端点删除，或在下次登录时被覆盖。
  localStorage.removeItem('user');
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: Record<string, unknown>;
}

async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const body = options.body ? JSON.stringify(options.body) : undefined;

  const response = await fetch(url, {
    ...options,
    headers,
    body,
    credentials: 'include',
  });

  // 401 → 清除 token，跳转登录
  if (response.status === 401) {
    clearAuth();
    window.location.href = '/login';
    throw new Error('登录已过期');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    console.error('[http.request] error', response.status, error);
    throw new Error(error.message || error.detail || `HTTP ${response.status}`);
  }

  const result: ApiResponse<T> = await response.json();

  if (result.code !== 0) {
    throw new Error(result.message || '请求失败');
  }

  return result.data;
}

export const http = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body as Record<string, unknown>,
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body as Record<string, unknown>,
    }),

  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),

  /**
   * SSE 流式请求
   */
  stream: async function* (
    path: string,
    body: unknown,
    signal?: AbortSignal
  ): AsyncGenerator<{ content?: string; done?: boolean; error?: string; status?: string; message?: string }> {
    const url = `${BASE_URL}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
      credentials: 'include',
    });

    if (response.status === 401) {
      clearAuth();
      window.location.href = '/login';
      throw new Error('登录已过期');
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              yield data;
            } catch {
              // skip invalid JSON
            }
          }
        }
      }

      if (buffer.startsWith('data: ')) {
        try {
          const data = JSON.parse(buffer.slice(6));
          yield data;
        } catch {
          // skip
        }
      }
    } finally {
      // 正常结束或被 AbortController.abort() 取消时，释放底层 reader
      try { await reader.cancel(); } catch { /* 已释放 */ }
    }
  },
};

/**
 * 文件上传（带 token）
 */
export async function uploadFile<T>(
  path: string,
  file: File,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const formData = new FormData();
  formData.append('file', file);

  const headers: Record<string, string> = {};

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });

  if (response.status === 401) {
    clearAuth();
    window.location.href = '/login';
    throw new Error('登录已过期');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '上传失败' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const result: ApiResponse<T> = await response.json();

  if (result.code !== 0) {
    throw new Error(result.message || '上传失败');
  }

  return result.data;
}
