'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AGENTS, AGENT_ORDER, type AgentId } from '@/lib/agents';
import { ACCEPT, formatBytes, processFile, type Attachment } from '@/lib/files';
import { CLIENT_COMMANDS, SKILLS } from '@/lib/skills';
import { useVoice } from '@/lib/voice';
import { useApp, useChatActions, useChatMeta } from './AppProviders';
import { Icon } from './Icons';

const PLACEHOLDER: Partial<Record<AgentId, string>> = {
  auto: 'Ask anything',
  coder: 'Describe what to build',
  researcher: 'What to look up?',
  reasoner: 'A problem to solve',
  writer: 'What to write?',
  vision: 'Attach a file and ask',
  study: 'What to learn?',
  image: 'Describe the image',
  quick: 'Quick question',
};

const MAX_FILES = 4;

/** Keep the keyboard open and the layout still when a composer button is pressed. */
const keepFocus = { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() };

export function AgentSheet({ onClose }: { onClose: () => void }) {
  const { agent } = useChatMeta();
  const actions = useChatActions();
  return createPortal(
    <div className='fixed inset-0 z-[60] flex items-end justify-center' onClick={onClose}>
      <div className='absolute inset-0 bg-black/55 backdrop-blur-[2px]' />
      <div className='glass-strong sheet-in scroll-thin relative max-h-[82dvh] w-full max-w-md overflow-y-auto rounded-t-3xl p-2 sm:mb-6 sm:rounded-3xl' style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)', boxShadow: 'var(--shadow)' }} onClick={(e) => e.stopPropagation()}>
        <div className='mx-auto mb-1 mt-1 h-1 w-10 rounded-full' style={{ background: 'var(--line-strong)' }} />
        <div className='px-4 pb-2 pt-2'>
          <div className='text-base font-semibold'>Choose an agent</div>
          <div className='text-xs text-[color:var(--muted)]'>Auto lets the Lead Orchestrator answer directly or route to a specialist.</div>
        </div>
        {AGENT_ORDER.map((id) => {
          const a = AGENTS[id];
          const on = agent === id;
          return (
            <button
              key={id}
              className='flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[color:var(--hover)] active:scale-[0.99]'
              style={on ? { background: 'color-mix(in srgb, ' + a.hue + ' 14%, transparent)', outline: '1px solid ' + a.hue } : undefined}
              onClick={() => {
                actions.setAgent(id);
                onClose();
              }}
            >
              <span className='grid h-10 w-10 flex-none place-items-center rounded-xl text-white' style={{ background: a.hue }}>
                <Icon name={a.icon} size={19} />
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block text-[15px] font-medium'>{a.name}</span>
                <span className='block text-xs text-[color:var(--muted)]'>{a.tagline}</span>
              </span>
              {on && <Icon name='check' size={18} />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

const DRAFT_KEY = 'hya:draft';

function Composer() {
  const { settings, notify } = useApp();
  const { busy, agent, incognito, status, replyTo } = useChatMeta();
  const actions = useChatActions();
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [processing, setProcessing] = useState(0);
  const [sheet, setSheet] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voiceBase = useRef('');

  const voice = useVoice({
    engine: settings.voiceEngine,
    lang: settings.voiceLang,
    onText: (t) => setInput((voiceBase.current ? voiceBase.current.replace(/\s+$/, '') + ' ' : '') + t),
    onError: notify,
  });

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 168) + 'px';
  }, [input]);

  // Restore an unsent draft (survives Chrome killing the tab in the background). Never for incognito.
  useEffect(() => {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d && !incognito) setInput(d);
    } catch {
      /* storage blocked */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced: typing itself never waits on storage.
  useEffect(() => {
    if (incognito) return;
    const t = window.setTimeout(() => {
      try {
        if (input) localStorage.setItem(DRAFT_KEY, input);
        else localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [input, incognito]);

  useEffect(() => {
    const focus = () => window.setTimeout(() => taRef.current?.focus(), 60);
    window.addEventListener('hya:focus-composer', focus);
    return () => window.removeEventListener('hya:focus-composer', focus);
  }, []);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      setInput((e as CustomEvent<string>).detail);
      taRef.current?.focus();
    };
    window.addEventListener('hya:prefill', onPrefill);
    return () => window.removeEventListener('hya:prefill', onPrefill);
  }, []);

  const slash = useMemo(() => {
    if (!/^\/[a-z-]*$/i.test(input)) return [];
    const q = input.toLowerCase();
    return [
      ...SKILLS.map((s) => ({ command: s.command, hint: s.hint })),
      ...CLIENT_COMMANDS.map((c) => ({ command: c.command.split(' ')[0], hint: c.hint })),
    ].filter((c) => c.command.startsWith(q));
  }, [input]);

  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const picked = Array.from(list);
    if (files.length + picked.length > MAX_FILES) notify('You can attach up to ' + MAX_FILES + ' files per message.');
    for (const f of picked.slice(0, Math.max(0, MAX_FILES - files.length))) {
      setProcessing((n) => n + 1);
      try {
        const a = await processFile(f, settings.voiceLang);
        setFiles((cur) => [...cur, a]);
      } catch (e) {
        notify(f.name + ': ' + (e instanceof Error ? e.message : 'could not be read'));
      } finally {
        setProcessing((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length > 0) {
      e.preventDefault();
      void addFiles(imgs);
    }
  }

  async function submit() {
    if (voice.listening) voice.stop();
    const text = input;
    const attached = files;
    if ((!text.trim() && attached.length === 0) || processing > 0) return;
    setInput('');
    setFiles([]);
    voiceBase.current = '';
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    await actions.send(text, attached);
  }

  const canSend = (input.trim().length > 0 || files.length > 0) && processing === 0;
  const a = AGENTS[agent];

  return (
    <div className='px-3 pb-2 pt-1' style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
      <div className='mx-auto w-full max-w-3xl'>
        {slash.length > 0 && (
          <div className='glass-strong pop-in scroll-thin mb-2 max-h-[42dvh] overflow-y-auto rounded-2xl' style={{ boxShadow: 'var(--shadow)' }} role='listbox' aria-label='Commands'>
            {slash.map((c) => (
              <button key={c.command} {...keepFocus} className='flex w-full items-baseline gap-3 px-4 py-2.5 text-left hover:bg-[color:var(--hover)]' onClick={() => { setInput(c.command + ' '); taRef.current?.focus(); }}>
                <span className='font-mono text-sm' style={{ color: 'var(--accent)' }}>{c.command}</span>
                <span className='truncate text-xs text-[color:var(--muted)]'>{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        {replyTo && (
          <div className='pop-in mb-2 flex items-start gap-2 rounded-2xl py-2 pl-3 pr-1.5 text-xs' style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: '3px solid var(--accent)' }}>
            <span className='mt-0.5 flex-none' style={{ color: 'var(--accent)' }}><Icon name='reply' size={14} /></span>
            <span className='min-w-0 flex-1'>
              <span className='block font-medium'>Replying to {replyTo.role === 'user' ? 'your message' : 'Hybrid AI'}</span>
              <span className='line-clamp-2 break-words text-[color:var(--muted)]'>{replyTo.snippet}</span>
            </span>
            <button {...keepFocus} className='icon-btn !h-7 !w-7 flex-none' aria-label='Cancel reply' onClick={() => actions.setReplyTo(null)}><Icon name='x' size={14} /></button>
          </div>
        )}
        {(files.length > 0 || processing > 0) && (
          <div className='no-scrollbar mb-2 flex gap-2 overflow-x-auto'>
            {files.map((f) => (
              <div key={f.id} className='card-flat flex flex-none items-center gap-2 py-1.5 pl-1.5 pr-2 text-xs' style={{ border: '1px solid var(--line)' }}>
                {f.kind === 'image' && f.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.dataUrl} alt='' className='h-9 w-9 rounded-lg object-cover' />
                ) : (
                  <span className='grid h-9 w-9 place-items-center rounded-lg' style={{ background: 'var(--surface)' }}><Icon name={f.kind === 'audio' ? 'mic' : 'file'} size={16} /></span>
                )}
                <span className='max-w-[120px]'>
                  <span className='block truncate font-medium'>{f.name}</span>
                  <span className='block text-[color:var(--muted)]'>{f.note ?? formatBytes(f.size)}</span>
                </span>
                <button className='icon-btn !h-6 !w-6' aria-label='Remove' onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}><Icon name='x' size={13} /></button>
              </div>
            ))}
            {processing > 0 && <div className='skeleton h-12 w-28 flex-none' />}
          </div>
        )}
        <div className={'card flex items-end gap-1 p-1.5 ' + (incognito ? 'incognito-glow' : '')} style={{ borderRadius: 26, boxShadow: 'var(--shadow)' }}>
          <button className='icon-btn flex-none' {...keepFocus} aria-label='Attach file' onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_FILES}>
            <Icon name='clip' size={20} />
          </button>
          <input ref={fileRef} type='file' multiple accept={ACCEPT} className='hidden' onChange={(e) => void addFiles(e.target.files)} />
          <button className='flex h-10 flex-none items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition active:scale-95' style={{ background: 'color-mix(in srgb, ' + a.hue + ' 16%, transparent)', color: a.hue }} onClick={() => setSheet(true)} aria-label='Choose agent'>
            <Icon name={a.icon} size={15} />
            <span className='hidden min-[430px]:inline'>{agent === 'auto' ? 'Auto' : a.name.split(' ')[0]}</span>
          </button>
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && settings.sendOnEnter && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={voice.listening ? 'Listening...' : (PLACEHOLDER[agent] ?? 'Ask anything')}
            className='max-h-[168px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[16px] leading-snug outline-none placeholder:text-[color:var(--muted)]'
            enterKeyHint={settings.sendOnEnter ? 'send' : 'enter'}
            aria-label='Message'
          />
          <button
            {...keepFocus}
            className={'icon-btn flex-none ' + (voice.listening ? 'mic-live' : '')}
            aria-label={voice.listening ? 'Stop voice typing' : 'Start voice typing'}
            disabled={!voice.supported || voice.busy}
            title={voice.supported ? 'Voice typing' : 'Voice typing is not supported in this browser'}
            onClick={() => {
              if (!voice.listening) voiceBase.current = input;
              voice.toggle();
            }}
          >
            {voice.busy ? <span className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' /> : <Icon name={voice.supported ? 'mic' : 'mic-off'} size={20} />}
          </button>
          {busy ? (
            <button {...keepFocus} className='flex h-10 w-10 flex-none items-center justify-center rounded-full text-white' style={{ background: 'var(--ink)', color: 'var(--bg)' }} aria-label='Stop' onClick={() => actions.stop()}>
              <Icon name='stop' size={16} />
            </button>
          ) : (
            <button {...keepFocus} className='neon-btn flex h-10 w-10 flex-none items-center justify-center rounded-full' aria-label='Send' disabled={!canSend} onClick={() => void submit()}>
              <Icon name='arrow-up' size={19} />
            </button>
          )}
        </div>
        {(status === 'submitted' || incognito) && (
          <p className='mt-1.5 text-center text-[11px] text-[color:var(--muted)]'>
            {status === 'submitted' ? 'Routing your message...' : 'Incognito: nothing here is saved on this device or in Drive.'}
          </p>
        )}
      </div>
      {sheet && <AgentSheet onClose={() => setSheet(false)} />}
    </div>
  );
}

/** Memoised: it re-renders only when light chat state changes, never per streamed token. */
export default memo(Composer);
