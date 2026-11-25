'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toolNameOf, type ToolPartLike } from './AgentTraceAccordion';
import { useChatActions, useChatMessages, useChatMeta } from './AppProviders';
import { Icon } from './Icons';

interface PushFile {
  path: string;
  action?: 'write' | 'delete';
  content?: string;
}

const TITLES: Record<string, string> = {
  pushToGitHubRepo: 'Push changes to GitHub',
  triggerRedeploy: 'Redeploy on Vercel',
  callWebhookConnector: 'Call an automation webhook',
};

const bytes = (n: number) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');

function FileRow({ f }: { f: PushFile }) {
  const [open, setOpen] = useState(false);
  const del = f.action === 'delete';
  const size = (f.content ?? '').length;
  return (
    <li className='rounded-xl' style={{ background: 'var(--surface-2)' }}>
      <button className='flex w-full items-center gap-2 px-3 py-2.5 text-left' onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className='chip flex-none' style={{ color: del ? 'var(--bad)' : 'var(--good)' }}>{del ? 'delete' : 'write'}</span>
        <code className='min-w-0 flex-1 truncate !bg-transparent !p-0 text-[13px]'>{f.path}</code>
        {!del && <span className='flex-none text-[11px] text-[color:var(--muted)]'>{bytes(size)}</span>}
        <Icon name={open ? 'down' : 'right'} size={14} />
      </button>
      {open && !del && (
        <pre className='code scroll-thin max-h-56 rounded-b-xl p-3 text-[11px]' style={{ background: 'var(--code-bg)' }}>
          {(f.content ?? '').slice(0, 3000)}
          {size > 3000 ? '\n... (' + (size - 3000).toLocaleString() + ' more characters)' : ''}
        </pre>
      )}
    </li>
  );
}

/**
 * Full-screen Approve / Deny pop-up. Opens whenever any tool in the latest answer is waiting for approval.
 * Nothing runs until the person decides, every single time.
 */
export default function ApprovalModal() {
  const messages = useChatMessages();
  const { status } = useChatMeta();
  const actions = useChatActions();

  const pending = useMemo<ToolPartLike | null>(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return null;
    const parts = last.parts as unknown as ToolPartLike[];
    return parts.find((p) => typeof p.type === 'string' && p.type.startsWith('tool-') && p.state === 'approval-requested' && p.approval) ?? null;
  }, [messages]);

  if (!pending || !pending.approval || status === 'submitted' || status === 'streaming') return null;

  const name = toolNameOf(pending);
  const approvalId = pending.approval.id;
  const input = (pending.input ?? {}) as { message?: string; files?: PushFile[] };
  const isPush = name === 'pushToGitHubRepo' && Array.isArray(input.files);
  const reason = pending.approval.requestReason ?? pending.approval.reason ?? 'The agent needs your permission before it can do this.';

  let raw = '';
  if (!isPush) {
    try {
      raw = JSON.stringify(pending.input ?? {}, null, 2).slice(0, 2500);
    } catch {
      raw = String(pending.input);
    }
  }

  return createPortal(
    <div className='fixed inset-0 z-[80] flex items-end justify-center sm:items-center' role='alertdialog' aria-modal='true' aria-label='Approval needed'>
      <div className='backdrop-in absolute inset-0 bg-black/70' />
      <div className='sheet-in glass-strong relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl' style={{ boxShadow: 'var(--shadow)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className='flex items-center gap-3 px-5 pb-2 pt-5'>
          <span className='grid h-11 w-11 flex-none place-items-center rounded-2xl' style={{ background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' }}>
            <Icon name='lock' size={20} />
          </span>
          <div className='min-w-0'>
            <div className='text-[17px] font-semibold leading-tight'>{TITLES[name] ?? 'Approval needed: ' + name}</div>
            <div className='text-xs text-[color:var(--muted)]'>Nothing happens until you choose.</div>
          </div>
        </div>

        <div className='scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-3'>
          <p className='mb-3 text-sm text-[color:var(--muted)]'>{reason}</p>
          {isPush ? (
            <>
              <div className='mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]'>Commit message</div>
              <div className='mb-3 rounded-xl px-3 py-2.5 text-sm' style={{ background: 'var(--surface-2)' }}>{input.message}</div>
              <div className='mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]'>{input.files!.length} file{input.files!.length === 1 ? '' : 's'} in one commit</div>
              <ul className='mb-3 flex flex-col gap-1.5'>
                {input.files!.map((f, i) => <FileRow key={f.path + i} f={f} />)}
              </ul>
              <div className='flex items-start gap-2 rounded-xl p-3 text-xs' style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--ink)' }}>
                <span style={{ color: 'var(--warn)' }}><Icon name='alert' size={15} /></span>
                <span>Vercel rebuilds the live app after this push. If the build fails, the last good version stays online. Protected files, workflows and repository deletion are always blocked by the server.</span>
              </div>
            </>
          ) : (
            <pre className='code scroll-thin max-h-60 rounded-xl p-3 text-[11px]' style={{ background: 'var(--code-bg)' }}>{raw}</pre>
          )}
        </div>

        <div className='grid grid-cols-2 gap-3 px-5 pb-5 pt-2'>
          <button className='ghost-btn rounded-2xl py-3.5 text-[15px] font-semibold' style={{ color: 'var(--bad)' }} onClick={() => actions.decide(approvalId, false)}>
            Deny
          </button>
          <button className='neon-btn rounded-2xl py-3.5 text-[15px]' onClick={() => actions.decide(approvalId, true)}>
            Approve
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
