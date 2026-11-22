export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}

export function requestOrigin(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return proto + '://' + host;
}

/** Stable public origin of the app (never a per-deployment URL), used for OAuth redirect URIs. */
export function appOrigin(req: Request): string {
  const fixed = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (fixed && /^https:\/\/[^/\s]+$/.test(fixed)) return fixed;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return 'https://' + prod.replace(/^https?:\/\//, '');
  return requestOrigin(req);
}
