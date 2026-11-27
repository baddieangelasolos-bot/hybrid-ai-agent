import { errMsg } from './http';
import { redactSecrets } from './security';

export type DriveErrorCode = 'not-configured' | 'auth' | 'quota' | 'network' | 'timeout' | 'not-found' | 'unknown';

export class DriveError extends Error {
  code: DriveErrorCode;
  status: number;
  constructor(code: DriveErrorCode, message: string, status = 0) {
    super(message);
    this.name = 'DriveError';
    this.code = code;
    this.status = status;
  }
}

const KEY_RE = /^[A-Za-z0-9._/-]{1,120}$/;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const APP_TAG = 'hybrid-ai-agent';

let cachedToken: { value: string; expires: number } | null = null;
let cachedFolderId: string | null = null;
const cachedSubfolders = new Map<string, string>();

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

export function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//') || key.startsWith('/')) {
    throw new DriveError('unknown', 'Invalid storage key.');
  }
}

/** Legacy flat filename for migration: "chat/123" -> "chat__123.json" */
function legacyFileName(key: string): string {
  return key.replace(/\//g, '__') + '.json';
}

/** Clean filename for subfolders: "chat/123" -> "123.json" */
function cleanFileName(key: string): string {
  const parts = key.split('/');
  return parts[parts.length - 1] + '.json';
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new DriveError('timeout', 'Google Drive did not answer in time.');
    }
    throw new DriveError('network', 'Could not reach Google: ' + redactSecrets(errMsg(e)));
  }
}

function classify(status: number, text: string): DriveError {
  const safe = redactSecrets(text).slice(0, 200);
  if (status === 401) return new DriveError('auth', 'Google rejected the credentials (401).', status);
  if (status === 403 && /storageQuotaExceeded|quotaExceeded|driveStorageLimitExceeded|teamDriveFull/i.test(text)) {
    return new DriveError('quota', 'Google Drive storage is full.', status);
  }
  if (status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(text)) {
    return new DriveError('quota', 'Google Drive rate limit reached. Try again shortly.', status);
  }
  if (status === 403) return new DriveError('auth', 'Google denied access (403): ' + safe, status);
  if (status === 404) return new DriveError('not-found', 'Not found in Google Drive.', status);
  return new DriveError('unknown', 'Google Drive error ' + status + ': ' + safe, status);
}

async function accessToken(): Promise<string> {
  if (!driveConfigured()) throw new DriveError('not-configured', 'Google Drive is not connected yet.');
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const res = await timedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    const authProblem = /invalid_grant|invalid_client|unauthorized_client/.test(text);
    throw new DriveError(authProblem ? 'auth' : 'unknown', 'Google token refresh failed: ' + redactSecrets(text).slice(0, 160), res.status);
  }
  const data = JSON.parse(text) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function api(path: string, init: RequestInit = {}, upload = false): Promise<Response> {
  const token = await accessToken();
  const base = upload ? 'https://www.googleapis.com/upload/drive/v3' : 'https://www.googleapis.com/drive/v3';
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer ' + token);
  const res = await timedFetch(base + path, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) cachedToken = null;
    throw classify(res.status, text);
  }
  return res;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function ensureFolder(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const name = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'Hybrid AI Agent - App Data';
  const q = "name = '" + escapeQuery(name) + "' and mimeType = '" + FOLDER_MIME + "' and trashed = false";
  const list = await api('/files?q=' + encodeURIComponent(q) + '&fields=files(id)&pageSize=1');
  const found = ((await list.json()) as { files?: { id: string }[] }).files?.[0];
  if (found) {
    cachedFolderId = found.id;
    return found.id;
  }
  const created = await api('/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
  });
  const id = ((await created.json()) as { id: string }).id;
  cachedFolderId = id;
  return id;
}

