import { requireAuth } from '@/lib/auth';
import { driveConfigured } from '@/lib/drive';
import { knownEnvNames } from '@/lib/connectors/registry';
import { appOrigin, errMsg, json } from '@/lib/http';
import { envIsSecret, isAllowedEnvName, maskValue, redactSecrets } from '@/lib/security';
import { listEnvNames, triggerRedeploy, upsertEnvVars } from '@/lib/vercel';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  const runtimeEnv: Record<string, boolean> = {};
  for (const name of knownEnvNames()) runtimeEnv[name] = Boolean(process.env[name]);
  for (const key of Object.keys(process.env)) {
    if (/^CUSTOM_[A-Z0-9_]{1,50}_(URL|KEY)$/.test(key)) runtimeEnv[key] = true;
  }

  let vercelNames: string[] | null = null;
  let vercelError: string | null = null;
  if (process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID) {
    try {
      vercelNames = (await listEnvNames()).filter((n) => isAllowedEnvName(n) || n === 'APP_PASSWORD');
    } catch (e) {
      vercelError = redactSecrets(errMsg(e));
    }
  }

  return json({
    ok: true,
    runtime: runtimeEnv,
    vercelNames,
    vercelError,
    canWrite: Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID),
    driveConfigured: driveConfigured(),
    redirectUri: appOrigin(req) + '/api/oauth/google/callback',
  });
}

export async function POST(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  let body: { vars?: unknown; redeploy?: unknown };
  try {
    body = (await req.json()) as { vars?: unknown; redeploy?: unknown };
  } catch {
    return json({ ok: false, code: 'bad-request', message: 'Invalid JSON body.' }, 400);
  }
  if (!body.vars || typeof body.vars !== 'object' || Array.isArray(body.vars)) {
    return json({ ok: false, code: 'bad-request', message: 'vars must be an object of NAME: value.' }, 400);
  }

  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(body.vars as Record<string, unknown>)) {
    if (!isAllowedEnvName(name)) {
      return json({ ok: false, code: 'forbidden-name', message: name + ' cannot be changed from the app.' }, 400);
    }
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4096 || /[\r\n]/.test(value)) {
      return json({ ok: false, code: 'bad-value', message: 'Value for ' + name + ' must be a single non-empty line (max 4096 characters).' }, 400);
    }
    vars[name] = value.trim();
  }
  if (Object.keys(vars).length === 0) {
    return json({ ok: false, code: 'bad-request', message: 'No variables supplied.' }, 400);
  }

  try {
    await upsertEnvVars(vars, envIsSecret);
  } catch (e) {
    return json({ ok: false, code: 'vercel-error', message: redactSecrets(errMsg(e)) }, 502);
  }

  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) masked[name] = envIsSecret(name) ? maskValue(value) : value;

  const redeploy = body.redeploy === true ? await triggerRedeploy() : null;
  return json({ ok: true, saved: Object.keys(vars), masked, redeploy });
}
