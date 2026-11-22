'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProviders';
import { PageScroll } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { apiRequest } from '@/lib/api';
import { AGENTS, AGENT_ORDER } from '@/lib/agents';
import { MODELS, MODEL_BY_KEY, PROVIDER_LABEL, SPECIAL_MODELS, type Provider } from '@/lib/models';
import { STATE_COLOR, STATE_LABEL, ago, formatReset, useModelHealth, type ModelStatus } from '@/lib/useHealth';

function StateChip({ s }: { s: ModelStatus }) {
  return (
    <span className='chip' style={{ color: STATE_COLOR[s.state], borderColor: 'color-mix(in srgb, ' + STATE_COLOR[s.state] + ' 40%, transparent)', background: 'color-mix(in srgb, ' + STATE_COLOR[s.state] + ' 10%, transparent)' }}>
      <span className='h-1.5 w-1.5 rounded-full' style={{ background: 'currentColor' }} />
      {STATE_LABEL[s.state]}
      {s.until > Date.now() && (s.state === 'exhausted' || s.state === 'busy') ? ' · back in ' + formatReset(s.until) : ''}
    </span>
  );
}

const PROVIDERS: Provider[] = ['gemini', 'groq', 'openrouter'];

export default function HealthPage() {
  const { notify } = useApp();
  const { data, services, loading, error, refresh } = useModelHealth();
  const [, tick] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 15000);
    return () => window.clearInterval(t);
  }, []);

  async function test(key: string) {
    const m = MODEL_BY_KEY[key];
    if (!window.confirm('Send one tiny test request to ' + m.label + '? It uses 1 request of its free quota.')) return;
    setTesting(key);
    const r = await apiRequest<{ message?: string }>('/api/health/models', { method: 'POST', body: { probe: key } });
    setTesting(null);
    notify(r.ok ? m.label + ': ' + (r.data?.message ?? 'ok') : m.label + ': ' + r.message);
    void refresh(false);
  }

  const states = data ? Object.values(data.models) : [];
  const ready = states.filter((s) => s.state === 'ready').length;
  const out = states.filter((s) => s.state === 'exhausted' || s.state === 'busy').length;
  const attention = states.filter((s) => ['missing', 'bad-key', 'unknown'].includes(s.state)).length;

  return (
    <PageScroll
      title='Model health'
      subtitle={data ? 'Updated ' + ago(data.at) + ' · refreshes automatically' : 'Checking...'}
      actions={
        <button className='icon-btn' aria-label='Refresh' onClick={() => void refresh()}>
          <span className={loading ? 'animate-spin' : ''}><Icon name='refresh' size={20} /></span>
        </button>
      }
    >
      <details className='card mb-4 p-3.5 text-[13px] leading-snug text-[color:var(--muted)]'>
        <summary className='flex cursor-pointer list-none items-center gap-3'>
          <span style={{ color: 'var(--good)' }}><Icon name='shield' size={17} /></span>
          <span><b className='text-[color:var(--ink)]'>Free check.</b> Uses no prompts and no tokens. Tap for details.</span>
        </summary>
        <p className='mt-3'>
          This page reads only the providers&apos; free model lists plus what the app learned from your real chats, so it can never use up your quota. Providers do not publish a live &ldquo;remaining quota&rdquo; number: a model shows <i>Out of quota</i> after it really refused a request (with the exact time it comes back), and Groq also reports its own remaining count after each answer. Use <b>Test</b> on a model only if you want to spend one request to confirm it.
        </p>
      </details>

      {error && <div className='card mb-4 p-3.5 text-sm' style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>{error}</div>}

      {!data ? (
        <div className='flex flex-col gap-3'>{[0, 1, 2].map((i) => <div key={i} className='skeleton h-24' />)}</div>
      ) : (
        <>
          <div className='mb-5 grid grid-cols-3 gap-2.5'>
            {[
              { n: ready, label: 'Ready', c: 'var(--good)' },
              { n: out, label: 'Out of quota', c: 'var(--bad)' },
              { n: attention, label: 'Need attention', c: 'var(--warn)' },
            ].map((t) => (
              <div key={t.label} className='card p-3.5'>
                <div className='text-3xl font-semibold tabular-nums' style={{ color: t.c }}>{t.n}</div>
                <div className='mt-0.5 text-xs text-[color:var(--muted)]'>{t.label}</div>
              </div>
            ))}
          </div>

          <h2 className='mb-2 mt-6 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>Providers</h2>
          <div className='card divide-y divide-[color:var(--line)]'>
            {data.providers.map((p) => (
              <div key={p.id} className='flex items-center gap-3 p-3.5'>
                <span className='h-2.5 w-2.5 flex-none rounded-full' style={{ background: !p.configured ? (p.id === 'openrouter' ? 'var(--muted)' : 'var(--bad)') : p.status === 'ok' ? 'var(--good)' : p.status === 'error' ? 'var(--warn)' : 'var(--bad)' }} />
                <div className='min-w-0 flex-1'>
                  <div className='text-[15px] font-medium'>{p.label}</div>
                  <div className='truncate text-xs text-[color:var(--muted)]'>{!p.configured ? (p.id === 'openrouter' ? 'Optional third provider. Not configured.' : p.env + ' is not set in Vercel.') : p.status === 'ok' ? p.count + ' models listed · key works' : p.detail}</div>
                </div>
                {(!p.configured || p.status !== 'ok') && <span className='chip font-mono'>{p.env}</span>}
              </div>
            ))}
          </div>

          <h2 className='mb-2 mt-6 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>Agents: who answers right now</h2>
          <div className='card divide-y divide-[color:var(--line)]'>
            {AGENT_ORDER.map((id) => {
              const a = AGENTS[id];
              const first = a.chain.find((k) => ['ready', 'unknown'].includes(data.models[k]?.state ?? 'missing'));
              const expanded = open === id;
              return (
                <div key={id}>
                  <button className='flex w-full items-center gap-3 p-3.5 text-left' onClick={() => setOpen(expanded ? null : id)}>
                    <span className='grid h-9 w-9 flex-none place-items-center rounded-xl text-white' style={{ background: a.hue }}><Icon name={a.icon} size={17} /></span>
                    <span className='min-w-0 flex-1'>
                      <span className='block text-[15px] font-medium'>{a.name}</span>
                      <span className='block truncate text-xs' style={{ color: first ? 'var(--muted)' : 'var(--bad)' }}>{first ? 'Now: ' + MODEL_BY_KEY[first].label + (first === a.chain[0] ? ' (primary)' : ' (fallback)') : 'No model available'}</span>
                    </span>
                    <span style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }}><Icon name='right' size={16} /></span>
                  </button>
                  {expanded && (
                    <ol className='fade-up px-3.5 pb-3.5'>
                      {a.chain.map((k, i) => {
                        const m = MODEL_BY_KEY[k];
                        const s = data.models[k];
                        return (
                          <li key={k} className='flex items-center gap-2.5 py-1.5 text-sm'>
                            <span className='w-5 text-right font-mono text-xs text-[color:var(--muted)]'>{i + 1}</span>
                            <span className='min-w-0 flex-1 truncate'>{m.label} <span className='text-xs text-[color:var(--muted)]'>{PROVIDER_LABEL[m.provider]}</span></span>
                            {s && <StateChip s={s} />}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>

          {PROVIDERS.map((p) => (
            <section key={p}>
              <h2 className='mb-2 mt-6 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>{PROVIDER_LABEL[p]} models</h2>
              <div className='card divide-y divide-[color:var(--line)]'>
                {MODELS.filter((m) => m.provider === p).map((m) => {
                  const s = data.models[m.key];
                  if (!s) return null;
                  return (
                    <div key={m.key} className='p-3.5'>
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <div className='text-[15px] font-medium'>{m.label}</div>
                          <div className='truncate font-mono text-[11px] text-[color:var(--muted)]'>{m.id}</div>
                        </div>
                        <StateChip s={s} />
                      </div>
                      <div className='mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[color:var(--muted)]'>
                        <span className='chip'>{m.tier}</span>
                        {m.vision && <span className='chip'>images</span>}
                        {m.docs && <span className='chip'>PDF / audio</span>}
                        {m.tools && <span className='chip'>tools</span>}
                        <span className='chip'>{m.ctx >= 1_000_000 ? '1M' : Math.round(m.ctx / 1000) + 'K'} context</span>
                      </div>
                      <p className='mt-2 text-xs text-[color:var(--muted)]'>{s.detail}</p>
                      {s.rate?.remReq !== undefined && (
                        <p className='mt-1 text-xs' style={{ color: 'var(--good)' }}>
                          {s.rate.remReq.toLocaleString()}{s.rate.limReq ? ' / ' + s.rate.limReq.toLocaleString() : ''} requests left today · seen {ago(s.rate.at)}
                        </p>
                      )}
                      <div className='mt-2 flex items-center justify-between'>
                        <span className='text-[11px] text-[color:var(--muted)]'>{m.free}</span>
                        {(s.state === 'ready' || s.state === 'unknown' || s.state === 'busy') && (
                          <button className='ghost-btn rounded-lg px-2.5 py-1 text-xs' disabled={testing !== null} onClick={() => void test(m.key)}>
                            {testing === m.key ? 'Testing...' : 'Test (1 request)'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <h2 className='mb-2 mt-6 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>Helper models (speech, safety)</h2>
          <div className='card divide-y divide-[color:var(--line)]'>
            {SPECIAL_MODELS.map((m) => {
              const s = data.special[m.id];
              return (
                <div key={m.id} className='flex items-center gap-3 p-3.5'>
                  <div className='min-w-0 flex-1'>
                    <div className='text-sm font-medium'>{m.label}</div>
                    <div className='truncate text-xs text-[color:var(--muted)]'>{m.role}</div>
                  </div>
                  {s && <StateChip s={s} />}
                </div>
              );
            })}
          </div>

          <h2 className='mb-2 mt-6 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>Image generators (tried in this order)</h2>
          <div className='card divide-y divide-[color:var(--line)]'>
            {data.image.map((g, i) => (
              <div key={g.id} className='flex items-center gap-3 p-3.5'>
                <span className='w-5 text-right font-mono text-xs text-[color:var(--muted)]'>{i + 1}</span>
                <div className='min-w-0 flex-1'>
                  <div className='text-sm font-medium'>{g.label} · {g.model}</div>
                  <div className='truncate text-xs text-[color:var(--muted)]'>{g.configured ? g.note : 'Needs ' + g.env.join(' + ')}</div>
                </div>
                <span className='chip' style={{ color: g.configured ? 'var(--good)' : 'var(--muted)' }}>{g.configured ? 'Configured' : 'Not set'}</span>
              </div>
            ))}
          </div>

          {services && (
            <>
              <h2 className='mb-2 mt-6 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>Connected services</h2>
              <div className='card divide-y divide-[color:var(--line)]'>
                {services.map((c) => (
                  <div key={c.id} className='flex items-start gap-3 p-3.5'>
                    <span className='mt-1.5 h-2.5 w-2.5 flex-none rounded-full' style={{ background: c.status === 'ok' ? 'var(--good)' : c.status === 'warn' ? 'var(--warn)' : c.status === 'fail' ? 'var(--bad)' : 'var(--muted)' }} />
                    <div className='min-w-0'>
                      <div className='text-sm font-medium'>{c.name}</div>
                      <div className='text-xs text-[color:var(--muted)]'>{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </PageScroll>
  );
}