async function ensureSubfolder(segments: string[], parentId: string): Promise<string> {
  if (segments.length === 0) return parentId;
  const pathKey = parentId + '/' + segments.join('/');
  if (cachedSubfolders.has(pathKey)) return cachedSubfolders.get(pathKey)!;

  let currentParentId = parentId;
  for (let i = 0; i < segments.length; i++) {
    const name = segments[i];
    const subPathKey = parentId + '/' + segments.slice(0, i + 1).join('/');
    if (cachedSubfolders.has(subPathKey)) {
      currentParentId = cachedSubfolders.get(subPathKey)!;
      continue;
    }

    const q = "name = '" + escapeQuery(name) + "' and '" + currentParentId + "' in parents and mimeType = '" + FOLDER_MIME + "' and trashed = false";
    const res = await api('/files?q=' + encodeURIComponent(q) + '&fields=files(id)&pageSize=1');
    const found = ((await res.json()) as { files?: { id: string }[] }).files?.[0];

    if (found) {
      currentParentId = found.id;
    } else {
      const created = await api('/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [currentParentId] }),
      });
      currentParentId = ((await created.json()) as { id: string }).id;
    }
    cachedSubfolders.set(subPathKey, currentParentId);
  }
  return currentParentId;
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
  parents?: string[];
}

/** Finds a file by key, checking subfolders first, then legacy flat names. */
async function findFile(key: string, rootId: string): Promise<DriveFile | null> {
  const parts = key.split('/');
  const fileName = cleanFileName(key);
  const folderPath = parts.slice(0, -1);
  
  // 1. Try nested path
  if (folderPath.length > 0) {
    const subFolderId = await ensureSubfolder(folderPath, rootId);
    const q = "name = '" + escapeQuery(fileName) + "' and '" + subFolderId + "' in parents and trashed = false";
    const res = await api('/files?q=' + encodeURIComponent(q) + '&fields=files(id,name,modifiedTime,appProperties,parents)&pageSize=1');
    const found = ((await res.json()) as { files?: DriveFile[] }).files?.[0];
    if (found) return found;
  } else {
    const q = "name = '" + escapeQuery(fileName) + "' and '" + rootId + "' in parents and trashed = false";
    const res = await api('/files?q=' + encodeURIComponent(q) + '&fields=files(id,name,modifiedTime,appProperties,parents)&pageSize=1');
    const found = ((await res.json()) as { files?: DriveFile[] }).files?.[0];
    if (found) return found;
  }

  // 2. Try legacy flat name in root
  const legacyQ = "name = '" + escapeQuery(legacyFileName(key)) + "' and '" + rootId + "' in parents and trashed = false";
  const legacyRes = await api('/files?q=' + encodeURIComponent(legacyQ) + '&fields=files(id,name,modifiedTime,appProperties,parents)&pageSize=1');
  const legacyFound = ((await legacyRes.json()) as { files?: DriveFile[] }).files?.[0];
  
  if (legacyFound) {
    // Migration: move legacy file to correct subfolder and rename it
    const subFolderId = await ensureSubfolder(folderPath, rootId);
    await api('/files/' + legacyFound.id + '?addParents=' + subFolderId + '&removeParents=' + rootId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fileName }),
    });
    return { ...legacyFound, name: fileName, parents: [subFolderId] };
  }

  return null;
}

function multipart(metadata: object, content: string): { body: string; contentType: string } {
  const boundary = 'hya' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const body =
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
    '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + content +
    '\r\n--' + boundary + '--';
  return { body, contentType: 'multipart/related; boundary=' + boundary };
}

export interface HealthInfo {
  folderId: string;
  usage: number | null;
  limit: number | null;
}

export async function driveHealth(): Promise<HealthInfo> {
  const folderId = await ensureFolder();
  const res = await api('/about?fields=storageQuota(limit,usage)');
  const q = ((await res.json()) as { storageQuota?: { limit?: string; usage?: string } }).storageQuota;
  const limit = q?.limit ? Number(q.limit) : null;
  const usage = q?.usage ? Number(q.usage) : null;
  if (limit !== null && usage !== null && usage >= limit) throw new DriveError('quota', 'Google Drive storage is full.', 403);
  return { folderId, usage, limit };
}

