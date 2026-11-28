'use client';

import type { UIMessage } from 'ai';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AGENTS, type AgentId } from '@/lib/agents';
import { formatBytes, isMarkerText, parseFileMark, parseReplyMark } from '@/lib/files';
import { speak, stopSpeaking } from '@/lib/voice';
import { useApp, useChatActions } from './AppProviders';
import AgentTraceAccordion, { type ToolPartLike } from './AgentTraceAccordion';
import { Icon, type IconName } from './Icons';
import Markdown from './Markdown';
import MultiFileWorkspace from './MultiFileWorkspace';
import { FlashcardDeck, QuizCard, type DeckData, type QuizData } from './StudyCards';

interface Part extends Partial<ToolPartLike> {
  type: string;
  text?: string;
  url?: string;
  mediaType?: string;
  filename?: string;
}

interface Meta {
  agent?: string;
  agentName?: string;
  reason?: string;
  model?: string;
}

const RICH = new Set(['tool-renderMultiFileWorkspace', 'tool-generateImage', 'tool-makeQuiz', 'tool-makeFlashcards', 'tool-saveMemoryFact']);

function textOf(m: UIMessage): string {
  return (m.parts as unknown as Part[])
    .map((p) => (p.type === 'text' && p.text && !isMarkerText(p.text) ? p.text : ''))
    .filter(Boolean)
    .join('\n\n');
}

/* ------------------------------ action sheet ------------------------------ */

