/**
 * 统一 HTTP 客户端
 * 自动携带 JWT token，401 时跳转登录页
 */

const BASE_URL = '/api';

interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

function getToken(): string | null {
  return localStorage.getItem('token');
}

function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

interface RequestOptions extends RequestInit {
  body?: Record<string, unknown>;
}

async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const body = options.body ? JSON.stringify(options.body) : undefined;

  console.log('[http.request]', options.method || 'GET', url, options.body || null);

  const response = await fetch(url, {
    ...options,
    headers,
    body,
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
    body: unknown
  ): AsyncGenerator<{ content?: string; done?: boolean; error?: string; status?: string; message?: string }> {
    const url = `${BASE_URL}${path}`;
    const token = getToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
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

  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: formData,
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
