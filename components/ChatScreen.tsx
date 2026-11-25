'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AGENTS, type AgentId } from '@/lib/agents';
import { titleFrom } from '@/lib/threads';
import { useApp, useChatActions, useChatMessages, useChatMeta } from './AppProviders';
import { NavButton } from './AppShell';
import Composer from './Composer';
import { Icon } from './Icons';
import Logo from './Logo';
import MessageView from './MessageView';

const STARTERS: { agent: AgentId; prompt: string; title: string }[] = [
  { agent: 'auto', title: 'Explain simply', prompt: 'Explain how large language models work, in simple words.' },
  { agent: 'coder', title: 'Build something', prompt: 'Build a responsive pricing page with HTML and CSS.' },
  { agent: 'researcher', title: 'Latest news', prompt: 'What are the latest developments in AI this week?' },
  { agent: 'study', title: 'Quiz me', prompt: 'Make a 10-question HSC MCQ exam on Newtonian mechanics (Physics 1st paper). Tag each question with its topic.' },
  { agent: 'study', title: 'Board questions', prompt: '/board Give me one creative question (uddipak with ka, kha, ga, gha) on HSC Chemistry: Qualitative chemistry, then a model answer.' },
  { agent: 'image', title: 'Make an image', prompt: 'Generate a neon-lit rainy city street at night, cinematic.' },
  { agent: 'reasoner', title: 'Solve a problem', prompt: 'Solve step by step: a train leaves at 3pm going 80 km/h, another at 4pm going 100 km/h. When does the second catch up?' },
  { agent: 'selfmod', title: 'Improve this app', prompt: 'List the files of this app and suggest one small, safe improvement. Do not push anything yet.' },
];

function niceError(e: Error): string {
  try {
    const j = JSON.parse(e.message) as { message?: string };
    if (j.message) return j.message;
  } catch {
    /* not JSON */
  }
  return e.message || 'Something went wrong.';
}

