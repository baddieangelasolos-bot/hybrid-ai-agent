import { requireAuth } from '@/lib/auth';
import { DriveError, driveConfigured, driveHealth } from '@/lib/drive';
import { errMsg, json } from '@/lib/http';
import { redactSecrets } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Status = 'ok' | 'warn' | 'fail' | 'missing';

interface Check {
  id: string;
  name: string;
  status: Status;
  detail: string;
}

async function probe(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  return { status: res.status, body: await res.text() };
}

function safe(e: unknown): string {
  return redactSecrets(errMsg(e)).slice(0, 160);
}

function httpVerdict(status: number, name: string): Check['status'] {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'warn';
  return 'fail';
}

async function checkCloudflare(): Promise<Check> {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const base = { id: 'cloudflare', name: 'Cloudflare Workers AI (images)' };
  if (!acct || !token) return { ...base, status: 'missing', detail: 'Optional. Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free) for the best free image generation.' };
  try {
    const r = await probe('https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(acct) + '/tokens/verify', { Authorization: 'Bearer ' + token });
    if (r.status === 200) return { ...base, status: 'ok', detail: 'Token is valid. FLUX and SDXL image models are available.' };
    return { ...base, status: 'fail', detail: 'Cloudflare answered HTTP ' + r.status + '. Check the account id and that the token has Workers AI permission.' };
  } catch (e) {
    return { ...base, status: 'warn', detail: 'Could not verify: ' + safe(e) };
  }
}

async function checkHuggingFace(): Promise<Check> {
  const token = process.env.HF_TOKEN;
  const base = { id: 'huggingface', name: 'Hugging Face (images, HF_TOKEN)' };
  if (!token) return { ...base, status: 'missing', detail: 'Optional second image provider. Free token at huggingface.co/settings/tokens.' };
  try {
    const r = await probe('https://huggingface.co/api/whoami-v2', { Authorization: 'Bearer ' + token });
    if (r.status === 200) return { ...base, status: 'ok', detail: 'Token is valid.' };
    return { ...base, status: 'fail', detail: 'Hugging Face answered HTTP ' + r.status + '.' };
  } catch (e) {
    return { ...base, status: 'warn', detail: 'Could not verify: ' + safe(e) };
  }
}

async function checkGitHub(): Promise<Check> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const base = { id: 'github', name: 'GitHub (GITHUB_TOKEN + GITHUB_REPO)' };
  if (!token) return { ...base, status: 'missing', detail: 'GITHUB_TOKEN not set. Needed for the agent to read and edit its own repo.' };
  if (!repo) return { ...base, status: 'missing', detail: 'GITHUB_REPO not set (owner/name).' };
  try {
    const r = await probe('https://api.github.com/repos/' + repo, {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'hybrid-ai-agent',
    });
    if (r.status === 401) return { ...base, status: 'fail', detail: 'Token rejected (401). It may be expired or mistyped.' };
    if (r.status === 404) return { ...base, status: 'fail', detail: 'Repo not visible to this token (404). Check GITHUB_REPO and that the token includes this repository.' };
    if (r.status !== 200) return { ...base, status: 'fail', detail: 'GitHub answered HTTP ' + r.status + '.' };
    const push = (JSON.parse(r.body) as { permissions?: { push?: boolean } }).permissions?.push === true;
    return push
      ? { ...base, status: 'ok', detail: 'Token works and can push to ' + repo + '.' }
      : { ...base, status: 'warn', detail: 'Token can read ' + repo + ' but not write. Grant Contents: Read and write.' };
  } catch (e) {
    return { ...base, status: 'fail', detail: 'Could not reach GitHub: ' + safe(e) };
  }
}

async function checkVercel(): Promise<Check> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const team = process.env.VERCEL_TEAM_ID;
  const base = { id: 'vercel', name: 'Vercel (VERCEL_TOKEN)' };
  if (!token) return { ...base, status: 'missing', detail: 'VERCEL_TOKEN not set. Needed for build checks and saving secrets from the app.' };
  if (!projectId) return { ...base, status: 'warn', detail: 'VERCEL_PROJECT_ID is not available (only set on Vercel deployments).' };
  try {
    const r = await probe('https://api.vercel.com/v9/projects/' + encodeURIComponent(projectId) + (team ? '?teamId=' + encodeURIComponent(team) : ''), { Authorization: 'Bearer ' + token });
    if (r.status === 401 || r.status === 403) return { ...base, status: 'fail', detail: 'Token rejected (HTTP ' + r.status + '). Make sure it is scoped to the right team.' };
    if (r.status === 404) return { ...base, status: 'fail', detail: 'Project not found. Check VERCEL_TEAM_ID.' };
    return { ...base, status: httpVerdict(r.status, 'vercel'), detail: r.status === 200 ? 'Token works for this project.' : 'Vercel answered HTTP ' + r.status + '.' };
  } catch (e) {
    return { ...base, status: 'fail', detail: 'Could not reach Vercel: ' + safe(e) };
  }
}

async function checkTavily(): Promise<Check> {
  const key = process.env.TAVILY_API_KEY;
  const base = { id: 'tavily', name: 'Tavily (TAVILY_API_KEY)' };
  if (!key) return { ...base, status: 'missing', detail: 'Not set (optional). Needed for web search.' };
  try {
    const r = await probe('https://api.tavily.com/usage', { Authorization: 'Bearer ' + key });
    if (r.status === 401 || r.status === 403) return { ...base, status: 'fail', detail: 'Key rejected by Tavily.' };
    return r.status === 200 ? { ...base, status: 'ok', detail: 'Key works.' } : { ...base, status: 'warn', detail: 'Key saved; could not verify (HTTP ' + r.status + ').' };
  } catch (e) {
    return { ...base, status: 'warn', detail: 'Key saved; could not verify: ' + safe(e) };
  }
}

async function checkDrive(): Promise<Check> {
  const base = { id: 'drive', name: 'Google Drive sync' };
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return { ...base, status: 'missing', detail: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set.' };
  if (!driveConfigured()) return { ...base, status: 'warn', detail: 'Client ID and secret are set, but Drive is not authorized yet. Open Connectors > Google Drive > Authorize.' };
  try {
    await driveHealth();
    return { ...base, status: 'ok', detail: 'Drive reachable and not full. Cloud Sync is active.' };
  } catch (e) {
    if (e instanceof DriveError) return { ...base, status: e.code === 'quota' ? 'warn' : 'fail', detail: e.code + ': ' + e.message };
    return { ...base, status: 'fail', detail: safe(e) };
  }
}

export async function GET(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  const checks: Check[] = [
    { id: 'password', name: 'App password (APP_PASSWORD)', status: 'ok', detail: 'Set and working (you are signed in).' },
    ...(await Promise.all([checkCloudflare(), checkHuggingFace(), checkGitHub(), checkVercel(), checkTavily(), checkDrive()])),
  ];
  console.log('[health]', checks.map((c) => c.id + '=' + c.status).join(' '));
  return json({ ok: true, checks, at: Date.now() });
}
