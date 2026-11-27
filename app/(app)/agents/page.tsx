'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp, useChatActions, useChatCtx } from '@/components/AppProviders';
import { PageScroll } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { AGENTS, AGENT_ORDER, effectiveChain, type AgentId, type ToolGroup, type Effort } from '@/lib/agents';
import { MODEL_BY_KEY, PROVIDER_LABEL, SPECIAL_MODELS } from '@/lib/models';
import { STATE_COLOR, STATE_LABEL, useModelHealth } from '@/lib/useHealth';

const TOOL_LABEL: Record<ToolGroup, string> = { repo: 'GitHub + Vercel', web: 'Web search', image: 'Image generation', study: 'Quizzes + flashcards', workspace: 'File workspace' };
const EFFORTS: Effort[] = ['minimal', 'low', 'medium', 'high'];

export default function AgentsPage() {
  const router = useRouter();
  const { settings, setSetting } = useApp();
  const { agent } = useChatCtx();
  const actions = useChatActions();
  const { data } = useModelHealth();
  const [open, setOpen] = useState<string | null>('auto');

  const saveChain = (id: AgentId, order: string[]) => setSetting('chains', { ...settings.chains, [id]: order });
  const move = (id: AgentId, order: string[], i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    saveChain(id, next);
  };
  const first = (id: AgentId, order: string[], i: number) => saveChain(id, [order[i], ...order.filter((_, x) => x !== i)]);
  
  const resetChain = (id: AgentId) => {
    const rest = { ...settings.chains };
    delete rest[id];
    setSetting('chains', rest);
  };

  const setEffort = (id: AgentId, e: Effort) => {
    setSetting('efforts', { ...settings.efforts, [id]: e });
  };

  const resetEffort = (id: AgentId) => {
    const rest = { ...settings.efforts };
    delete rest[id];
    setSetting('efforts', rest);
  };

  return (
    <PageScroll title='Agents' subtitle='Each agent has its own model fallback chain'>
      <p className='mb-4 px-1 text-[13px] leading-snug text-[color:var(--muted)]'>
        Specialists try <b className='text-[color:var(--ink)]'>Google Gemini 4 Hydrogen</b> first, then the next best model, down the list. The Lead Orchestrator runs on <b className='text-[color:var(--ink)]'>Groq</b> for instant replies. If a model is out of quota, too slow, or retired, the next one answers automatically.
      </p>
      <div className='flex flex-col gap-3'>
        {AGENT_ORDER.map((id) => {
          const a = AGENTS[id];
          const expanded = open === id;
          const current = agent === id;
          const customChain = Boolean(settings.chains[id]?.length);
          const customEffort = Boolean(settings.efforts[id]);
          const order = effectiveChain(id, settings.chains[id]);
          const effort = settings.efforts[id] || a.effort;

          return (
            <div key={id} className='card overflow-hidden' style={current ? { borderColor: a.hue } : undefined}>
              <button className='flex w-full items-center gap-3 p-3.5 text-left' onClick={() => setOpen(expanded ? null : id)}>
                <span className='grid h-11 w-11 flex-none place-items-center rounded-2xl text-white' style={{ background: a.hue }}><Icon name={a.icon} size={21} /></span>
                <span className='min-w-0 flex-1'>
                  <span className='flex items-center gap-2 text-[16px] font-semibold'>{a.name}{current && <span className='chip' style={{ color: a.hue }}>active</span>}{(customChain || customEffort) && <span className='chip'>customized</span>}</span>
                  <span className='block text-xs leading-snug text-[color:var(--muted)]'>{a.tagline}</span>
                </span>
                <span style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }}><Icon name='right' size={16} /></span>
              </button>
              {expanded && (
                <div className='fade-up px-3.5 pb-3.5'>
                  <div className='mb-3 flex flex-wrap gap-1.5'>
                    <div className='flex items-center gap-1.5 rounded-lg border border-[color:var(--line)] bg-[color:var(--sheet)] py-0.5 pl-2.5 pr-1'>
                      <span className='text-[10px] font-medium uppercase tracking-wider text-[color:var(--muted)]'>Thinking</span>
                      <select 
                        className='bg-transparent py-1 text-xs font-semibold outline-none' 
                        value={effort} 
                        onChange={(e) => setEffort(id, e.target.value as Effort)}
                      >
                        {EFFORTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                      </select>
                      {customEffort && <button className='ml-1 text-[color:var(--accent)]' onClick={() => resetEffort(id)} aria-label='Reset effort'><Icon name='cross' size={12} /></button>}
                    </div>
                    <span className='chip'>fails over after {Math.round(a.ttftMs / 1000)}s</span>
                    {a.tools.map((t) => <span key={t} className='chip'>{TOOL_LABEL[t]}</span>)}
                    {a.tools.length === 0 && <span className='chip'>answers directly</span>}
                  </div>
                  <div className='mb-1 flex items-center justify-between'>
                    <span className='text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]'>Fallback order</span>
                    {customChain && <button className='text-xs underline underline-offset-2' style={{ color: 'var(--accent)' }} onClick={() => resetChain(id)}>Reset order</button>}
                  </div>
                  <ol>
                    {order.map((k, i) => {
                      const m = MODEL_BY_KEY[k];
                      if (!m) return null;
                      const st = data?.models[k];
                      return (
                        <li key={k} className='flex items-center gap-1.5 py-1 text-sm'>
                          <span className='w-5 flex-none text-right font-mono text-xs text-[color:var(--muted)]'>{i + 1}</span>
                          <span className='min-w-0 flex-1'>
                            <span className='block truncate'>{m.label} <span className='text-xs text-[color:var(--muted)]'>{PROVIDER_LABEL[m.provider]}</span></span>
                            {st ? <span className='flex items-center gap-1.5 text-[11px]' style={{ color: STATE_COLOR[st.state] }}><span className='h-1.5 w-1.5 rounded-full' style={{ background: 'currentColor' }} />{STATE_LABEL[st.state]}</span> : <span className='skeleton mt-0.5 block h-3 w-14' />}
                          </span>
                          {i > 0 && <button className='ghost-btn flex-none rounded-lg px-2 py-1 text-[11px] font-medium' aria-label={'Make ' + m.label + ' first'} onClick={() => first(id, order, i)}>Make #1</button>}
                          <button className='icon-btn !h-8 !w-8 flex-none' aria-label={'Move ' + m.label + ' up'} disabled={i === 0} style={i === 0 ? { opacity: 0.3 } : undefined} onClick={() => move(id, order, i, -1)}><Icon name='up' size={16} /></button>
                          <button className='icon-btn !h-8 !w-8 flex-none' aria-label={'Move ' + m.label + ' down'} disabled={i === order.length - 1} style={i === order.length - 1 ? { opacity: 0.3 } : undefined} onClick={() => move(id, order, i, 1)}><Icon name='down' size={16} /></button>
                        </li>
                      );
                    })}
                  </ol>
                  <p className='mt-2 text-[11px] leading-snug text-[color:var(--muted)]'>Your order and thinking levels are saved. Models without a key, without the needed skill, or out of quota are skipped automatically.</p>
                  <div className='mt-3 flex gap-2'>
                    <button className='neon-btn flex-1 rounded-xl py-2.5 text-sm' onClick={() => { actions.setAgent(id); router.push('/'); }}>Use in chat</button>
                    <button className='ghost-btn rounded-xl px-3.5 py-2.5 text-sm' disabled={settings.agent === id} onClick={() => setSetting('agent', id)}>{settings.agent === id ? 'Default' : 'Make default'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <h2 className='mb-2 mt-7 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>Behind the scenes</h2>
      <div className='card divide-y divide-[color:var(--line)]'>
        {SPECIAL_MODELS.slice(0, 5).map((m) => (
          <div key={m.id} className='p-3.5'>
            <div className='text-sm font-medium'>{m.label}</div>
            <div className='text-xs text-[color:var(--muted)]'>{m.role}. {m.note}.</div>
          </div>
        ))}
      </div>
    </PageScroll>
  );
}