export default function ChatScreen() {
  const { settings } = useApp();
  const messages = useChatMessages();
  const { busy, status, error, route, incognito, agent, threadId, threads, interrupted } = useChatMeta();
  const actions = useChatActions();
  const scRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = scRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    stick.current = near;
    setAtBottom(near);
  }, []);

  const raf = useRef(0);
  useLayoutEffect(() => {
    const el = scRef.current;
    if (!el) return;
    if (messages.length === 0) {
      el.scrollTop = 0;
      return;
    }
    if (!stick.current) return;
    // Streaming updates many times a second: write the scroll position once per frame, not once per update.
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, status, error]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const count = useRef(0);
  count.current = messages.length;
  useEffect(() => {
    stick.current = true;
    const el = scRef.current;
    // Only jump to the bottom for a chat that has messages; an empty chat shows its hero from the top.
    if (el) requestAnimationFrame(() => (el.scrollTop = count.current > 0 ? el.scrollHeight : 0));
  }, [threadId]);

  const last = messages[messages.length - 1];
  const waiting = busy && (!last || last.role === 'user' || last.parts.length === 0);
  const a = AGENTS[agent];
  const saved = threads.find((t) => t.id === threadId);
  const title = incognito ? 'Incognito chat' : saved?.title ?? (messages.length > 0 ? titleFrom(messages) : 'New chat');
  const status2 = busy && route ? route.name + (route.reason ? ' · ' + route.reason : '') : agent === 'auto' ? 'Auto · Lead Orchestrator' : a.name;

  return (
    <div className='flex h-full flex-col'>
      <header className='safe-top flex-none px-3 pb-2 pt-3' style={{ background: 'linear-gradient(var(--bg) 60%, transparent)' }}>
        <div className='mx-auto flex w-full max-w-3xl items-center gap-1.5'>
          <NavButton />
          <div className='min-w-0 flex-1 px-1'>
            <div className='truncate text-[17px] font-semibold leading-tight' title={title}>{title}</div>
            <div className='truncate text-xs text-[color:var(--muted)]'>Hybrid AI · {status2}</div>
          </div>
          <button className={'icon-btn ' + (incognito ? '!bg-[color:var(--hover)] !text-[color:var(--ink)]' : '')} aria-label={incognito ? 'Leave incognito' : 'Start incognito chat'} onClick={() => actions.newChat({ incognito: !incognito })}>
            <Icon name='ghost' size={20} />
          </button>
          <button className='icon-btn' aria-label='New chat' onClick={() => actions.newChat()}>
            <Icon name='edit' size={20} />
          </button>
        </div>
      </header>

      {incognito && (
        <div className='mx-auto w-full max-w-3xl px-3'>
          <div className='mb-2 flex items-center gap-2 rounded-2xl px-3 py-2 text-xs' style={{ background: 'color-mix(in srgb, var(--accent-2) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-2) 30%, transparent)' }}>
            <Icon name='ghost' size={14} /> Incognito: this chat is not saved, memory is off, and it disappears when you leave. Google and Groq still process what you send.
          </div>
        </div>
      )}

      <div ref={scRef} onScroll={onScroll} className='scroll-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3'>
        <div className='msg-list mx-auto flex w-full max-w-3xl flex-col gap-5 pb-4 pt-2'>
          {messages.length === 0 && (
            <div className='fade-up flex flex-col items-center pt-8 text-center'>
              {incognito ? (
                <div className='grid h-16 w-16 place-items-center rounded-3xl text-white' style={{ background: 'linear-gradient(135deg,#475569,#1e293b)' }}>
                  <Icon name='ghost' size={30} />
                </div>
              ) : (
                <Logo size={72} />
              )}
              <h2 className='mt-5 text-2xl font-semibold tracking-tight'>{incognito ? 'Private chat' : 'How can I help?'}</h2>
              <p className='mt-1 max-w-sm text-sm text-[color:var(--muted)]'>Ask anything. Simple questions get an instant answer; bigger jobs go to the right specialist.</p>
              <div className='mt-7 grid w-full grid-cols-2 gap-2.5'>
                {STARTERS.map((s) => {
                  const ag = AGENTS[s.agent];
                  return (
                    <button
                      key={s.title}
                      className='card flex flex-col items-start gap-2 p-3.5 text-left transition hover:border-[color:var(--line-strong)] active:scale-[0.98]'
                      onClick={() => {
                        actions.setAgent(s.agent);
                        void actions.send(s.prompt);
                      }}
                    >
                      <span className='grid h-8 w-8 place-items-center rounded-xl text-white' style={{ background: ag.hue }}><Icon name={ag.icon} size={16} /></span>
                      <span className='text-sm font-medium'>{s.title}</span>
                      <span className='line-clamp-2 text-xs text-[color:var(--muted)]'>{s.prompt}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageView key={m.id} message={m} isLast={i === messages.length - 1} busy={busy} />
          ))}

          {waiting && (
            <div className='fade-up agent-rail' style={{ ['--rail' as string]: route ? (AGENTS[route.agent as AgentId]?.hue ?? 'var(--accent)') : 'var(--accent)' }}>
              <div className='flex items-center gap-2 py-1 text-xs text-[color:var(--muted)]'>
                <span className='dot' /><span className='dot' /><span className='dot' />
                {settings.showRoute && route && <span>{route.name} · {route.node.replace(/^(Gemini|Groq|OpenRouter) \/ /, '')}</span>}
              </div>
            </div>
          )}

          {interrupted && !busy && (
            <div className='card fade-up p-4' style={{ borderColor: 'color-mix(in srgb, var(--warn) 50%, transparent)' }} role='status'>
              <div className='flex items-start gap-2 text-sm'>
                <span style={{ color: 'var(--warn)' }}><Icon name='alert' size={18} /></span>
                <p className='min-w-0'>Interrupted while the app was in the background. Continue replaces the unfinished reply; your message is not sent twice.</p>
              </div>
              <div className='mt-3 flex flex-wrap gap-2'>
                <button className='neon-btn rounded-lg px-3.5 py-2 text-sm' onClick={() => actions.resume()}>Continue</button>
                <button className='ghost-btn rounded-lg px-3.5 py-2 text-sm' onClick={() => actions.dismissInterrupt()}>Dismiss</button>
              </div>
            </div>
          )}

          {error && (
            <div className='card fade-up p-4' style={{ borderColor: 'color-mix(in srgb, var(--bad) 45%, transparent)' }}>
              <div className='flex items-start gap-2 text-sm'>
                <span style={{ color: 'var(--bad)' }}><Icon name='alert' size={18} /></span>
                <p className='min-w-0 break-words'>{niceError(error)}</p>
              </div>
              <div className='mt-3 flex flex-wrap gap-2'>
                <button className='neon-btn rounded-lg px-3.5 py-2 text-sm' onClick={() => actions.retry()}>Try again</button>
                <button className='ghost-btn rounded-lg px-3.5 py-2 text-sm' onClick={() => actions.retry(undefined, true)}>Try another model</button>
                <button className='ghost-btn rounded-lg px-3.5 py-2 text-sm' onClick={() => actions.clearError()}>Dismiss</button>
              </div>
            </div>
          )}
        </div>
        {!atBottom && messages.length > 0 && (
          <button className='glass-strong sticky bottom-3 left-full z-10 grid h-10 w-10 place-items-center rounded-full' style={{ boxShadow: 'var(--shadow)' }} aria-label='Scroll to bottom' onClick={() => { const el = scRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }}>
            <Icon name='down' size={18} />
          </button>
        )}
      </div>

      <div className='flex-none' style={{ background: 'linear-gradient(transparent, var(--bg) 35%)' }}>
        <Composer />
      </div>
    </div>
  );
}
