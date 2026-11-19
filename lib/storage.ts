/**
 * Drive-first, local-fallback storage for the browser.
 *
 * Every write first tries Google Drive through the authenticated /api/storage proxy
 * (Drive credentials never reach the browser). When Drive fails (not connected, auth
 * rejected, storage full, offline, timeout) the write is saved to IndexedDB instead,
 * marked "dirty", and replayed automatically once Drive is healthy again.
 */

export type StorageMode = 'drive' | 'local';
export type FailureReason = 'not-configured' | 'auth' | 'quota' | 'offline' | 'timeout' | 'app-auth' | 'error';

export interface StorageStatus {
  mode: StorageMode;
  reason: FailureReason | null;
  message: string;
  pending: number;
  lastSyncAt: number | null;
  checking: boolean;
}

export interface SaveResult {
  ok: boolean;
  mode: StorageMode;
  queued: boolean;
  key: string;
}

export interface LoadResult<T> {
  value: T | null;
  source: 'drive' | 'local' | 'none';
}

export interface StorageListItem {
  key: string;
  updatedAt: number;
}

interface StoredDoc {
  key: string;
  value: string;
  updatedAt: number;
  dirty: boolean;
  deleted: boolean;
}

interface LocalBackend {
  get(key: string): Promise<StoredDoc | undefined>;
  put(doc: StoredDoc): Promise<void>;
  remove(key: string): Promise<void>;
  all(): Promise<StoredDoc[]>;
}

type RemoteResult =
  | { ok: true; status: number; data: Record<string, unknown> }
  | { ok: false; status: number; reason: FailureReason; message: string };

const KEY_RE = /^[A-Za-z0-9._/-]{1,120}$/;
const REQUEST_TIMEOUT_MS = 9000;
const DB_NAME = 'hybrid-agent';
const STORE = 'docs';

const MESSAGES: Record<FailureReason, string> = {
  'not-configured': 'Google Drive is not connected yet. Running in Local Backup Mode.',
  auth: 'Google Drive rejected the credentials. Reconnect it in Connectors. Local Backup Mode is on.',
  quota: 'Google Drive is full or rate-limited. Saving locally until space is available.',
  offline: 'Google Drive is unreachable (offline?). Saving locally and will sync later.',
  timeout: 'Google Drive is responding slowly. Saving locally for now.',
  'app-auth': 'Your session expired. Sign in again. Saving locally for now.',
  error: 'Google Drive returned an error. Saving locally for now.',
};

const SKIP_MS: Record<FailureReason, number> = {
  'not-configured': 5 * 60 * 1000,
  auth: 60 * 1000,
  quota: 60 * 1000,
  offline: 15 * 1000,
  timeout: 15 * 1000,
  'app-auth': 30 * 1000,
  error: 30 * 1000,
};

/* ------------------------------ local backends ------------------------------ */

function memoryBackend(): LocalBackend {
  const map = new Map<string, StoredDoc>();
  return {
    get: async (key) => map.get(key),
    put: async (doc) => {
      map.set(doc.key, doc);
    },
    remove: async (key) => {
      map.delete(key);
    },
    all: async () => [...map.values()],
  };
}

function localStorageBackend(): LocalBackend {
  const prefix = 'hya:doc:';
  const read = (raw: string | null): StoredDoc | undefined => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as StoredDoc;
    } catch {
      return undefined;
    }
  };
  return {
    get: async (key) => read(window.localStorage.getItem(prefix + key)),
    put: async (doc) => {
      window.localStorage.setItem(prefix + doc.key, JSON.stringify(doc));
    },
    remove: async (key) => {
      window.localStorage.removeItem(prefix + key);
    },
    all: async () => {
      const out: StoredDoc[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          const doc = read(window.localStorage.getItem(k));
          if (doc) out.push(doc);
        }
      }
      return out;
    },
  };
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function indexedDbBackend(): Promise<LocalBackend> {
  const db = await openIdb();
  const store = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(STORE, mode).objectStore(STORE);
  return {
    get: async (key) => (await idbRequest(store('readonly').get(key))) as StoredDoc | undefined,
    put: async (doc) => {
      await idbRequest(store('readwrite').put(doc));
    },
    remove: async (key) => {
      await idbRequest(store('readwrite').delete(key));
    },
    all: async () => (await idbRequest(store('readonly').getAll())) as StoredDoc[],
  };
}

let backendPromise: Promise<LocalBackend> | null = null;