interface MenuItem {
  icon: IconName;
  label: string;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

function ActionSheet({ title, items, onClose }: { title: string; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return createPortal(
    <div className='fixed inset-0 z-[60] flex items-end justify-center' onClick={onClose}>
      <div className='absolute inset-0 bg-black/55 backdrop-blur-[2px]' />
      <div className='glass-strong sheet-in relative w-full max-w-md rounded-t-3xl p-2 sm:mb-6 sm:rounded-3xl' style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)', boxShadow: 'var(--shadow)' }} onClick={(e) => e.stopPropagation()}>
        <div className='mx-auto mb-1 mt-1 h-1 w-10 rounded-full' style={{ background: 'var(--line-strong)' }} />
        <div className='px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>{title}</div>
        {items.map((it) => (
          <button
            key={it.label}
            className='flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-[color:var(--hover)] active:scale-[0.99]'
            style={{ color: it.danger ? 'var(--bad)' : undefined }}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            <span className='grid h-9 w-9 place-items-center rounded-xl' style={{ background: 'var(--surface-2)' }}>
              <Icon name={it.icon} size={17} />
            </span>
            <span className='min-w-0'>
              <span className='block text-[15px] font-medium'>{it.label}</span>
              {it.hint && <span className='block text-xs text-[color:var(--muted)]'>{it.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Edit box as a bottom sheet in a portal. The textarea is UNCONTROLLED (defaultValue + ref), so typing never
 * triggers a React render and nothing in the scrolling chat list can steal focus or reset the cursor.
 */
function EditSheet({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [empty, setEmpty] = useState(!initial.trim());

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const grow = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 260) + 'px';
    };
    grow();
    ta.addEventListener('input', grow);
    return () => ta.removeEventListener('input', grow);
  }, []);

  const save = () => {
    const v = ref.current?.value ?? '';
    if (v.trim()) onSave(v);
  };

  return createPortal(
    <div className='fixed inset-0 z-[75] flex items-end justify-center'>
      <div className='backdrop-in absolute inset-0 bg-black/60' onClick={() => (ref.current?.value ?? '') === initial && onCancel()} />
      <div className='sheet-in glass-strong relative w-full max-w-md rounded-t-3xl p-4 sm:mb-6 sm:rounded-3xl' style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)', boxShadow: 'var(--shadow)' }}>
        <div className='mb-2.5'>
          <div className='text-base font-semibold'>Edit message</div>
          <div className='text-xs text-[color:var(--muted)]'>Replaces this message and everything after it</div>
        </div>
        <textarea
          ref={ref}
          defaultValue={initial}
          rows={3}
          className='field scroll-thin'
          style={{ minHeight: 84, maxHeight: 260, resize: 'none', lineHeight: 1.45 }}
          aria-label='Edit your message'
          onInput={(e) => setEmpty(!(e.target as HTMLTextAreaElement).value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className='mt-3 grid grid-cols-2 gap-3'>
          <button className='ghost-btn rounded-xl py-3 text-[15px]' onClick={onCancel}>Cancel</button>
          <button className='neon-btn rounded-xl py-3 text-[15px]' disabled={empty} onClick={save}>Save and resend</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Quote card for a message that was sent as a reply. */
function QuoteCard({ role, body }: { role: string; body: string }) {
  return (
    <div className='mb-1.5 max-w-[88%] rounded-xl px-3 py-2 text-xs' style={{ background: 'var(--surface-2)', borderLeft: '3px solid var(--accent)' }}>
      <div className='mb-0.5 font-medium text-[color:var(--muted)]'>Replying to {role === 'user' ? 'you' : 'Hybrid AI'}</div>
      <div className='line-clamp-3 break-words'>{body}</div>
    </div>
  );
}

/* -------------------------------- results --------------------------------- */

function ImageResult({ part }: { part: Part }) {
  const { openConnectors } = useApp();
  const out = part.output as { ok?: boolean; dataUrl?: string; provider?: string; model?: string; error?: string; prompt?: string; expired?: boolean; omitted?: boolean; unconfigured?: boolean } | undefined;
  if (part.state === 'output-error') return <p className='text-sm text-[color:var(--bad)]'>Image generation failed: {part.errorText}</p>;
  if (!out) {
    return (
      <div className='skeleton my-2 grid aspect-square w-full max-w-[320px] place-items-center text-xs text-[color:var(--muted)]'>
        <span className='flex items-center gap-2'>
          <Icon name='image' size={16} /> Painting your image...
        </span>
      </div>
    );
  }
  if (out.ok === false) {
    return (
      <div className='my-2 rounded-xl p-3 text-sm' style={{ background: 'color-mix(in srgb, var(--bad) 12%, transparent)' }}>
        <p className='break-words' style={{ color: 'var(--bad)' }}>{out.error}</p>
        <button className='neon-btn mt-3 rounded-lg px-3.5 py-2 text-sm' onClick={() => openConnectors(out.unconfigured ? 'Add a Cloudflare Account ID and API token (free) under Image Generation, then redeploy.' : 'Check your image generation keys below, then try again.')}>
          Set up image generation
        </button>
      </div>
    );
  }
  if (!out.dataUrl) {
    return <p className='my-2 rounded-xl p-3 text-sm text-[color:var(--muted)]' style={{ background: 'var(--surface-2)' }}>This image was not kept in the saved chat to keep sync light. Ask for it again, and use Download next time.</p>;
  }
  return (
    <figure className='my-2 max-w-[420px]'>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={out.dataUrl} alt={out.prompt ?? 'Generated image'} className='w-full rounded-2xl' style={{ border: '1px solid var(--line)' }} />
      <figcaption className='mt-2 flex items-center justify-between gap-2 text-xs text-[color:var(--muted)]'>
        <span className='truncate'>{out.provider} {out.model}</span>
        <a className='ghost-btn flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[color:var(--ink)]' href={out.dataUrl} download={'image-' + Date.now() + '.png'}>
          <Icon name='download' size={13} /> Download
        </a>
      </figcaption>
    </figure>
  );
}

function UserAttachments({ parts }: { parts: Part[] }) {
  const files = parts.filter((p) => p.type === 'file');
  const marked = parts.map((p) => (p.type === 'text' && p.text ? parseFileMark(p.text) : null)).filter((x): x is { name: string; body: string } => x !== null);
  if (files.length === 0 && marked.length === 0) return null;
  return (
    <div className='mb-2 flex flex-wrap justify-end gap-2'>
      {files.map((f, i) =>
        (f.mediaType ?? '').startsWith('image/') && f.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={f.url} alt={f.filename ?? 'attachment'} className='max-h-44 max-w-[75%] rounded-2xl object-cover' style={{ border: '1px solid var(--line)' }} />
        ) : (
          <span key={i} className='chip'><Icon name='file' size={12} /> {f.filename ?? 'document'}</span>
        ),
      )}
      {marked.map((f, i) => (
        <span key={'m' + i} className='chip' title={f.name}><Icon name='file' size={12} /> {f.name} · {formatBytes(f.body.length)}</span>
      ))}
    </div>
  );
}

/* --------------------------------- message -------------------------------- */

function MessageView({ message, isLast, busy }: { message: UIMessage; isLast: boolean; busy: boolean }) {
  const { settings, notify } = useApp();
  const actions = useChatActions();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const parts = message.parts as unknown as Part[];
  const meta = (message.metadata ?? {}) as Meta;
  const isUser = message.role === 'user';
  const text = textOf(message);
  const streamingThis = busy && isLast && !isUser;

  const quote = parts.map((p) => (p.type === 'text' && p.text ? parseReplyMark(p.text) : null)).find((x) => x !== null) ?? null;

  const replyToThis = () => {
    actions.setReplyTo({ id: message.id, role: isUser ? 'user' : 'assistant', snippet: text.replace(/\s+/g, ' ').trim().slice(0, 600) || (isUser ? 'Attachment' : 'Earlier answer') });
    window.dispatchEvent(new Event('hya:focus-composer'));
  };

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  useEffect(
    () => () => {
      if (speakingRef.current) stopSpeaking();
    },
    [],
  );

  const read = () => {
    if (speaking) {
      stopSpeaking();
      return;
    }
    setSpeaking(true);
    speak(text, settings.voiceLang, {
      onEnd: () => setSpeaking(false),
      onError: (m) => notify(m),
    });
  };

  const items: MenuItem[] = isUser
    ? [
        { icon: 'edit', label: 'Edit and resend', hint: 'Replaces this message and everything after it', run: () => setEditing(true) },
        { icon: 'reply', label: 'Reply', hint: 'Quote this message in your next one', run: replyToThis },
        { icon: 'copy', label: 'Copy text', run: copy },
        { icon: 'trash', label: 'Delete', hint: 'Removes this message and its reply', danger: true, run: () => actions.remove(message.id) },
      ]
    : [
        { icon: 'refresh', label: 'Retry', hint: 'Generate this answer again', run: () => actions.retry(message.id) },
        { icon: 'refresh', label: 'Retry with another model', hint: 'Skips the model that answered', run: () => actions.retry(message.id, true) },
        { icon: 'branch', label: 'Branch from here', hint: 'Continue in a new chat, keep this one', run: () => void actions.branch(message.id) },
        { icon: 'reply', label: 'Reply', hint: 'Quote this answer in your next message', run: replyToThis },
        { icon: 'copy', label: 'Copy text', run: copy },
        { icon: 'speaker', label: speaking ? 'Stop reading' : 'Read aloud', run: read },
        { icon: 'trash', label: 'Delete', danger: true, run: () => actions.remove(message.id) },
      ];

  const menuButton = (
    <button className='icon-btn !h-8 !w-8' aria-label='Message options' onClick={() => setMenu(true)}>
      <Icon name='more' size={17} />
    </button>
  );

  /* ---------------------------------- user ---------------------------------- */
  if (isUser) {
    return (
      <div className='fade-up flex flex-col items-end'>
        {quote && <QuoteCard role={quote.role} body={quote.body} />}
        <UserAttachments parts={parts} />
        {text && <div className='bubble-user max-w-[88%] whitespace-pre-wrap break-words px-4 py-2.5 text-[15px] leading-relaxed'>{text}</div>}
        <div className='mt-0.5 flex items-center'>{menuButton}</div>
        {menu && <ActionSheet title='Your message' items={items} onClose={() => setMenu(false)} />}
        {editing && (
          <EditSheet
            initial={text}
            onCancel={() => setEditing(false)}
            onSave={(v) => {
              setEditing(false);
              void actions.edit(message.id, v);
            }}
          />
        )}
      </div>
    );
  }

  /* -------------------------------- assistant -------------------------------- */
  const agent = meta.agent && meta.agent in AGENTS ? AGENTS[meta.agent as AgentId] : null;
  const toolParts = parts.filter((p) => p.type.startsWith('tool-') && !RICH.has(p.type)) as unknown as ToolPartLike[];
  const pendingApprovals = toolParts.filter((p) => p.state === 'approval-requested' && p.approval);
  const traceParts = toolParts;

  const body: ReactNode[] = [];
  parts.forEach((p, i) => {
    if (p.type === 'text' && p.text) body.push(<Markdown key={i} text={p.text} />);
    else if (p.type === 'tool-renderMultiFileWorkspace' && p.state === 'output-available') {
      const out = p.output as { title: string; files: { path: string; content: string }[] };
      body.push(<MultiFileWorkspace key={i} title={out.title} files={out.files} />);
    } else if (p.type === 'tool-generateImage') body.push(<ImageResult key={i} part={p} />);
    else if (p.type === 'tool-makeQuiz' && p.state === 'output-available') body.push(<QuizCard key={i} quiz={p.output as QuizData} quizId={p.toolCallId} />);
    else if (p.type === 'tool-makeFlashcards' && p.state === 'output-available') body.push(<FlashcardDeck key={i} deck={p.output as DeckData} />);
  });
  const empty = body.length === 0 && traceParts.length === 0;

  return (
    <div className='fade-up agent-rail' style={{ ['--rail' as string]: agent?.hue ?? 'var(--accent)' }}>
      {settings.showTrace && traceParts.length > 0 && <AgentTraceAccordion parts={traceParts} />}
      {pendingApprovals.length > 0 && (
        <div className='my-1.5 flex items-center gap-2 rounded-xl px-3 py-2 text-xs' style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--ink)' }}>
          <span style={{ color: 'var(--warn)' }}><Icon name='lock' size={14} /></span>
          Waiting for your approval. Use the Approve / Deny pop-up.
        </div>
      )}
      {body}
      {empty && streamingThis && (
        <div className='flex items-center gap-1.5 py-2'>
          <span className='dot' /><span className='dot' /><span className='dot' />
        </div>
      )}
      {settings.showRoute && (meta.agentName || meta.model) && (
        <div className='mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--muted)]'>
          {agent && (
            <span className='flex items-center gap-1 font-medium' style={{ color: agent.hue }}>
              <Icon name={agent.icon} size={12} /> {agent.name}
            </span>
          )}
          {meta.model && <span className='font-mono'>{meta.model.replace(/^(Gemini|Groq|OpenRouter) \/ /, '')}</span>}
        </div>
      )}
      {!streamingThis && (
        <div className='-ml-2 mt-1 flex items-center gap-0.5'>
          {text && (
            <button className='icon-btn !h-8 !w-8' aria-label='Copy' onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} size={16} />
            </button>
          )}
          {text && (
            <button className='icon-btn !h-8 !w-8' aria-label={speaking ? 'Stop reading' : 'Read aloud'} onClick={read}>
              <Icon name={speaking ? 'stop' : 'speaker'} size={16} />
            </button>
          )}
          <button className='icon-btn !h-8 !w-8' aria-label='Retry' onClick={() => actions.retry(message.id)}>
            <Icon name='refresh' size={16} />
          </button>
          {menuButton}
        </div>
      )}
      {menu && <ActionSheet title='Reply options' items={items} onClose={() => setMenu(false)} />}
    </div>
  );
}

export default memo(MessageView);
