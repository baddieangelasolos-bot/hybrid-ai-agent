import { requireAuth } from '@/lib/auth';
import { DriveError, driveConfigured, driveDelete, driveGet, driveHealth, driveList, drivePut } from '@/lib/drive';
import { errMsg, json } from '@/lib/http';
import { redactSecrets } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_VALUE = 2 * 1024 * 1024;

function fail(e: unknown): Response {
  if (e instanceof DriveError) {
    const status = e.code === 'not-found' ? 404 : 503;
    return json({ ok: false, code: e.code, message: e.message }, status);
  }
  return json({ ok: false, code: 'unknown', message: redactSecrets(errMsg(e)) }, 500);
}

export async function GET(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  try {
    if (params.get('health')) {
      if (!driveConfigured()) {
        return json({ ok: false, code: 'not-configured', message: 'Google Drive is not connected yet.' }, 503);
      }
      const info = await driveHealth();
      return json({ ok: true, ...info });
    }
    const key = params.get('key');
    if (key) {
      const doc = await driveGet(key);
      return json({ ok: true, key, value: doc.value, updatedAt: doc.updatedAt });
    }
    const items = await driveList(params.get('prefix') ?? '');
    return json({ ok: true, items });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { key?: unknown; value?: unknown; updatedAt?: unknown };
    if (typeof body.key !== 'string' || typeof body.value !== 'string') {
      return json({ ok: false, code: 'bad-request', message: 'key and value must be strings.' }, 400);
    }
    if (body.value.length > MAX_VALUE) {
      return json({ ok: false, code: 'too-large', message: 'Value exceeds 2 MB.' }, 413);
    }
    const updatedAt = typeof body.updatedAt === 'number' ? body.updatedAt : Date.now();
    await drivePut(body.key, body.value, updatedAt);
    return json({ ok: true, key: body.key, updatedAt });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;
  const key = new URL(req.url).searchParams.get('key');
  if (!key) return json({ ok: false, code: 'bad-request', message: 'key is required.' }, 400);
  try {
    await driveDelete(key);
    return json({ ok: true, key });
  } catch (e) {
    return fail(e);
  }
}
