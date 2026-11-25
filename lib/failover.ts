import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { AGENTS, effectiveChain, type AgentId, type Effort } from './agents';
import { catalogHas, kickCatalogRefresh } from './catalog';
import { MODEL_BY_KEY, providerConfigured, type ModelDef } from './models';
import { redactSecrets } from './security';

export type ErrorKind = 'quota' | 'auth' | 'model' | 'overloaded' | 'network' | 'timeout' | 'other';

export interface ModelErrorInfo {
  kind: ErrorKind;
  message: string;
  retryAfterMs: number;
  /** quota only: a per-minute throttle clears fast, a daily quota does not. */
  window: 'minute' | 'day' | null;
}

export interface ModelNode {
  def: ModelDef;
  key: string;
  label: string;
  create: () => LanguageModel;
}

/* ------------------------------- node factory ------------------------------- */

function createNode(def: ModelDef): ModelNode | null {
  if (!providerConfigured(def.provider)) return null;
  const label = (def.provider === 'gemini' ? 'Gemini' : def.provider === 'groq' ? 'Groq' : 'OpenRouter') + ' / ' + def.label;
  let create: () => LanguageModel;
  if (def.provider === 'groq') {
    create = () => createGroq({ apiKey: process.env.GROQ_API_KEY as string })(def.id);
  } else if (def.provider === 'gemini') {
    create = () => createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY as string })(def.id);
  } else {
    const id = process.env.OPENROUTER_MODEL?.trim() || def.id;
    create = () => createOpenAICompatible({ name: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY as string, baseURL: 'https://openrouter.ai/api/v1' }).chatModel(id);
  }
  return { def, key: def.key, label, create };
}

/* ---------------------------------- ledger ---------------------------------- */

export interface RateInfo {
  remReq?: number;
  limReq?: number;
  remTok?: number;
  limTok?: number;
  at: number;
}

export interface LedgerEntry {
  key: string;
  until: number;
  kind: ErrorKind | null;
  window: 'minute' | 'day' | null;
  message: string;
  lastOkAt?: number;
  lastFailAt?: number;
  rate?: RateInfo;
}

const ledger = new Map<string, LedgerEntry>();

function entry(key: string): LedgerEntry {
  let e = ledger.get(key);
  if (!e) {
    e = { key, until: 0, kind: null, window: null, message: '' };
    ledger.set(key, e);
  }
  return e;
}

/** Gemini free-tier daily quotas reset at midnight Pacific time. */
function msUntilPacificMidnight(): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0) % 24;
  const secondsToday = get('hour') * 3600 + get('minute') * 60 + get('second');
  return Math.max(60_000, (86400 - secondsToday) * 1000 + 30_000);
}

function cooldownMs(def: ModelDef, info: ModelErrorInfo): number {
  switch (info.kind) {
    case 'quota':
      if (info.window === 'day' && info.retryAfterMs === 0) return def.provider === 'gemini' ? msUntilPacificMidnight() : 6 * 3600_000;
      return Math.min(info.retryAfterMs > 0 ? info.retryAfterMs + 1500 : 60_000, 24 * 3600_000);
    case 'auth':
    case 'model':
      return 30 * 60_000;
    case 'overloaded':
      return 45_000;
    case 'timeout':
      return 120_000;
    case 'network':
      return 20_000;
    default:
      return 0;
  }
}

export function markFailure(key: string, info: ModelErrorInfo): void {
  const def = MODEL_BY_KEY[key];
  const e = entry(key);
  e.lastFailAt = Date.now();
  e.message = info.message.slice(0, 300);
  e.kind = info.kind;
  e.window = info.window;
  const ms = def ? cooldownMs(def, info) : 0;
  if (ms > 0) e.until = Date.now() + ms;
}

export function markSuccess(key: string, headers?: Record<string, string> | Headers): void {
  const e = entry(key);
  e.lastOkAt = Date.now();
  e.until = 0;
  e.kind = null;
  e.window = null;
  if (headers) {
    const get = (n: string) => (headers instanceof Headers ? headers.get(n) : headers[n]);
    const num = (v: string | null | undefined) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const remReq = num(get('x-ratelimit-remaining-requests'));
    const remTok = num(get('x-ratelimit-remaining-tokens'));
    if (remReq !== undefined || remTok !== undefined) {
      e.rate = { remReq, limReq: num(get('x-ratelimit-limit-requests')), remTok, limTok: num(get('x-ratelimit-limit-tokens')), at: Date.now() };
    }
  }
}

