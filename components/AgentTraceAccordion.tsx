'use client';

import { useState } from 'react';
import { Icon } from './Icons';

export interface ToolPartLike {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string; requestReason?: string; isAutomatic?: boolean };
}

export function toolNameOf(part: ToolPartLike): string {
  return part.type.startsWith('tool-') ? part.type.slice(5) : part.type;
}

const STATE_LABEL: Record<string, { label: string; color: string }> = {
  'input-streaming': { label: 'preparing', color: '#9a9ab0' },
  'input-available': { label: 'running', color: '#22d3ee' },
  'approval-requested': { label: 'waiting for you', color: '#fcd34d' },
  'approval-responded': { label: 'approved', color: '#6ee7b7' },
  'output-available': { label: 'done', color: '#6ee7b7' },
  'output-error': { label: 'failed', color: '#f87171' },
  'output-denied': { label: 'denied', color: '#f87171' },
};

function preview(value: unknown, max = 1400): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined) return '';
  return text.length > max ? text.slice(0, max) + '\n... (' + (text.length - max) + ' more characters)' : text;
}

export function ApprovalCard({ part, onDecision }: { part: ToolPartLike; onDecision: (approvalId: string, approved: boolean) => void }) {
  if (!part.approval) return null;
  const approvalId = part.approval.id;
  const reason = part.approval.requestReason ?? part.approval.reason ?? 'The agent needs your permission.';
  return (
    <div className='rounded-xl p-3 text-sm' style={{ border: '1px solid rgba(251,191,36,0.45)', background: 'rgba(251,191,36,0.08)' }} role='alert'>
      <div className='mb-2 flex items-center gap-2 font-medium text-amber-200'>
        <Icon name='lock' size={14} />
        Approval needed: {toolNameOf(part)}
      </div>
      <p className='mb-2 text-xs text-amber-100/90'>{reason}</p>
      <pre className='code scroll-thin mb-3 max-h-48 rounded-lg bg-black/40 p-2 text-[11px]'>{preview(part.input, 2500)}</pre>
      <div className='flex gap-2'>
        <button type='button' className='neon-btn rounded-lg px-3.5 py-1.5 text-xs' onClick={() => onDecision(approvalId, true)}>
          Approve
        </button>
        <button type='button' className='ghost-btn rounded-lg px-3.5 py-1.5 text-xs' onClick={() => onDecision(approvalId, false)}>
          Deny
        </button>
      </div>
    </div>
  );
}

export default function AgentTraceAccordion({ parts }: { parts: ToolPartLike[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (parts.length === 0) return null;
  const running = parts.some((p) => p.state === 'input-available' || p.state === 'input-streaming');
  return (
    <div className='glass rounded-xl text-xs'>
      <button type='button' className='flex w-full items-center gap-2 px-3 py-2 text-left' onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={open ? 'down' : 'right'} size={13} />
        <Icon name='terminal' size={13} />
        <span className='font-medium'>Agent trace</span>
        <span className='text-[color:var(--muted)]'>
          {parts.length} step{parts.length === 1 ? '' : 's'}
          {running ? ' - working...' : ''}
        </span>
      </button>
      {open && (
        <ul className='space-y-1 px-3 pb-3'>
          {parts.map((p) => {
            const s = STATE_LABEL[p.state] ?? { label: p.state, color: '#9a9ab0' };
            const isOpen = expanded[p.toolCallId] === true;
            return (
              <li key={p.toolCallId} className='rounded-lg bg-black/25 px-2.5 py-1.5'>
                <button type='button' className='flex w-full items-center justify-between gap-2 text-left' onClick={() => setExpanded({ ...expanded, [p.toolCallId]: !isOpen })}>
                  <code>{toolNameOf(p)}</code>
                  <span style={{ color: s.color }}>{s.label}</span>
                </button>
                {isOpen && (
                  <div className='mt-2 space-y-2'>
                    {p.input !== undefined && <pre className='code scroll-thin max-h-40 rounded bg-black/40 p-2'>{preview(p.input)}</pre>}
                    {p.output !== undefined && <pre className='code scroll-thin max-h-56 rounded bg-black/40 p-2'>{preview(p.output)}</pre>}
                    {p.errorText && <p className='text-red-300'>{p.errorText}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
