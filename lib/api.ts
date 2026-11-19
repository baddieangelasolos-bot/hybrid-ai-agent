export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
}

export async function apiRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const obj = (data ?? {}) as { ok?: boolean; message?: string };
    const ok = res.ok && obj.ok !== false;
    return { ok, status: res.status, data: data as T | null, message: ok ? '' : obj.message ?? 'Request failed (' + res.status + ')' };
  } catch (e) {
    return { ok: false, status: 0, data: null, message: e instanceof Error ? e.message : 'Network error' };
  }
}