export function cooldownRemaining(key: string): number {
  const e = ledger.get(key);
  if (!e || e.until <= Date.now()) return 0;
  return e.until - Date.now();
}

export function ledgerSnapshot(): LedgerEntry[] {
  return [...ledger.values()].map((e) => ({ ...e, until: e.until > Date.now() ? e.until : 0 }));
}

/** Cooldowns the browser remembered from earlier visits: lets a cold serverless instance skip exhausted models. */
export function absorbClientCooldowns(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MODEL_BY_KEY[key] || typeof value !== 'number') continue;
    if (value > Date.now() && value < Date.now() + 26 * 3600_000) {
      const e = entry(key);
      if (value > e.until) {
        e.until = value;
        e.kind = e.kind ?? 'quota';
        e.window = e.window ?? 'day';
      }
    }
  }
}

/* --------------------------- error classification --------------------------- */

function collectText(e: unknown, depth = 0): string[] {
  if (depth > 3 || e === null || e === undefined) return [];
  if (typeof e === 'string') return [e];
  if (typeof e !== 'object') return [String(e)];
  const o = e as { message?: unknown; responseBody?: unknown; cause?: unknown; lastError?: unknown; errors?: unknown };
  const out: string[] = [];
  if (typeof o.message === 'string') out.push(o.message);
  if (typeof o.responseBody === 'string') out.push(o.responseBody);
  out.push(...collectText(o.cause, depth + 1), ...collectText(o.lastError, depth + 1));
  if (Array.isArray(o.errors)) for (const x of o.errors) out.push(...collectText(x, depth + 1));
  return out;
}

function statusOf(e: unknown, depth = 0): number | null {
  if (depth > 3 || typeof e !== 'object' || e === null) return null;
  const o = e as { statusCode?: unknown; status?: unknown; cause?: unknown; lastError?: unknown; errors?: unknown };
  if (typeof o.statusCode === 'number') return o.statusCode;
  if (typeof o.status === 'number') return o.status;
  for (const n of [o.cause, o.lastError, ...(Array.isArray(o.errors) ? o.errors : [])]) {
    const s = statusOf(n, depth + 1);
    if (s !== null) return s;
  }
  return null;
}

function parseRetryAfterMs(text: string): number {
  const delay = text.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i);
  if (delay) return Math.round(Number(delay[1]) * 1000);
  const phrase = text.match(/(?:retry|try again)[^0-9]{0,24}in\s+((?:\d+(?:\.\d+)?\s*[hms]\s*)+)/i);
  if (!phrase) return 0;
  let ms = 0;
  for (const part of phrase[1].matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)) {
    const n = Number(part[1]);
    const unit = part[2].toLowerCase();
    ms += unit === 'h' ? n * 3600000 : unit === 'm' ? n * 60000 : n * 1000;
  }
  return Math.round(ms);
}

export function classifyModelError(e: unknown): ModelErrorInfo {
  const text = collectText(e).join(' | ');
  const status = statusOf(e);
  let kind: ErrorKind = 'other';
  if (e instanceof Error && e.name === 'AttemptTimeout') kind = 'timeout';
  else if (e instanceof Error && e.name === 'EmptyResponse') kind = 'overloaded';
  else if (status === 413 && /tokens per minute|request too large/i.test(text)) kind = 'quota';
  else if (status === 429 || /quota|rate.?limit|resource_exhausted|too many requests/i.test(text)) kind = 'quota';
  else if (status === 401 || status === 403 || /api key|unauthori[sz]ed|forbidden|permission denied|invalid.{0,20}credential/i.test(text)) kind = 'auth';
  else if (status === 404 || /not found|no longer available|decommission|does not exist/i.test(text)) kind = 'model';
  else if ((status !== null && status >= 500) || /overload|unavailable|capacity/i.test(text)) kind = 'overloaded';
  else if (/fetch failed|econn|enotfound|etimedout|timed out|network/i.test(text)) kind = 'network';
  const retryAfterMs = parseRetryAfterMs(text);
  let window: ModelErrorInfo['window'] = null;
  if (kind === 'quota') window = /per.?day|daily|PerDay/i.test(text) && !/per.?minute/i.test(text) ? 'day' : retryAfterMs > 10 * 60_000 ? 'day' : 'minute';
  return { kind, message: redactSecrets(text).slice(0, 600), retryAfterMs, window };
}

export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

