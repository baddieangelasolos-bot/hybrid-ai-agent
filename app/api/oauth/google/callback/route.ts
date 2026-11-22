import { isAuthed, safeEqual, signValue } from '@/lib/auth';
import { appOrigin, errMsg } from '@/lib/http';
import { redactSecrets } from '@/lib/security';
import { triggerRedeploy, upsertEnvVars } from '@/lib/vercel';

export const runtime = 'nodejs';
export const maxDuration = 60;

function back(req: Request, status: 'ok' | 'error', msg: string): Response {
  const url = new URL('/', appOrigin(req));
  url.searchParams.set('connector', 'google_drive');
  url.searchParams.set('status', status);
  url.searchParams.set('msg', msg.slice(0, 200));
  return Response.redirect(url.toString(), 303);
}

function stateValid(state: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > 10 * 60 * 1000) return false;
  return safeEqual(sig, signValue(ts + '.' + nonce));
}

export async function GET(req: Request): Promise<Response> {
  if (!isAuthed(req)) return back(req, 'error', 'Sign in at ' + appOrigin(req) + ' first (same address you authorize from), then press Authorize again.');
  const params = new URL(req.url).searchParams;
  const oauthError = params.get('error');
  if (oauthError) return back(req, 'error', 'Google returned: ' + oauthError);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || !stateValid(state)) return back(req, 'error', 'Invalid or expired authorization state. Try again.');

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: appOrigin(req) + '/api/oauth/google/callback',
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) return back(req, 'error', 'Token exchange failed: ' + redactSecrets(text).slice(0, 120));
    const data = JSON.parse(text) as { refresh_token?: string };
    if (!data.refresh_token) {
      return back(req, 'error', 'Google sent no refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
    }
    await upsertEnvVars({ GOOGLE_REFRESH_TOKEN: data.refresh_token }, () => true);
    const redeploy = await triggerRedeploy();
    return back(req, 'ok', redeploy.ok ? 'Connected. Redeploying so Drive sync can start (about a minute).' : 'Token saved. Redeploy manually to activate Drive sync: ' + redeploy.detail);
  } catch (e) {
    return back(req, 'error', redactSecrets(errMsg(e)));
  }
}
