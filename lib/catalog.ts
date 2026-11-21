import { PROVIDER_ENV, type Provider } from './models';

/**
 * Live model catalogs. Listing models is a metadata call: it spends no tokens and no
 * generation requests, so it is safe to run every time the Health page opens.
 */

export type CatalogStatus = 'ok' | 'no-key' | 'bad-key' | 'error';

export interface Catalog {
  provider: Provider;
  status: CatalogStatus;
  ids: Set<string> | null;
  detail: string;
  at: number;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<Provider, Catalog>();
const inflight = new Map<Provider, Promise<Catalog>>();

async function fetchCatalog(provider: Provider): Promise<Catalog> {
  const at = Date.now();
  const key = process.env[PROVIDER_ENV[provider]]?.trim();
  if (!key && provider !== 'openrouter') {
    return { provider, status: 'no-key', ids: null, detail: PROVIDER_ENV[provider] + ' is not set.', at };
  }
  try {
    let url = '';
    const headers: Record<string, string> = {};
    if (provider === 'groq') {
      url = 'https://api.groq.com/openai/v1/models';
      headers.Authorization = 'Bearer ' + key;
    } else if (provider === 'gemini') {
      url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
      headers['x-goog-api-key'] = key as string;
    } else {
      url = 'https://openrouter.ai/api/v1/models';
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(7000), cache: 'no-store' });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { provider, status: 'bad-key', ids: null, detail: 'The provider rejected the API key (HTTP ' + res.status + ').', at };
    }
    if (!res.ok) return { provider, status: 'error', ids: null, detail: 'Catalog request answered HTTP ' + res.status + '.', at };
    const data = (await res.json()) as {
      data?: { id: string }[];
      models?: { name: string; supportedGenerationMethods?: string[] }[];
    };
    const ids = new Set<string>();
    if (provider === 'gemini') {
      for (const m of data.models ?? []) {
        const methods = m.supportedGenerationMethods;
        if (!methods || methods.includes('generateContent')) ids.add(m.name.replace(/^models\//, ''));
      }
    } else {
      for (const m of data.data ?? []) ids.add(m.id);
    }
    return { provider, status: 'ok', ids, detail: ids.size + ' models listed.', at };
  } catch (e) {
    return { provider, status: 'error', ids: null, detail: 'Could not reach the provider: ' + (e instanceof Error ? e.message : 'network error').slice(0, 120), at };
  }
}

export function loadCatalog(provider: Provider, force = false): Promise<Catalog> {
  const cached = cache.get(provider);
  if (!force && cached && Date.now() - cached.at < TTL_MS && cached.status !== 'error') return Promise.resolve(cached);
  const running = inflight.get(provider);
  if (running) return running;
  const p = fetchCatalog(provider)
    .then((c) => {
      cache.set(provider, c);
      return c;
    })
    .finally(() => inflight.delete(provider));
  inflight.set(provider, p);
  return p;
}

/** True when the model is listed, or when the catalog is not known (never block on unknowns). */
export function catalogHas(provider: Provider, id: string): boolean {
  const c = cache.get(provider);
  if (!c || c.status !== 'ok' || !c.ids) return true;
  return c.ids.has(id);
}

export function cachedCatalog(provider: Provider): Catalog | undefined {
  return cache.get(provider);
}

/** Fire-and-forget refresh for chat requests: never delays an answer. */
export function kickCatalogRefresh(): void {
  for (const p of ['groq', 'gemini'] as Provider[]) {
    const c = cache.get(p);
    if (!c || Date.now() - c.at > TTL_MS) void loadCatalog(p).catch(() => undefined);
  }
}