export function describeShort(info: ModelErrorInfo): string {
  switch (info.kind) {
    case 'quota':
      return info.window === 'day' ? 'daily free quota used up' : 'rate limit hit' + (info.retryAfterMs > 0 ? ' (retry in ' + formatDuration(info.retryAfterMs) + ')' : '');
    case 'auth':
      return 'API key rejected';
    case 'model':
      return 'model not available';
    case 'overloaded':
      return 'provider overloaded';
    case 'timeout':
      return 'took too long to start';
    case 'network':
      return 'network error';
    default:
      return info.message.slice(0, 140) || 'unknown error';
  }
}

export class FailoverError extends Error {
  failures: string[];
  constructor(failures: string[]) {
    const hint = process.env.GROQ_API_KEY && process.env.GEMINI_API_KEY ? '' : ' Add both a free GROQ_API_KEY and GEMINI_API_KEY so there are two providers to fail over to.';
    super('No AI model could answer right now. ' + failures.join(' | ') + '.' + hint);
    this.name = 'FailoverError';
    this.failures = failures;
  }
}

/* ------------------------------- chain builder ------------------------------- */

export interface ChainRequest {
  agent: AgentId;
  vision?: boolean;
  docs?: boolean;
  tools?: boolean;
  /** Estimated input tokens (instructions + tools + history). */
  estTokens?: number;
  /** "Try another model": skip this many healthy models at the front. */
  rotation?: number;
  /** User-saved fallback order for this agent (model keys). */
  order?: string[];
}

export interface Chain {
  nodes: ModelNode[];
  skipped: { key: string; why: string }[];
}

export function getChain(req: ChainRequest): Chain {
  kickCatalogRefresh();
  void AGENTS[req.agent];
  const skipped: Chain['skipped'] = [];
  const keys = [...effectiveChain(req.agent, req.order)];
  const primaryGemini = process.env.AGENT_PRIMARY_GEMINI?.trim();
  const primaryGroq = process.env.AGENT_PRIMARY_GROQ?.trim();
  const override = req.agent === 'auto' ? primaryGroq && 'groq:' + primaryGroq : primaryGemini && 'gemini:' + primaryGemini;
  if (override && MODEL_BY_KEY[override]) keys.unshift(override);

  const nodes: ModelNode[] = [];
  for (const key of [...new Set(keys)]) {
    const def = MODEL_BY_KEY[key];
    if (!def) continue;
    if (!providerConfigured(def.provider)) {
      skipped.push({ key, why: 'no API key' });
      continue;
    }
    if (req.vision && !def.vision) {
      skipped.push({ key, why: 'no image input' });
      continue;
    }
    if (req.docs && !def.docs) {
      skipped.push({ key, why: 'no PDF/audio input' });
      continue;
    }
    if (req.tools && !def.tools) {
      skipped.push({ key, why: 'no tool calling' });
      continue;
    }
    if (!catalogHas(def.provider, def.id)) {
      skipped.push({ key, why: 'not in provider catalog' });
      continue;
    }
    if (def.inTpm && req.estTokens && req.estTokens + Math.min(def.maxOut, 1500) > def.inTpm) {
      skipped.push({ key, why: 'request too large for its free per-minute limit' });
      continue;
    }
    const node = createNode(def);
    if (node) nodes.push(node);
  }

  const healthy = nodes.filter((n) => cooldownRemaining(n.key) === 0);
  const cooled = nodes.filter((n) => cooldownRemaining(n.key) > 0);
  const r = Number.isFinite(req.rotation) && healthy.length > 1 ? Math.abs(Math.floor(req.rotation as number)) % healthy.length : 0;
  return { nodes: [...healthy.slice(r), ...healthy.slice(0, r), ...cooled], skipped };
}

/* ------------------------------ call-time options ------------------------------ */

function effortOptions(def: ModelDef, effort: Effort): Record<string, Record<string, unknown>> | null {
  switch (def.reasoning) {
    case 'gemini':
      return { google: { thinkingConfig: { thinkingLevel: effort === 'minimal' ? 'low' : effort } } };
    case 'gpt-oss':
      return { groq: { reasoningEffort: effort === 'minimal' ? 'low' : effort } };
    case 'qwen':
      return { groq: { reasoningEffort: effort === 'high' || effort === 'medium' ? 'default' : 'none' } };
    default:
      return null;
  }
}