function backend(): Promise<LocalBackend> {
  if (backendPromise) return backendPromise;
  backendPromise = (async (): Promise<LocalBackend> => {
    if (typeof window === 'undefined') return memoryBackend();
    try {
      if (window.indexedDB) return await indexedDbBackend();
    } catch {
      /* fall through to localStorage */
    }
    try {
      window.localStorage.setItem('hya:probe', '1');
      window.localStorage.removeItem('hya:probe');
      return localStorageBackend();
    } catch {
      return memoryBackend();
    }
  })();
  return backendPromise;
}

/* --------------------------------- state ----------------------------------- */

let status: StorageStatus = {
  mode: 'local',
  reason: null,
  message: 'Checking Google Drive...',
  pending: 0,
  lastSyncAt: null,
  checking: true,
};
const listeners = new Set<() => void>();
let skipDriveUntil = 0;
let flushing = false;
let monitorStop: (() => void) | null = null;

function setStatus(patch: Partial<StorageStatus>): void {
  const next: StorageStatus = { ...status, ...patch };
  const same =
    next.mode === status.mode &&
    next.reason === status.reason &&
    next.message === status.message &&
    next.pending === status.pending &&
    next.lastSyncAt === status.lastSyncAt &&
    next.checking === status.checking;
  if (same) return;
  status = next;
  listeners.forEach((l) => l());
}

function markDrive(): void {
  skipDriveUntil = 0;
  setStatus({ mode: 'drive', reason: null, message: 'Cloud Sync: Google Drive', checking: false });
}

function markLocal(reason: FailureReason): void {
  skipDriveUntil = Date.now() + SKIP_MS[reason];
  setStatus({ mode: 'local', reason, message: MESSAGES[reason], checking: false });
}

async function refreshPending(): Promise<void> {
  try {
    const db = await backend();
    const docs = await db.all();
    setStatus({ pending: docs.filter((d) => d.dirty).length });
  } catch {
    /* ignore */
  }
}

/* --------------------------------- network --------------------------------- */

function reasonFromBody(code: unknown): FailureReason {
  switch (code) {
    case 'not-configured':
      return 'not-configured';
    case 'auth':
      return 'auth';
    case 'quota':
      return 'quota';
    case 'timeout':
      return 'timeout';
    case 'network':
      return 'offline';
    case 'app-auth':
      return 'app-auth';
    default:
      return 'error';
  }
}

async function remote(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<RemoteResult> {
  if (typeof window !== 'undefined' && window.navigator.onLine === false) {
    return { ok: false, status: 0, reason: 'offline', message: MESSAGES.offline };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    if (res.ok && data.ok !== false) return { ok: true, status: res.status, data };
    const reason = res.status === 401 ? 'app-auth' : reasonFromBody(data.code);
    return { ok: false, status: res.status, reason, message: typeof data.message === 'string' ? data.message : MESSAGES[reason] };
  } catch (e) {
    const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
    const reason: FailureReason = aborted ? 'timeout' : 'offline';
    return { ok: false, status: 0, reason, message: MESSAGES[reason] };
  } finally {
    clearTimeout(timer);
  }
}

function driveAllowed(): boolean {
  return Date.now() >= skipDriveUntil;
}

function parseDoc<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function validateKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//') || key.startsWith('/')) {
    throw new Error('Invalid storage key: ' + key);
  }
}

/* ---------------------------------- API ------------------------------------ */

async function save<T>(key: string, data: T): Promise<SaveResult> {
  validateKey(key);
  const value = JSON.stringify(data);
  const updatedAt = Date.now();
  const db = await backend();

  if (driveAllowed()) {
    const r = await remote('PUT', '/api/storage', { key, value, updatedAt });
    if (r.ok) {
      await db.put({ key, value, updatedAt, dirty: false, deleted: false });
      markDrive();
      await refreshPending();
      return { ok: true, mode: 'drive', queued: false, key };
    }
    markLocal(r.reason);
  }

  await db.put({ key, value, updatedAt, dirty: true, deleted: false });
  await refreshPending();
  return { ok: true, mode: 'local', queued: true, key };
}

