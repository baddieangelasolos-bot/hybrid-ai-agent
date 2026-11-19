import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { json, requestOrigin } from './http';

const COOKIE_NAME = 'hya_session';
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;
const failures = new Map<string, { count: number; first: number }>();

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function passwordConfigured(): boolean {
  const p = process.env.APP_PASSWORD;
  return typeof p === 'string' && p.length >= 8;
}

export function verifyPassword(candidate: string): boolean {
  const p = process.env.APP_PASSWORD;
  if (typeof p !== 'string' || p.length < 8) return false;
  return safeEqual(candidate, p);
}

export function sessionToken(): string {
  return createHmac('sha256', process.env.APP_PASSWORD ?? '').update('hybrid-ai-agent:session:v1').digest('hex');
}

export function signValue(value: string): string {
  return createHmac('sha256', process.env.APP_PASSWORD ?? '').update('hybrid-ai-agent:sign:v1:' + value).digest('hex');
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function isThrottled(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILS;
}

export function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || now - entry.first > WINDOW_MS) {
    failures.set(ip, { count: 1, first: now });
  } else {
    entry.count += 1;
  }
}

export function clearFailures(ip: string): void {
  failures.delete(ip);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function isAuthed(req: Request): boolean {
  if (!passwordConfigured()) return false;
  const cookie = parseCookies(req.headers.get('cookie'))[COOKIE_NAME];
  if (cookie && safeEqual(cookie, sessionToken())) return true;
  const header = req.headers.get('x-app-password');
  return header !== null && verifyPassword(header);
}

function originAllowed(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(requestOrigin(req)).host;
  } catch {
    return false;
  }
}

/** Returns an error Response when the request is not allowed, otherwise null. */
export function requireAuth(req: Request): Response | null {
  if (!passwordConfigured()) {
    return json({ ok: false, code: 'not-configured', message: 'APP_PASSWORD is not set (minimum 8 characters).' }, 503);
  }
  if (!originAllowed(req)) {
    return json({ ok: false, code: 'bad-origin', message: 'Cross-origin request blocked.' }, 403);
  }
  if (!isAuthed(req)) {
    return json({ ok: false, code: 'app-auth', message: 'Not signed in.' }, 401);
  }
  return null;
}

export function sessionCookie(secure: boolean): string {
  return COOKIE_NAME + '=' + sessionToken() + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000' + (secure ? '; Secure' : '');
}

export function clearedCookie(secure: boolean): string {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}