type StreamPart = Record<string, unknown>;
type AnyModel = {
  doStream: (options: Record<string, unknown>) => Promise<{ stream: ReadableStream<StreamPart>; response?: { headers?: Record<string, string> } } & Record<string, unknown>>;
  doGenerate: (options: Record<string, unknown>) => Promise<Record<string, unknown> & { response?: { headers?: Record<string, string> } }>;
} & Record<string, unknown>;

/** Chunks that prove the model is alive. Everything before them is only protocol bookkeeping. */
function isSubstantive(part: StreamPart): boolean {
  const t = part.type;
  return t === 'text-delta' || t === 'reasoning-delta' || t === 'tool-input-start' || t === 'tool-call' || t === 'finish' || t === 'error' || t === 'file';
}

function timeoutError(ms: number): Error {
  const e = new Error('No output within ' + Math.round(ms / 1000) + 's');
  e.name = 'AttemptTimeout';
  return e;
}

async function openStream(model: AnyModel, options: Record<string, unknown>, ttftMs: number, outer: AbortSignal | undefined) {
  const ac = new AbortController();
  const onOuter = () => ac.abort(outer?.reason);
  outer?.addEventListener('abort', onOuter, { once: true });
  const timer = setTimeout(() => ac.abort(timeoutError(ttftMs)), ttftMs);
  try {
    const res = await model.doStream({ ...options, abortSignal: ac.signal });
    const reader = res.stream.getReader();
    const buffered: StreamPart[] = [];
    let finished = false;
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        break;
      }
      buffered.push(next.value);
      if (isSubstantive(next.value)) {
        if (next.value.type === 'error') throw (next.value as { error?: unknown }).error ?? new Error('Model stream error');
        break;
      }
    }
    // A reply that ends without any text or tool call is a silent failure: fail over instead of showing nothing.
    const sawContent = buffered.some((b) => b.type === 'text-delta' || b.type === 'reasoning-delta' || b.type === 'tool-input-start' || b.type === 'tool-call' || b.type === 'file');
    if (!sawContent) {
      const e = new Error('The model returned an empty reply');
      e.name = 'EmptyResponse';
      void reader.cancel().catch(() => undefined);
      throw e;
    }
    clearTimeout(timer);
    const stream = new ReadableStream<StreamPart>({
      start(controller) {
        for (const b of buffered) controller.enqueue(b);
        if (finished) controller.close();
      },
      async pull(controller) {
        if (finished) return;
        const n = await reader.read();
        if (n.done) controller.close();
        else controller.enqueue(n.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return { ...res, stream };
  } catch (e) {
    clearTimeout(timer);
    if (ac.signal.aborted && !outer?.aborted) {
      const reason = ac.signal.reason as unknown;
      if (reason instanceof Error && reason.name === 'AttemptTimeout') throw reason;
    }
    throw e;
  }
}

export interface FailoverOptions {
  effort: Effort;
  ttftMs: number;
  /** Called with the node that finally answered. */
  onModel?: (node: ModelNode) => void;
}

/**
 * One language model that transparently fails over to the next one when a call is rejected,
 * hits a quota, or produces nothing for too long. Reasoning effort is set per model here.
 */
export function createFailoverModel(nodes: ModelNode[], opts: FailoverOptions): LanguageModel {
  if (nodes.length === 0) throw new Error('No AI model is configured for this request.');
  const models = nodes.map((n) => n.create() as unknown as AnyModel);

  const buildOptions = (node: ModelNode, options: Record<string, unknown>): Record<string, unknown> => {
    const eff = effortOptions(node.def, opts.effort);
    const base = (options.providerOptions ?? {}) as Record<string, Record<string, unknown>>;
    const providerOptions = eff ? { ...base, ...Object.fromEntries(Object.entries(eff).map(([k, v]) => [k, { ...(base[k] ?? {}), ...v }])) } : base;
    const cap = options.maxOutputTokens as number | undefined;
    return { ...options, providerOptions, maxOutputTokens: Math.min(cap ?? node.def.maxOut, node.def.maxOut) };
  };

  /**
   * If a model fails AFTER it already started a plain-text answer (for example "provider overloaded"
   * halfway through 40 quiz questions), the next healthy model continues exactly where it stopped,
   * so the user sees one unbroken answer instead of an error card.
   */
  const guardStream = (first: { stream: ReadableStream<StreamPart> } & Record<string, unknown>, startIdx: number, options: Record<string, unknown>) => {
    const outer = options.abortSignal as AbortSignal | undefined;
    let text = '';
    let textId = 'text-0';
    let sawTool = false;
    let current = startIdx;
    let continued = false;
    let reader = first.stream.getReader();
    const stream = new ReadableStream<StreamPart>({
      async pull(controller) {
        for (;;) {
          let part: StreamPart;
          try {
            const r = await reader.read();
            if (r.done) {
              controller.close();
              return;
            }
            part = r.value;
          } catch (e) {
            part = { type: 'error', error: e };
          }
          const type = String(part.type);
          if (type === 'error' && text.length > 0 && !sawTool && !outer?.aborted) {
            markFailure(nodes[current].key, classifyModelError(part.error));
            let resumed = false;
            for (let j = current + 1; j < models.length && !resumed; j++) {
              if (cooldownRemaining(nodes[j].key) > 0) continue;
              try {
                const prompt = [
                  ...((options.prompt as unknown[]) ?? []),
                  { role: 'assistant', content: [{ type: 'text', text }] },
                  { role: 'user', content: [{ type: 'text', text: 'Continue your previous answer exactly where it stopped. Do not repeat or summarize anything you already wrote.' }] },
                ];
                const next = await openStream(models[j], { ...buildOptions(nodes[j], options), prompt }, opts.ttftMs, outer);
                reader = next.stream.getReader();
                current = j;
                continued = true;
                opts.onModel?.(nodes[j]);
                resumed = true;
              } catch (e2) {
                markFailure(nodes[j].key, classifyModelError(e2));
              }
            }
            if (resumed) continue;
          }
          if (continued && (type === 'stream-start' || type === 'response-metadata' || type === 'text-start')) continue;
          if (type === 'text-start') textId = String(part.id ?? textId);
          if (type === 'text-delta') text += String(part.delta ?? part.textDelta ?? '');
          if (type === 'tool-input-start' || type === 'tool-call') sawTool = true;
          if (continued && (type === 'text-delta' || type === 'text-end')) part = { ...part, id: textId };
          controller.enqueue(part);
          return;
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return { ...first, stream };
  };

  const run = async (method: 'doStream' | 'doGenerate', options: Record<string, unknown>): Promise<unknown> => {
    const failures: string[] = [];
    const outer = options.abortSignal as AbortSignal | undefined;
    for (let i = 0; i < models.length; i++) {
      const node = nodes[i];
      const eff = effortOptions(node.def, opts.effort);
      const merge = (useEffort: boolean): Record<string, unknown> => {
        const base = (options.providerOptions ?? {}) as Record<string, Record<string, unknown>>;
        const providerOptions =
          useEffort && eff ? { ...base, ...Object.fromEntries(Object.entries(eff).map(([k, v]) => [k, { ...(base[k] ?? {}), ...v }])) } : base;
        const cap = options.maxOutputTokens as number | undefined;
        return { ...options, providerOptions, maxOutputTokens: Math.min(cap ?? node.def.maxOut, node.def.maxOut) };
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const callOptions = merge(attempt === 0);
          let result: unknown;
          if (method === 'doStream') {
            result = guardStream(await openStream(models[i], callOptions, opts.ttftMs, outer), i, options);
          } else {
            const limit = AbortSignal.timeout(Math.max(opts.ttftMs, 60000));
            result = await models[i].doGenerate({ ...callOptions, abortSignal: outer ? AbortSignal.any([outer, limit]) : limit });
          }
          markSuccess(node.key, (result as { response?: { headers?: Record<string, string> } }).response?.headers);
          opts.onModel?.(node);
          return result;
        } catch (e) {
          if (outer?.aborted) throw e;
          const info = classifyModelError(e);
          // Some models reject a thinking option they do not support: retry once without it.
          if (attempt === 0 && eff && info.kind === 'other' && /thinking|reasoning/i.test(info.message)) continue;
          markFailure(node.key, info);
          failures.push(node.label + ': ' + describeShort(info));
          console.error('[failover]', node.label, info.kind, info.message.slice(0, 300));
          break;
        }
      }
    }
    throw new FailoverError(failures);
  };

  return new Proxy(models[0], {
    get(target, prop) {
      if (prop === 'doStream') return (options: Record<string, unknown>) => run('doStream', options);
      if (prop === 'doGenerate') return (options: Record<string, unknown>) => run('doGenerate', options);
      if (prop === 'modelId') return 'failover:' + nodes.map((n) => n.def.id).join(',');
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as LanguageModel;
}
