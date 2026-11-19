import { redactSecrets } from './security';

interface VercelCfg {
  token: string;
  projectId: string;
  teamId?: string;
}

export function vercelConfig(): VercelCfg {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token) throw new Error('Vercel is not configured: set VERCEL_TOKEN.');
  if (!projectId) throw new Error('VERCEL_PROJECT_ID is missing. It is provided automatically on Vercel deployments.');
  const teamId = process.env.VERCEL_TEAM_ID || undefined;
  return { token, projectId, teamId };
}

async function vfetch(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
  const cfg = vercelConfig();
  const sep = path.includes('?') ? '&' : '?';
  const url = 'https://api.vercel.com' + path + (cfg.teamId ? sep + 'teamId=' + encodeURIComponent(cfg.teamId) : '');
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Vercel ' + res.status + ': ' + redactSecrets(text).slice(0, 300));
  return text ? (JSON.parse(text) as unknown) : null;
}

export async function listEnvNames(): Promise<string[]> {
  const cfg = vercelConfig();
  const data = (await vfetch('/v9/projects/' + encodeURIComponent(cfg.projectId) + '/env')) as { envs?: { key: string }[] } | null;
  const names = new Set<string>();
  for (const e of data?.envs ?? []) names.add(e.key);
  return [...names].sort();
}

/** Create or replace env vars. Secrets are stored as Vercel "sensitive" variables (write-only). */
export async function upsertEnvVars(vars: Record<string, string>, isSecret: (name: string) => boolean): Promise<void> {
  const cfg = vercelConfig();
  const body = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    type: isSecret(key) ? 'sensitive' : 'plain',
    target: ['production', 'preview'],
  }));
  if (body.length === 0) return;
  await vfetch('/v10/projects/' + encodeURIComponent(cfg.projectId) + '/env?upsert=true', { method: 'POST', body: JSON.stringify(body) });
}

export interface RedeployResult {
  ok: boolean;
  method: 'hook' | 'api' | 'none';
  detail: string;
}

export async function triggerRedeploy(): Promise<RedeployResult> {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  try {
    if (hook) {
      const res = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(20000) });
      return { ok: res.ok, method: 'hook', detail: res.ok ? 'Deploy hook triggered.' : 'Deploy hook returned ' + res.status };
    }
    const cfg = vercelConfig();
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
    if (!deploymentId) return { ok: false, method: 'none', detail: 'No deploy hook and no current deployment id available.' };
    const body = {
      name: 'hybrid-ai-agent',
      project: cfg.projectId,
      deploymentId,
      target: process.env.VERCEL_ENV === 'production' ? 'production' : undefined,
    };
    await vfetch('/v13/deployments?forceNew=1', { method: 'POST', body: JSON.stringify(body) });
    return { ok: true, method: 'api', detail: 'Redeploy started through the Vercel API.' };
  } catch (e) {
    return { ok: false, method: 'none', detail: redactSecrets(e instanceof Error ? e.message : String(e)) };
  }
}

export interface DeploymentSummary {
  id: string;
  url: string;
  state: string;
  created: number;
  commit: string;
}

export async function latestDeployments(limit = 3): Promise<DeploymentSummary[]> {
  const cfg = vercelConfig();
  const data = (await vfetch('/v6/deployments?projectId=' + encodeURIComponent(cfg.projectId) + '&limit=' + limit)) as {
    deployments?: { uid: string; url?: string; state?: string; readyState?: string; created?: number; meta?: Record<string, string> }[];
  } | null;
  return (data?.deployments ?? []).map((d) => ({
    id: d.uid,
    url: d.url ? 'https://' + d.url : '',
    state: d.state ?? d.readyState ?? 'UNKNOWN',
    created: d.created ?? 0,
    commit: d.meta?.githubCommitMessage ?? '',
  }));
}

export async function deploymentLogLines(deploymentId: string, maxLines = 60): Promise<string[]> {
  const data = (await vfetch('/v3/deployments/' + encodeURIComponent(deploymentId) + '/events?limit=300&direction=backward')) as unknown;
  const events = Array.isArray(data) ? (data as { text?: string; payload?: { text?: string } }[]) : [];
  const lines = events
    .map((e) => e.text ?? e.payload?.text ?? '')
    .filter((t) => t.length > 0)
    .reverse();
  return lines.slice(-maxLines).map((l) => redactSecrets(l).slice(0, 400));
}