export async function driveGet(key: string): Promise<{ value: string; updatedAt: number }> {
  assertKey(key);
  const rootId = await ensureFolder();
  const file = await findFile(key, rootId);
  if (!file) throw new DriveError('not-found', 'Not found in Google Drive.', 404);
  const res = await api('/files/' + file.id + '?alt=media');
  const updated = Number(file.appProperties?.updatedAt ?? Date.parse(file.modifiedTime ?? '') ?? 0);
  return { value: await res.text(), updatedAt: Number.isFinite(updated) ? updated : 0 };
}

export async function drivePut(key: string, value: string, updatedAt: number): Promise<void> {
  assertKey(key);
  const attempt = async (): Promise<void> => {
    const rootId = await ensureFolder();
    const existing = await findFile(key, rootId);
    const props = { updatedAt: String(updatedAt), key, app: APP_TAG };
    
    if (existing) {
      const m = multipart({ appProperties: props }, value);
      await api('/files/' + existing.id + '?uploadType=multipart&fields=id', { method: 'PATCH', headers: { 'Content-Type': m.contentType }, body: m.body }, true);
    } else {
      const folderPath = key.split('/').slice(0, -1);
      const parentId = await ensureSubfolder(folderPath, rootId);
      const m = multipart({ name: cleanFileName(key), parents: [parentId], mimeType: 'application/json', appProperties: props }, value);
      await api('/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': m.contentType }, body: m.body }, true);
    }
  };
  try {
    await attempt();
  } catch (e) {
    if (e instanceof DriveError && e.code === 'not-found') {
      cachedFolderId = null;
      cachedSubfolders.clear();
      await attempt();
      return;
    }
    throw e;
  }
}

export async function driveDelete(key: string): Promise<void> {
  assertKey(key);
  const rootId = await ensureFolder();
  const file = await findFile(key, rootId);
  if (!file) return;
  await api('/files/' + file.id, { method: 'DELETE' });
}

export async function driveList(prefix: string): Promise<{ key: string; updatedAt: number }[]> {
  const rootId = await ensureFolder();
  // Using appProperties to list across all subfolders reliably
  const q = "appProperties has { key='app' and value='" + APP_TAG + "' } and trashed = false";
  const res = await api('/files?q=' + encodeURIComponent(q) + '&fields=files(name,modifiedTime,appProperties)&pageSize=1000');
  const files = ((await res.json()) as { files?: DriveFile[] }).files ?? [];
  
  const items = files.map((f) => {
    // Priority: property key, or fallback to reconstructing key from name (less reliable for deep paths)
    const key = f.appProperties?.key || f.name.replace(/\.json$/, ''); 
    return {
      key,
      updatedAt: Number(f.appProperties?.updatedAt ?? Date.parse(f.modifiedTime ?? '') ?? 0) || 0,
    };
  });

  // Also include legacy root files that haven't been migrated yet
  const legacyQ = "'" + rootId + "' in parents and name contains '__' and name contains '.json' and trashed = false";
  const legacyRes = await api('/files?q=' + encodeURIComponent(legacyQ) + '&fields=files(name,modifiedTime,appProperties)&pageSize=1000');
  const legacyFiles = ((await legacyRes.json()) as { files?: DriveFile[] }).files ?? [];
  
  for (const f of legacyFiles) {
    const key = f.name.replace(/\.json$/, '').replace(/__/g, '/');
    if (!items.find(it => it.key === key)) {
      items.push({
        key,
        updatedAt: Number(f.appProperties?.updatedAt ?? Date.parse(f.modifiedTime ?? '') ?? 0) || 0,
      });
    }
  }

  return items.filter((f) => f.key.startsWith(prefix));
}
