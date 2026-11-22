'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useChatActions, useChatCtx } from '@/components/AppProviders';
import { PageScroll } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { AGENTS, type AgentId } from '@/lib/agents';
import type { ThreadMeta } from '@/lib/threads';

function bucket(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? 'This week' : 'Earlier';
}

export default function HistoryPage() {
  const router = useRouter();
  const { threads, threadId, incognito } = useChatCtx();
  const actions = useChatActions();
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = threads.filter((t) => !term || t.title.toLowerCase().includes(term) || (t.preview ?? '').toLowerCase().includes(term));
    const out: { label: string; items: ThreadMeta[] }[] = [];
    const pinned = list.filter((t) => t.pinned);
    if (pinned.length) out.push({ label: 'Pinned', items: pinned });
    for (const t of list.filter((x) => !x.pinned)) {
      const label = bucket(t.updatedAt);
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(t);
      else out.push({ label, items: [t] });
    }
    return out;
  }, [threads, q]);

  async function open(id: string) {
    await actions.openThread(id);
    router.push('/');
  }

  return (
    <PageScroll
      title='History'
      subtitle={threads.length + ' saved chats'}
      actions={
        <button className='neon-btn flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm' onClick={() => { actions.newChat(); router.push('/'); }}>
          <Icon name='plus' size={16} /> New
        </button>
      }
    >
      <div className='relative mb-4'>
        <span className='pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--muted)]'><Icon name='search' size={17} /></span>
        <input className='field !pl-10' placeholder='Search chats' value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {incognito && <p className='mb-3 rounded-xl p-3 text-xs text-[color:var(--muted)]' style={{ background: 'var(--surface-2)' }}>You are in an incognito chat. It is not listed here and will not be saved.</p>}
      {groups.length === 0 && (
        <div className='grid place-items-center py-16 text-center text-[color:var(--muted)]'>
          <Icon name='history' size={34} />
          <p className='mt-3 text-sm'>{q ? 'No chats match your search.' : 'Your chats will appear here.'}</p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.label} className='mb-5'>
          <h2 className='mb-2 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>{g.label}</h2>
          <div className='card divide-y divide-[color:var(--line)] overflow-hidden'>
            {g.items.map((t) => {
              const ag = t.agent && t.agent in AGENTS ? AGENTS[t.agent as AgentId] : null;
              return (
                <div key={t.id} className='flex items-center gap-1 pr-1.5' style={t.id === threadId ? { background: 'var(--hover)' } : undefined}>
                  <button className='flex min-w-0 flex-1 items-center gap-3 p-3.5 text-left' onClick={() => void open(t.id)}>
                    <span className='grid h-9 w-9 flex-none place-items-center rounded-xl text-white' style={{ background: ag?.hue ?? 'var(--accent)' }}>
                      <Icon name={t.branchOf ? 'branch' : (ag?.icon ?? 'chat')} size={16} />
                    </span>
                    <span className='min-w-0'>
                      <span className='flex items-center gap-1.5 truncate text-[15px] font-medium'>{t.pinned && <Icon name='pin' size={12} />}{t.title}</span>
                      <span className='block truncate text-xs text-[color:var(--muted)]'>{t.preview || 'Empty chat'}</span>
                    </span>
                  </button>
                  <button className='icon-btn !h-9 !w-9' aria-label={t.pinned ? 'Unpin' : 'Pin'} onClick={() => void actions.pinThread(t.id)}><Icon name='pin' size={15} /></button>
                  <button className='icon-btn !h-9 !w-9' aria-label='Rename' onClick={() => { const n = window.prompt('Rename chat', t.title); if (n) void actions.renameThread(t.id, n); }}><Icon name='edit' size={15} /></button>
                  <button
                    className='icon-btn !h-9 !w-9'
                    style={confirm === t.id ? { background: 'var(--bad)', color: '#fff' } : undefined}
                    aria-label='Delete'
                    onClick={() => {
                      if (confirm === t.id) {
                        setConfirm(null);
                        void actions.deleteThread(t.id);
                      } else {
                        setConfirm(t.id);
                        setTimeout(() => setConfirm((c) => (c === t.id ? null : c)), 3000);
                      }
                    }}
                  >
                    <Icon name='trash' size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </PageScroll>
  );
}
