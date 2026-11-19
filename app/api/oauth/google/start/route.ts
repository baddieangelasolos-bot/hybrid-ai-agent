import { randomBytes } from 'node:crypto';
import { requireAuth, signValue } from '@/lib/auth';
import { json, requestOrigin } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return json({ ok: false, code: 'not-configured', message: 'Save GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first, then wait for the redeploy.' }, 400);
  }
  const ts = String(Date.now());
  const nonce = randomBytes(12).toString('hex');
  const state = ts + '.' + nonce + '.' + signValue(ts + '.' + nonce);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: requestOrigin(req) + '/api/oauth/google/callback',
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return json({ ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() });
}
