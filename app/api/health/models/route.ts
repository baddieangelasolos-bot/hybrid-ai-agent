import { generateText } from 'ai';
import { requireAuth } from '@/lib/auth';
import { loadCatalog, type Catalog } from '@/lib/catalog';
import { classifyModelError, cooldownRemaining, getChain, ledgerSnapshot, markFailure, markSuccess, type LedgerEntry } from '@/lib/failover';
import { errMsg, json } from '@/lib/http';
import { imageProviders } from '@/lib/image';
import { MODELS, MODEL_BY_KEY, PROVIDER_ENV, PROVIDER_LABEL, SPECIAL_MODELS, providerConfigured, type Provider } from '@/lib/models';
import { redactSecrets } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 30;

export type ModelState = 'ready' | 'exhausted' | 'busy' | 'missing' | 'no-key' | 'bad-key' | 'unknown';

interface ModelStatus {
  state: ModelState;
  detail: string;
  /** Epoch ms when a cooldown ends. */
  until: number;
  rate?: LedgerEntry['rate'];
  lastOkAt?: number;
}

function stateFor(provider: Provider, id: string, key: string, catalog: Catalog | undefined, ledger: Map<string, LedgerEntry>): ModelStatus {
  const e = ledger.get(key);
  const base = { until: 0, rate: e?.rate, lastOkAt: e?.lastOkAt };
  if (!providerConfigured(provider)) return { ...base, state: 'no-key', detail: PROVIDER_ENV[provider] + ' is not set in Vercel.' };
  if (catalog?.status === 'bad-key') return { ...base, state: 'bad-key', detail: 'The provider rejected your API key.' };
  if (catalog?.status === 'ok' && catalog.ids && !catalog.ids.has(id)) return { ...base, state: 'missing', detail: 'Not in ' + PROVIDER_LABEL[provider] + "'s current model list for your key (retired, renamed or not enabled)." };
  const remaining = cooldownRemaining(key);
  if (remaining > 0 && e) {
    const until = Date.now() + remaining;
    if (e.kind === 'quota') return { ...base, until, state: e.window === 'day' ? 'exhausted' : 'busy', detail: e.window === 'day' ? 'Daily free quota used up.' : 'Per-minute limit hit, clears shortly.' };
    if (e.kind === 'auth') return { ...base, until, state: 'bad-key', detail: 'Provider refused this model for your key.' };
    if (e.kind === 'model') return { ...base, until, state: 'missing', detail: 'Provider said this model does not exist.' };
    return { ...base, until, state: 'busy', detail: e.kind === 'timeout' ? 'Was too slow to start; skipped for a few minutes.' : 'Provider had a temporary problem.' };
  }
  if (!catalog || catalog.status === 'error') return { ...base, state: e?.lastOkAt ? 'ready' : 'unknown', detail: e?.lastOkAt ? 'Worked recently.' : 'Could not read the provider catalog; will be tried when needed.' };
  return { ...base, state: 'ready', detail: e?.lastOkAt ? 'Answered successfully recently.' : 'Listed by the provider. No quota problems seen.' };
}

/**
 * GET = free refresh. It only reads provider model catalogs (metadata, no tokens, no generation
 * requests) plus what this server already learned from real chats. It never spends quota.
 * GET ?mode=ledger returns only the learned cooldowns (no provider calls at all).
 * POST {probe} = optional single 1-request test of one model.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;
  const ledgerList = ledgerSnapshot();
  const url = new URL(req.url);
  if (url.searchParams.get('mode') === 'ledger') {
    return json({ ok: true, ledger: ledgerList.map((e) => ({ key: e.key, until: e.until })) });
  }

  const providers: Provider[] = ['gemini', 'groq', 'openrouter'];
  const catalogs = new Map<Provider, Catalog>();
  await Promise.all(providers.map(async (p) => catalogs.set(p, await loadCatalog(p, true))));
  const ledger = new Map(ledgerList.map((e) => [e.key, e]));

  const models: Record<string, ModelStatus> = {};
  for (const m of MODELS) models[m.key] = stateFor(m.provider, m.id, m.key, catalogs.get(m.provider), ledger);

  const special: Record<string, ModelStatus> = {};
  for (const s of SPECIAL_MODELS) special[s.id] = stateFor(s.provider, s.id, s.provider + ':' + s.id, catalogs.get(s.provider), ledger);

  return json({
    ok: true,
    at: Date.now(),
    providers: providers.map((p) => {
      const c = catalogs.get(p);
      return { id: p, label: PROVIDER_LABEL[p], env: PROVIDER_ENV[p], configured: providerConfigured(p), status: c?.status ?? 'error', detail: c?.detail ?? '', count: c?.ids?.size ?? 0 };
    }),
    models,
    special,
    image: imageProviders(),
    ledger: ledgerList.map((e) => ({ key: e.key, until: e.until })),
  });
}

export async function POST(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;
  let key = '';
  try {
    key = String(((await req.json()) as { probe?: unknown }).probe ?? '');
  } catch {
    return json({ ok: false, message: 'Invalid JSON body.' }, 400);
  }
  const def = MODEL_BY_KEY[key];
  if (!def) return json({ ok: false, message: 'Unknown model.' }, 400);
  const node = getChain({ agent: 'auto' }).nodes.find((n) => n.key === key) ?? null;
  const target = node ?? (() => {
    const { nodes } = getChain({ agent: 'coder' });
    return nodes.find((n) => n.key === key) ?? null;
  })();
  if (!target) return json({ ok: false, message: 'This model cannot be tested right now (no key, or it is not listed by the provider).' }, 400);
  const started = Date.now();
  try {
    await generateText({ model: target.create(), prompt: 'Reply with the single word: ok', maxOutputTokens: 24, maxRetries: 0, timeout: { totalMs: 25000 } });
    markSuccess(key);
    return json({ ok: true, key, ms: Date.now() - started, message: 'Answered in ' + (Date.now() - started) + ' ms. This used 1 request of its free quota.' });
  } catch (e) {
    const info = classifyModelError(e);
    markFailure(key, info);
    return json({ ok: false, key, kind: info.kind, message: redactSecrets(errMsg(e)).slice(0, 240) });
  }
}
