'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp, useChatActions, useChatCtx } from '@/components/AppProviders';
import { PageScroll } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { AGENTS, AGENT_ORDER, type ToolGroup } from '@/lib/agents';
import { MODEL_BY_KEY, PROVIDER_LABEL, SPECIAL_MODELS } from '@/lib/models';
import { STATE_COLOR, STATE_LABEL, useModelHealth } from '@/lib/useHealth';

const TOOL_LABEL: Record<ToolGroup, string> = { repo: 'GitHub + Vercel', web: 'Web search', image: 'Image generation', study: 'Quizzes + flashcards', workspace: 'File workspace' };

export default function AgentsPage() {
  const router = useRouter();
  const { settings, setSetting } = useApp();
  const { agent } = useChatCtx();
  const actions = useChatActions();
  const { data } = useModelHealth();
  const [open, setOpen] = useState<string | null>('auto');

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
          return (
            <div key={id} className='card overflow-hidden' style={current ? { borderColor: a.hue } : undefined}>
              <button className='flex w-full items-center gap-3 p-3.5 text-left' onClick={() => setOpen(expanded ? null : id)}>
                <span className='grid h-11 w-11 flex-none place-items-center rounded-2xl text-white' style={{ background: a.hue }}><Icon name={a.icon} size={21} /></span>
                <span className='min-w-0 flex-1'>
                  <span className='flex items-center gap-2 text-[16px] font-semibold'>{a.name}{current && <span className='chip' style={{ color: a.hue }}>active</span>}</span>
                  <span className='block text-xs leading-snug text-[color:var(--muted)]'>{a.tagline}</span>
                </span>
                <span style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }}><Icon name='right' size={16} /></span>
              </button>
              {expanded && (
                <div className='fade-up px-3.5 pb-3.5'>
                  <div className='mb-3 flex flex-wrap gap-1.5'>
                    <span className='chip'>thinking: {a.effort}</span>
                    <span className='chip'>fails over after {Math.round(a.ttftMs / 1000)}s</span>
                    {a.tools.map((t) => <span key={t} className='chip'>{TOOL_LABEL[t]}</span>)}
                    {a.tools.length === 0 && <span className='chip'>answers directly</span>}
                  </div>
                  <div className='mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]'>Fallback order</div>
                  <ol>
                    {a.chain.map((k, i) => {
                      const m = MODEL_BY_KEY[k];
                      const s = data?.models[k];
                      return (
                        <li key={k} className='flex items-center gap-2.5 py-1.5 text-sm'>
                          <span className='w-5 text-right font-mono text-xs text-[color:var(--muted)]'>{i + 1}</span>
                          <span className='min-w-0 flex-1 truncate'>{m.label} <span className='text-xs text-[color:var(--muted)]'>{PROVIDER_LABEL[m.provider]}</span></span>
                          {s ? <span className='flex items-center gap-1.5 text-[11px]' style={{ color: STATE_COLOR[s.state] }}><span className='h-1.5 w-1.5 rounded-full' style={{ background: 'currentColor' }} />{STATE_LABEL[s.state]}</span> : <span className='skeleton h-3 w-14' />}
                        </li>
                      );
                    })}
                  </ol>
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