async function load<T>(key: string): Promise<LoadResult<T>> {
  validateKey(key);
  const db = await backend();
  const local = await db.get(key);
  if (local && local.dirty) {
    return local.deleted ? { value: null, source: 'none' } : { value: parseDoc<T>(local.value), source: 'local' };
  }

  if (driveAllowed()) {
    const r = await remote('GET', '/api/storage?key=' + encodeURIComponent(key));
    if (r.ok) {
      const value = typeof r.data.value === 'string' ? r.data.value : null;
      const updatedAt = typeof r.data.updatedAt === 'number' ? r.data.updatedAt : Date.now();
      markDrive();
      if (value !== null) {
        await db.put({ key, value, updatedAt, dirty: false, deleted: false });
        return { value: parseDoc<T>(value), source: 'drive' };
      }
    } else if (r.status === 404 && r.reason === 'error') {
      markDrive();
    } else {
      markLocal(r.reason);
    }
  }

  if (local && !local.deleted) return { value: parseDoc<T>(local.value), source: 'local' };
  return { value: null, source: 'none' };
}

async function remove(key: string): Promise<SaveResult> {
  validateKey(key);
  const db = await backend();
  if (driveAllowed()) {
    const r = await remote('DELETE', '/api/storage?key=' + encodeURIComponent(key));
    if (r.ok || r.status === 404) {
      await db.remove(key);
      markDrive();
      await refreshPending();
      return { ok: true, mode: 'drive', queued: false, key };
    }
    markLocal(r.reason);
  }
  await db.put({ key, value: 'null', updatedAt: Date.now(), dirty: true, deleted: true });
  await refreshPending();
  return { ok: true, mode: 'local', queued: true, key };
}

async function list(prefix = ''): Promise<StorageListItem[]> {
  const db = await backend();
  const merged = new Map<string, number>();
  const locals = await db.all();
  for (const d of locals) {
    if (!d.deleted && d.key.startsWith(prefix)) merged.set(d.key, d.updatedAt);
  }
  const tombstones = new Set(locals.filter((d) => d.deleted).map((d) => d.key));
  if (driveAllowed()) {
    const r = await remote('GET', '/api/storage?prefix=' + encodeURIComponent(prefix));
    if (r.ok && Array.isArray(r.data.items)) {
      markDrive();
      for (const item of r.data.items as StorageListItem[]) {
        if (tombstones.has(item.key)) continue;
        merged.set(item.key, Math.max(merged.get(item.key) ?? 0, item.updatedAt));
      }
    } else if (!r.ok) {
      markLocal(r.reason);
    }
  }
  return [...merged.entries()].map(([key, updatedAt]) => ({ key, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Replays locally queued writes to Drive. Returns how many items are still pending. */
async function flush(): Promise<number> {
  if (flushing) return status.pending;
  flushing = true;
  try {
    const db = await backend();
    const queue = (await db.all()).filter((d) => d.dirty).sort((a, b) => a.updatedAt - b.updatedAt);
    let failed = false;
    for (const doc of queue) {
      const r = doc.deleted
        ? await remote('DELETE', '/api/storage?key=' + encodeURIComponent(doc.key))
        : await remote('PUT', '/api/storage', { key: doc.key, value: doc.value, updatedAt: doc.updatedAt });
      if (r.ok || (doc.deleted && r.status === 404)) {
        const current = await db.get(doc.key);
        if (current && current.updatedAt === doc.updatedAt) {
          if (doc.deleted) await db.remove(doc.key);
          else await db.put({ ...doc, dirty: false });
        }
      } else {
        markLocal(r.reason);
        failed = true;
        break;
      }
    }
    if (!failed) {
      markDrive();
      setStatus({ lastSyncAt: Date.now() });
    }
  } finally {
    flushing = false;
    await refreshPending();
  }
  return status.pending;
}

/** Pings Drive; when healthy, flushes any queued local writes. */
async function checkHealth(): Promise<StorageStatus> {
  setStatus({ checking: true });
  const r = await remote('GET', '/api/storage?health=1');
  if (r.ok) {
    markDrive();
    await refreshPending();
    if (status.pending > 0) await flush();
  } else {
    markLocal(r.reason);
    await refreshPending();
  }
  return status;
}

function startHealthMonitor(intervalMs = 30000): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (monitorStop) return monitorStop;
  void checkHealth();
  const timer = window.setInterval(() => void checkHealth(), intervalMs);
  const onOnline = (): void => void checkHealth();
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void checkHealth();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  monitorStop = () => {
    window.clearInterval(timer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    monitorStop = null;
  };
  return monitorStop;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getStatus(): StorageStatus {
  return status;
}

export const storage = { save, load, remove, list, flush, checkHealth, startHealthMonitor, subscribe, getStatus };
