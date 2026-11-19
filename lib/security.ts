import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { knownEnvNames, isPlainEnv } from './connectors/registry';

/** Files the AI agent may never modify or delete (auth, secrets handling, CI, OAuth). */
export const PROTECTED_FILES = new Set<string>([
  'lib/auth.ts',
  'lib/security.ts',
  'lib/http.ts',
  'app/api/auth/route.ts',
  'app/api/settings/route.ts',
  'next.config.ts',
  '.gitignore',
]);
export const PROTECTED_PREFIXES: string[] = ['app/api/oauth/', '.github/'];

/** Files the agent may edit but never delete. */
export const CORE_FILES = new Set<string>([
  'package.json',
  'tsconfig.json',
  'app/layout.tsx',
  'app/page.tsx',
  'app/globals.css',
  'app/api/chat/route.ts',
  'app/api/storage/route.ts',
  'lib/orchestrator.ts',
  'lib/failover.ts',
  'lib/storage.ts',
  'lib/drive.ts',
]);

const PATH_RE = /^[A-Za-z0-9._@()[\]\/-]+$/;

export type Verdict = { ok: true } | { ok: false; reason: string };

export function validatePath(path: string): Verdict {
  if (path.length === 0 || path.length > 200) return { ok: false, reason: 'Invalid path length: ' + path };
  if (!PATH_RE.test(path)) return { ok: false, reason: 'Path contains unsupported characters: ' + path };
  if (path.startsWith('/') || path.includes('..') || path.includes('//')) return { ok: false, reason: 'Path escapes the repo: ' + path };
  const lower = path.toLowerCase();
  if (lower.startsWith('.git/') || lower === '.git') return { ok: false, reason: '.git is off limits.' };
  if (lower.startsWith('node_modules/') || lower.startsWith('.next/')) return { ok: false, reason: 'Build artifacts must not be committed: ' + path };
  const base = lower.split('/').pop() ?? '';
  if (base === '.env' || base.startsWith('.env.') && base !== '.env.example') return { ok: false, reason: 'Never commit environment files: ' + path };
  return { ok: true };
}

export function isProtectedPath(path: string): boolean {
  if (PROTECTED_FILES.has(path)) return true;
  return PROTECTED_PREFIXES.some((p) => path.startsWith(p));
}

export interface PushFile {
  path: string;
  action: 'write' | 'delete';
  content?: string;
}

/** Code-level enforcement of the anti-destruction rules (not just a prompt). */
export function validatePushFiles(files: PushFile[]): Verdict {
  const seen = new Set<string>();
  for (const f of files) {
    const v = validatePath(f.path);
    if (!v.ok) return v;
    if (seen.has(f.path)) return { ok: false, reason: 'Duplicate path in one commit: ' + f.path };
    seen.add(f.path);
    if (isProtectedPath(f.path)) return { ok: false, reason: 'Protected file, edit it manually: ' + f.path };
    if (f.action === 'delete') {
      if (CORE_FILES.has(f.path)) return { ok: false, reason: 'Core file cannot be deleted: ' + f.path };
      continue;
    }
    const content = f.content ?? '';
    if (content.trim().length === 0) return { ok: false, reason: 'Empty content for ' + f.path + ' (use delete to remove files).' };
    if (/^app\/api\/.+\/route\.tsx?$/.test(f.path) && !content.includes('requireAuth(')) {
      return { ok: false, reason: 'Every API route must call requireAuth(): ' + f.path };
    }
    if (content.includes('process.env.APP_PASSWORD')) return { ok: false, reason: 'Code may not read APP_PASSWORD directly: ' + f.path };
    if (f.path === 'app/api/chat/route.ts' && !content.includes('requireAuth(')) {
      return { ok: false, reason: 'The chat route must keep its auth gate.' };
    }
  }
  return { ok: true };
}

export function isAllowedEnvName(name: string): boolean {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) return false;
  if (knownEnvNames().has(name)) return true;
  return /^CUSTOM_[A-Z0-9_]{1,50}_(URL|KEY)$/.test(name);
}

export function envIsSecret(name: string): boolean {
  return !isPlainEnv(name);
}

const SECRET_PATTERNS: RegExp[] = [
  /gsk_[A-Za-z0-9]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-or-[A-Za-z0-9-]{10,}/g,
  /tvly-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  for (const name of knownEnvNames()) {
    if (isPlainEnv(name)) continue;
    const v = process.env[name];
    if (v && v.length >= 8) out = out.split(v).join('[redacted]');
  }
  return out;
}

export function maskValue(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return value.slice(0, 3) + '*'.repeat(Math.min(value.length - 6, 12)) + value.slice(-3);
}

export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ip.split('.').map((n) => Number(n));
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0 && p[2] === 0) return true;
    if (a >= 224) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

/** SSRF guard for user-supplied webhook URLs: https only, public addresses only. */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Webhook URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Webhook URL must use https.');
  if (url.username || url.password) throw new Error('Webhook URL must not contain credentials.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new Error('Webhook host is not public.');
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Webhook address is private.');
    return url;
  }
  const records = await lookup(host, { all: true });
  if (records.length === 0) throw new Error('Webhook host did not resolve.');
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new Error('Webhook host resolves to a private address.');
  }
  return url;
}

export function slugId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}
