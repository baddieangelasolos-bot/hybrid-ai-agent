import { clearFailures, clearedCookie, clientIp, isAuthed, isThrottled, passwordConfigured, recordFailure, sessionCookie, verifyPassword } from '@/lib/auth';
import { json, requestOrigin } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  return json({ ok: true, authed: isAuthed(req), configured: passwordConfigured() });
}

export async function POST(req: Request): Promise<Response> {
  if (!passwordConfigured()) {
    return json({ ok: false, code: 'not-configured', message: 'APP_PASSWORD is not set (minimum 8 characters).' }, 503);
  }
  const ip = clientIp(req);
  if (isThrottled(ip)) {
    return json({ ok: false, code: 'throttled', message: 'Too many attempts. Try again in a few minutes.' }, 429);
  }
  let password = '';
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === 'string') password = body.password;
  } catch {
    return json({ ok: false, code: 'bad-request', message: 'Invalid JSON body.' }, 400);
  }
  if (!verifyPassword(password)) {
    recordFailure(ip);
    return json({ ok: false, code: 'bad-password', message: 'Wrong password.' }, 401);
  }
  clearFailures(ip);
  const secure = requestOrigin(req).startsWith('https');
  return json({ ok: true, authed: true }, 200, { 'set-cookie': sessionCookie(secure) });
}

export async function DELETE(req: Request): Promise<Response> {
  const secure = requestOrigin(req).startsWith('https');
  return json({ ok: true, authed: false }, 200, { 'set-cookie': clearedCookie(secure) });
}
