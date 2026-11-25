'use client';

import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AGENTS, effectiveChain, type AgentId } from '@/lib/agents';
import { apiRequest } from '@/lib/api';
import { parseCommand, type ChatCommand } from '@/lib/commands';
import { fileTextPart, isMarkerText, replyTextPart, type Attachment } from '@/lib/files';
import { MODEL_BY_KEY } from '@/lib/models';
import { addFact, deleteFact, factsForPrompt, loadFacts, updateFact } from '@/lib/memory';
import { DEFAULT_PROFILE, PROFILE_KEY, PROFILE_LOCAL_KEY, learnFromMessage, type UserProfile } from '@/lib/profile';
import { DEFAULT_SETTINGS, SETTINGS_STORE_KEY, applyTheme, haptic, loadCooldowns, loadSettingsLocal, mergeServerLedger, saveSettingsLocal, type Settings } from '@/lib/settings';
import { storage } from '@/lib/storage';
import { THREAD_INDEX_KEY, compactForSave, listThreads, loadThread, newId, previewFrom, threadKey, titleFrom, type ThreadMeta } from '@/lib/threads';
import type { MemoryFact, Permission } from '@/lib/types';
import { speak } from '@/lib/voice';
import ConnectorsDrawer from './ConnectorsDrawer';
import Logo from './Logo';

/* -------------------------------------------------------------------------- */
/*                                 app context                                */
/* -------------------------------------------------------------------------- */

interface Notice {
  id: string;
  text: string;
}

export interface AppCtx {
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
  notify: (text: string) => void;
  openConnectors: (notice?: string) => void;
  permissions: Record<string, Permission>;
  facts: MemoryFact[];
  removeFact: (id: string) => Promise<void>;
  addFactManual: (text: string) => Promise<void>;
  editFact: (id: string, text: string) => Promise<void>;
  profile: UserProfile;
  setProfile: (p: UserProfile) => void;
  resetProfile: () => void;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside AppProviders');
  return v;
}

/* -------------------------------------------------------------------------- */
/*                                 chat context                               */
/* -------------------------------------------------------------------------- */

export interface RouteInfo {
  agent: string;
  name: string;
  reason: string;
  node: string;
}

export interface ReplyTarget {
  id: string;
  role: 'user' | 'assistant';
  snippet: string;
}

/** Everything that does NOT change while tokens stream. Composer, header and pages use only this. */
export interface ChatMeta {
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  error: Error | undefined;
  busy: boolean;
  route: RouteInfo | null;
  threadId: string;
  incognito: boolean;
  agent: AgentId;
  threads: ThreadMeta[];
  replyTo: ReplyTarget | null;
  interrupted: boolean;
}

export interface ChatMessagesCtx {
  messages: UIMessage[];
}

export interface ChatActions {
  send: (text: string, attachments?: Attachment[], opts?: { agent?: AgentId }) => Promise<void>;
  edit: (messageId: string, text: string) => Promise<void>;
  retry: (messageId?: string, another?: boolean) => void;
  branch: (messageId: string) => Promise<void>;
  remove: (messageId: string) => void;
  stop: () => void;
  clearError: () => void;
  decide: (approvalId: string, approved: boolean) => void;
  newChat: (opts?: { incognito?: boolean }) => void;
  openThread: (id: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  renameThread: (id: string, title: string) => Promise<void>;
  pinThread: (id: string) => Promise<void>;
  deleteAllThreads: () => Promise<void>;
  exportAll: () => Promise<string>;
  setAgent: (a: AgentId) => void;
  setReplyTo: (r: ReplyTarget | null) => void;
  resume: () => void;
  dismissInterrupt: () => void;
}

const MetaContext = createContext<ChatMeta | null>(null);
const MessagesContext = createContext<ChatMessagesCtx | null>(null);
const ActionsContext = createContext<ChatActions | null>(null);

/** Stable identity across streaming updates, so finished messages never re-render. */
export function useChatActions(): ChatActions {
  const v = useContext(ActionsContext);
  if (!v) throw new Error('useChatActions must be used inside AppProviders');
  return v;
}
/** Changes only when something other than streamed text changes (busy, agent, thread, error...). */
export function useChatMeta(): ChatMeta {
  const v = useContext(MetaContext);
  if (!v) throw new Error('useChatMeta must be used inside AppProviders');
  return v;
}
/** Changes on every streamed token. Use only where the message list itself is needed. */
export function useChatMessages(): UIMessage[] {
  const v = useContext(MessagesContext);
  if (!v) throw new Error('useChatMessages must be used inside AppProviders');
  return v.messages;
}
/** Back-compat alias: the light, non-streaming context. */
export const useChatCtx = useChatMeta;

/* -------------------------------------------------------------------------- */
/*                                   helpers                                  */
/* -------------------------------------------------------------------------- */

interface PartLike {
  type: string;
  text?: string;
  url?: string;
  output?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Keeps requests small: old attachments and generated images are not re-uploaded every turn. */
function slimForSend(messages: UIMessage[]): UIMessage[] {
  let lastUser = -1;
  messages.forEach((m, i) => m.role === 'user' && (lastUser = i));
  return messages.map((m, i) => ({
    ...m,
    parts: (m.parts as unknown as PartLike[]).map((p) => {
      if (p.type === 'file' && i < lastUser) return { type: 'text', text: '[attachment omitted]' };
      if (p.type.startsWith('tool-') && p.output && typeof p.output.dataUrl === 'string' && p.output.dataUrl.length > 1000) {
        return { ...p, output: { ...p.output, dataUrl: '', omitted: true } };
      }
      return p;
    }) as unknown as UIMessage['parts'],
  }));
}

const MAX_BODY = 4_300_000;

/* -------------------------------------------------------------------------- */
/*                                login + splash                              */
/* -------------------------------------------------------------------------- */

function Splash() {
  return (
    <div className='grid h-[100dvh] place-items-center'>
      <div className='fade-up flex flex-col items-center gap-4'>
        <Logo size={72} />
        <div className='skeleton h-3 w-28' />
      </div>
    </div>
  );
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    const r = await apiRequest<{ authed?: boolean }>('/api/auth', { method: 'POST', body: { password } });
    setBusy(false);
    if (r.ok) onLoggedIn();
    else setError(r.message || 'Wrong password.');
  }

  return (
    <div className='safe-top safe-bottom grid min-h-[100dvh] place-items-center px-5'>
      <form onSubmit={submit} className='card fade-up w-full max-w-sm p-7' style={{ boxShadow: 'var(--shadow)' }}>
        <div className='mb-6 flex flex-col items-center text-center'>
          <Logo size={72} />
          <h1 className='mt-4 text-xl font-semibold tracking-tight'>Hybrid AI Agent</h1>
          <p className='mt-1 text-sm text-[color:var(--muted)]'>Your private multi-agent assistant</p>
        </div>
        <input className='field' type='password' autoComplete='current-password' placeholder='Password' value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <p className='mt-3 text-sm text-[color:var(--bad)]'>{error}</p>}
        <button className='neon-btn mt-4 w-full rounded-xl py-3 text-[15px]' disabled={busy || !password}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                chat engine                                 */
/* -------------------------------------------------------------------------- */

const ACTION_KEYS = ['send', 'edit', 'retry', 'branch', 'remove', 'stop', 'clearError', 'decide', 'newChat', 'openThread', 'deleteThread', 'renameThread', 'pinThread', 'deleteAllThreads', 'exportAll', 'setAgent', 'setReplyTo', 'resume', 'dismissInterrupt'] as const;
const NETWORK_ERR = /network|failed to fetch|load failed|terminated|connection|abort|econnreset|socket|timed? ?out/i;

function ChatEngine({ children, facts, addMemory }: { children: ReactNode; facts: MemoryFact[]; addMemory: (f: { id?: string; fact: string; tag?: string; ts?: number }) => void }) {
  const app = useApp();
  const router = useRouter();
  const { settings, profile } = app;
  const [agent, setAgent] = useState<AgentId>(settings.agent);
  const [incognito, setIncognito] = useState(false);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [interrupted, setInterrupted] = useState(false);

  const ref = useRef({ settings, permissions: app.permissions, facts, agent, incognito, profile, replyTo, rotation: 0 });
  ref.current = { ...ref.current, settings, permissions: app.permissions, facts, agent, incognito, profile, replyTo };
  const threadsRef = useRef<ThreadMeta[]>([]);
  threadsRef.current = threads;
  const branchOf = useRef<Record<string, string>>({});
  const handled = useRef(new Set<string>());

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ messages, id, trigger, messageId }) => {
          const s = ref.current;
          const body = {
            id,
            trigger,
            messageId,
            messages: slimForSend(messages),
            permissions: s.permissions,
            persona: s.settings.persona,
            memory: s.settings.memoryEnabled && !s.incognito ? factsForPrompt(s.facts, 10) : [],
            profile: s.settings.memoryEnabled && !s.incognito ? s.profile : undefined,
            chains: s.settings.chains,
            agent: s.agent,
            incognito: s.incognito,
            rotation: s.rotation,
            cooldowns: loadCooldowns(),
          };
          if (JSON.stringify(body).length > MAX_BODY) throw new Error('This message with its attachments is too large to send (limit about 4 MB). Remove or shrink a file.');
          return { body };
        },
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          const id = res.headers.get('x-agent-id');
          if (id) setRoute({ agent: id, name: res.headers.get('x-agent-name') ?? id, reason: res.headers.get('x-agent-reason') ?? '', node: res.headers.get('x-agent-node') ?? '' });
          if (res.status === 401) window.location.reload();
          return res;
        },
      }),
    [],
  );

  const makeChat = useCallback(
    (id: string, initial: UIMessage[]) => new Chat<UIMessage>({ id, messages: initial, transport, sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses }),
    [transport],
  );
  const [chat, setChat] = useState<Chat<UIMessage>>(() => makeChat(newId(), []));
  const { messages, status, error, sendMessage, regenerate, setMessages, stop, clearError, addToolApprovalResponse } = useChat({ chat, experimental_throttle: 90 });
  const busy = status === 'submitted' || status === 'streaming';

  /* ---------- threads index ---------- */
  useEffect(() => {
    void listThreads().then(setThreads);
  }, []);

  const persistNow = useCallback(async () => {
    const id = chat.id;
    const msgs = chat.messages;
    if (ref.current.incognito || msgs.length === 0) return;
    await storage.save(threadKey(id), compactForSave(msgs));
    const prev = threadsRef.current.find((t) => t.id === id);
    const meta: ThreadMeta = {
      id,
      title: prev?.title ?? titleFrom(msgs),
      updatedAt: Date.now(),
      preview: previewFrom(msgs),
      agent: ref.current.agent,
      branchOf: prev?.branchOf ?? branchOf.current[id],
      pinned: prev?.pinned,
    };
    const next = [meta, ...threadsRef.current.filter((t) => t.id !== id)];
    setThreads(next);
    await storage.save(THREAD_INDEX_KEY, next);
  }, [chat]);

  useEffect(() => {
    if (incognito || messages.length === 0 || busy) return;
    const t = window.setTimeout(() => void persistNow(), 500);
    return () => window.clearTimeout(t);
  }, [messages, busy, incognito, persistNow]);

  useEffect(() => {
    const flush = () => document.visibilityState === 'hidden' && void persistNow();
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [persistNow]);

  /* ---------- recovery when Chrome was in the background ---------- */
  const busyRef = useRef(false);
  busyRef.current = busy;
  const lastProgress = useRef(Date.now());
  const hiddenAt = useRef(0);
  const returnedAt = useRef(0);
  const autoRetried = useRef(false);

  useEffect(() => {
    lastProgress.current = Date.now();
  }, [messages, status]);

  useEffect(() => {
    const back = (kind: 'visibility' | 'focus' | 'online') => {
      if (kind === 'visibility' && document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      const wasAway = hiddenAt.current > 0 && Date.now() - hiddenAt.current > 1500;
      if (kind !== 'online' && !wasAway) return;
      hiddenAt.current = 0;
      returnedAt.current = Date.now();
      // The phone may have frozen the connection while the tab was hidden: stop waiting and offer Continue.
      if (busyRef.current && Date.now() - lastProgress.current > 6000) {
        void chat.stop();
        setInterrupted(true);
      }
    };
    const onVis = () => back('visibility');
    const onFocus = () => back('focus');
    const onOnline = () => back('online');
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [chat]);

  // One silent retry when a network error shows up right after coming back from the background.
  useEffect(() => {
    if (!error || autoRetried.current || Date.now() - returnedAt.current > 10_000 || !NETWORK_ERR.test(error.message)) return;
    autoRetried.current = true;
    clearError();
    void regenerate();
  }, [error, clearError, regenerate]);

  /* ---------- side effects of finished answers ---------- */
  const prevBusy = useRef(false);
  useEffect(() => {
    if (prevBusy.current && !busy) {
      void apiRequest<{ ledger?: { key: string; until: number }[] }>('/api/health/models?mode=ledger').then((r) => r.data?.ledger && mergeServerLedger(r.data.ledger));
      if (settings.autoSpeak) {
        const last = [...messages].reverse().find((m) => m.role === 'assistant');
        const text = ((last?.parts ?? []) as unknown as PartLike[]).map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join(' ');
        if (text) speak(text, settings.voiceLang);
      }
      haptic(settings.haptics, 12);
    }
    prevBusy.current = busy;
  }, [busy, messages, settings.autoSpeak, settings.voiceLang, settings.haptics]);

  useEffect(() => {
    if (incognito || !settings.memoryEnabled) return;
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      for (const p of m.parts as unknown as PartLike[]) {
        if (p.type !== 'tool-saveMemoryFact' || p.state !== 'output-available') continue;
        const id = String(p.toolCallId ?? '');
        const out = p.output as { saved?: boolean; id?: string; fact?: string; tag?: string; ts?: number } | undefined;
        if (!id || handled.current.has(id) || !out?.saved || !out.fact) continue;
        handled.current.add(id);
        addMemory({ id: out.id, fact: out.fact, tag: out.tag, ts: out.ts });
        app.notify('Saved to memory: ' + out.fact);
      }
    }
  }, [messages, incognito, settings.memoryEnabled, addMemory, app]);

  /* ---------- thread actions ---------- */
  const newChat = useCallback(
    (opts?: { incognito?: boolean }) => {
      chat.stop();
      const inc = Boolean(opts?.incognito);
      setIncognito(inc);
      setRoute(null);
      setReplyTo(null);
      setInterrupted(false);
      ref.current.rotation = 0;
      setChat(makeChat((inc ? 'incognito-' : '') + newId(), []));
    },
    [chat, makeChat],
  );

  const openThread = useCallback(
    async (id: string) => {
      chat.stop();
      const msgs = await loadThread(id);
      setIncognito(false);
      setRoute(null);
      setReplyTo(null);
      setInterrupted(false);
      const meta = threadsRef.current.find((t) => t.id === id);
      if (meta?.agent && meta.agent in AGENTS) setAgent(meta.agent as AgentId);
      setChat(makeChat(id, msgs));
    },
    [chat, makeChat],
  );

  const handleEnv = useCallback(
    async (name: string, value: string) => {
      const r = await apiRequest<{ masked?: Record<string, string>; redeploy?: { ok: boolean; detail: string } | null }>('/api/settings', { method: 'POST', body: { vars: { [name]: value }, redeploy: true } });
      if (!r.ok) return app.notify('Could not save ' + name + ': ' + r.message);
      const dep = r.data?.redeploy;
      app.notify('Saved ' + name + ' = ' + (r.data?.masked?.[name] ?? '********') + ' to Vercel. ' + (dep ? (dep.ok ? 'Redeploy started (about a minute).' : 'Redeploy failed: ' + dep.detail) : 'Redeploy to activate.'));
    },
    [app],
  );

  /** Commands that change app state instead of going to a model. */
  const runCommand = useCallback(
    async (cmd: ChatCommand) => {
      if (cmd.kind === 'last-chat') {
        const other = [...threadsRef.current].filter((t) => t.id !== chat.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!other) return app.notify('There is no other saved chat yet.');
        await openThread(other.id);
        router.push('/');
        return app.notify('Switched to your last chat: ' + other.title);
      }
      if (cmd.kind === 'find-chat') {
        const words = cmd.query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
        const hit = [...threadsRef.current]
          .filter((t) => t.id !== chat.id)
          .filter((t) => words.every((w) => (t.title + ' ' + (t.preview ?? '')).toLowerCase().includes(w)))
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!hit) return app.notify('No saved chat matches "' + cmd.query + '".');
        await openThread(hit.id);
        router.push('/');
        return app.notify('Opened chat: ' + hit.title);
      }
      if (cmd.kind === 'primary') {
        const base = effectiveChain(cmd.agent, ref.current.settings.chains[cmd.agent]);
        const order = [cmd.model.key, ...base.filter((k) => k !== cmd.model.key)];
        app.setSetting('chains', { ...ref.current.settings.chains, [cmd.agent]: order });
        return app.notify(cmd.model.label + ' is now #1 for ' + AGENTS[cmd.agent].name + '. New order starts: ' + order.slice(0, 3).map((k) => MODEL_BY_KEY[k]?.label ?? k).join(' > ') + '. Saved on this device and Drive.');
      }
      if (cmd.kind === 'model-unknown') return app.notify('I could not find "' + cmd.text + '". Try a name like Gemini 4 Hydrogen, GPT-OSS 120B or Qwen 3.8 27B, optionally followed by an agent (for example researcher).');
      if (cmd.kind === 'profile') router.push('/settings#profile');
    },
    [app, chat.id, openThread, router],
  );

  /* ---------- sending ---------- */
  const send = useCallback(
    async (rawText: string, attachments: Attachment[] = [], opts?: { agent?: AgentId }) => {
      const text = rawText.trim();
      const env = text.match(/^\/env\s+([A-Za-z_][A-Za-z0-9_]*)=([\s\S]+)$/);
      if (env) return handleEnv(env[1].toUpperCase(), env[2].trim());
      if (text === '/memory') return app.notify(facts.length ? 'Memory: ' + facts.map((f) => f.fact).join(' | ') : 'Memory is empty.');
      if (text === '/clear') return newChat();
      if (text === '/incognito') return newChat({ incognito: true });
      if (!text && attachments.length === 0) return;
      if (attachments.length === 0) {
        const cmd = parseCommand(text, ref.current.agent);
        if (cmd) return runCommand(cmd);
      }

      if (!ref.current.incognito && ref.current.settings.memoryEnabled) {
        const learned = learnFromMessage(text, ref.current.profile);
        if (learned) {
          app.setProfile(learned.profile);
          app.notify('Noted: ' + learned.note);
        }
      }

      if (opts?.agent) {
        ref.current.agent = opts.agent;
        setAgent(opts.agent);
      }
      const parts: PartLike[] = [];
      parts.push({ type: 'text', text: text || 'Please look at the attached file' + (attachments.length > 1 ? 's' : '') + ' and summarise the key points.' });
      const reply = ref.current.replyTo;
      if (reply) {
        parts.push({ type: 'text', text: replyTextPart(reply.role, reply.snippet) });
        setReplyTo(null);
      }
      for (const a of attachments) {
        if ((a.kind === 'image' || a.kind === 'pdf') && a.dataUrl) parts.push({ type: 'file', mediaType: a.mediaType, url: a.dataUrl, filename: a.name });
        else if (a.text !== undefined) parts.push({ type: 'text', text: fileTextPart(a) });
      }
      ref.current.rotation = 0;
      autoRetried.current = false;
      setInterrupted(false);
      clearError();
      haptic(ref.current.settings.haptics);
      await sendMessage({ parts } as never);
    },
    [app, clearError, facts, handleEnv, newChat, runCommand, sendMessage],
  );

  const edit = useCallback(
    async (messageId: string, text: string) => {
      const m = messages.find((x) => x.id === messageId);
      if (!m || !text.trim()) return;
      const parts = [...(m.parts as unknown as PartLike[])];
      const i = parts.findIndex((p) => p.type === 'text' && !isMarkerText(p.text ?? ''));
      if (i >= 0) parts[i] = { ...parts[i], text: text.trim() };
      else parts.unshift({ type: 'text', text: text.trim() });
      ref.current.rotation = 0;
      autoRetried.current = false;
      setInterrupted(false);
      clearError();
      await sendMessage({ parts, messageId } as never);
    },
    [clearError, messages, sendMessage],
  );

  const retry = useCallback(
    (messageId?: string, another?: boolean) => {
      ref.current.rotation = another ? ref.current.rotation + 1 : 0;
      autoRetried.current = false;
      setInterrupted(false);
      clearError();
      void regenerate(messageId ? { messageId } : undefined);
    },
    [clearError, regenerate],
  );

  /** Continue after an interruption: replaces the partial reply, never adds a second user turn. */
  const resume = useCallback(() => {
    setInterrupted(false);
    autoRetried.current = true;
    clearError();
    void regenerate();
  }, [clearError, regenerate]);

  const remove = useCallback(
    (messageId: string) => {
      const i = messages.findIndex((m) => m.id === messageId);
      if (i < 0) return;
      const drop = new Set([messageId]);
      if (messages[i].role === 'user' && messages[i + 1]?.role === 'assistant') drop.add(messages[i + 1].id);
      setMessages(messages.filter((m) => !drop.has(m.id)));
    },
    [messages, setMessages],
  );

  const branch = useCallback(
    async (messageId: string) => {
      const i = messages.findIndex((m) => m.id === messageId);
      if (i < 0) return;
      const copy = JSON.parse(JSON.stringify(messages.slice(0, i + 1))) as UIMessage[];
      const id = newId();
      const parent = chat.id;
      if (!incognito) {
        branchOf.current[id] = parent;
        const title = 'Branch: ' + (threadsRef.current.find((t) => t.id === parent)?.title ?? titleFrom(copy));
        await storage.save(threadKey(id), compactForSave(copy));
        const meta: ThreadMeta = { id, title: title.slice(0, 60), updatedAt: Date.now(), preview: previewFrom(copy), agent, branchOf: parent };
        const next = [meta, ...threadsRef.current];
        setThreads(next);
        await storage.save(THREAD_INDEX_KEY, next);
      }
      chat.stop();
      setChat(makeChat(id, copy));
      app.notify('Branched into a new chat. The original is unchanged.');
    },
    [agent, app, chat, incognito, makeChat, messages],
  );

  const deleteThread = useCallback(
    async (id: string) => {
      const next = threadsRef.current.filter((t) => t.id !== id);
      setThreads(next);
      await storage.remove(threadKey(id));
      await storage.save(THREAD_INDEX_KEY, next);
      if (id === chat.id) newChat();
    },
    [chat.id, newChat],
  );

  const renameThread = useCallback(async (id: string, title: string) => {
    const next = threadsRef.current.map((t) => (t.id === id ? { ...t, title: title.trim().slice(0, 60) || t.title } : t));
    setThreads(next);
    await storage.save(THREAD_INDEX_KEY, next);
  }, []);

  const pinThread = useCallback(async (id: string) => {
    const next = threadsRef.current.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
    setThreads(next);
    await storage.save(THREAD_INDEX_KEY, next);
  }, []);

  const deleteAllThreads = useCallback(async () => {
    for (const t of threadsRef.current) await storage.remove(threadKey(t.id));
    setThreads([]);
    await storage.save(THREAD_INDEX_KEY, []);
    newChat();
  }, [newChat]);

  const exportAll = useCallback(async () => {
    const out: { meta: ThreadMeta; messages: UIMessage[] }[] = [];
    for (const t of threadsRef.current) out.push({ meta: t, messages: await loadThread(t.id) });
    return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Hybrid AI Agent', memory: facts, profile, threads: out }, null, 2);
  }, [facts, profile]);

  /* ---------- url hooks: PWA shortcut ---------- */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      newChat();
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (settings.incognitoDefault && messages.length === 0) setIncognito(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- contexts ---------- */
  const meta = useMemo<ChatMeta>(
    () => ({ status, error, busy, route, threadId: chat.id, incognito, agent, threads, replyTo, interrupted }),
    [status, error, busy, route, chat.id, incognito, agent, threads, replyTo, interrupted],
  );
  const msgCtx = useMemo<ChatMessagesCtx>(() => ({ messages }), [messages]);

  const impl: ChatActions = {
    send,
    edit,
    retry,
    branch,
    remove,
    stop: () => {
      setInterrupted(false);
      void stop();
    },
    clearError,
    decide: (approvalId, approved) => void addToolApprovalResponse({ id: approvalId, approved }),
    newChat,
    openThread,
    deleteThread,
    renameThread,
    pinThread,
    deleteAllThreads,
    exportAll,
    setAgent,
    setReplyTo,
    resume,
    dismissInterrupt: () => setInterrupted(false),
  };
  const liveRef = useRef<ChatActions>(impl);
  liveRef.current = impl;
  const actions = useMemo<ChatActions>(
    () => Object.fromEntries(ACTION_KEYS.map((k) => [k, (...a: unknown[]) => (liveRef.current[k] as (...x: unknown[]) => unknown)(...a)])) as unknown as ChatActions,
    [],
  );

  return (
    <MetaContext.Provider value={meta}>
      <MessagesContext.Provider value={msgCtx}>
        <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
      </MessagesContext.Provider>
    </MetaContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  provider                                  */
/* -------------------------------------------------------------------------- */

export default function AppProviders({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [permissions, setPermissions] = useState<Record<string, Permission>>({});
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [profile, setProfileState] = useState<UserProfile>(DEFAULT_PROFILE);
  const profileTimer = useRef<number | undefined>(undefined);
  const [drawer, setDrawer] = useState<{ open: boolean; notice: string | null }>({ open: false, notice: null });
  const syncTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const s = loadSettingsLocal();
    setSettings(s);
    applyTheme(s);
    try {
      const raw = localStorage.getItem(PROFILE_LOCAL_KEY);
      if (raw) setProfileState({ ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<UserProfile>) });
    } catch {
      /* ignore broken saved profile */
    }
    void apiRequest<{ authed?: boolean }>('/api/auth').then((r) => setAuthed(Boolean(r.data?.authed)));
  }, []);

  useEffect(() => {
    if (settings.theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme(settings);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [settings]);

  useEffect(() => {
    if (!authed) return;
    storage.startHealthMonitor();
    void storage.load<Settings>(SETTINGS_STORE_KEY).then((r) => {
      if (r.value && r.source === 'drive' && !localStorage.getItem('hya:settings')) {
        const merged = { ...DEFAULT_SETTINGS, ...r.value };
        setSettings(merged);
        saveSettingsLocal(merged);
        applyTheme(merged);
      }
    });
    void storage.load<UserProfile>(PROFILE_KEY).then((r) => {
      if (r.value && !localStorage.getItem(PROFILE_LOCAL_KEY)) {
        const merged = { ...DEFAULT_PROFILE, ...r.value };
        setProfileState(merged);
        try {
          localStorage.setItem(PROFILE_LOCAL_KEY, JSON.stringify(merged));
        } catch {
          /* ignore */
        }
      }
    });
    void storage.load<Record<string, Permission>>('prefs/permissions').then((r) => r.value && setPermissions(r.value));
    void loadFacts().then(setFacts);
    const params = new URLSearchParams(window.location.search);
    if (params.get('connector')) {
      setDrawer({ open: true, notice: params.get('connector') === 'google_connected' ? 'Google Drive connected.' : 'Connector update: ' + params.get('connector') });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [authed]);

  const notify = useCallback((text: string) => {
    const id = crypto.randomUUID();
    setNotices((n) => [...n, { id, text }].slice(-3));
    window.setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 6000);
  }, []);

  const setSetting = useCallback<AppCtx['setSetting']>((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettingsLocal(next);
      applyTheme(next);
      window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void storage.save(SETTINGS_STORE_KEY, next), 1200);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    saveSettingsLocal(DEFAULT_SETTINGS);
    applyTheme(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
    void storage.save(SETTINGS_STORE_KEY, DEFAULT_SETTINGS);
  }, []);

  const removeFact = useCallback(async (id: string) => setFacts(await deleteFact(id)), []);
  const addFactManual = useCallback(async (text: string) => setFacts(await addFact({ fact: text, tag: 'manual' })), []);
  const editFact = useCallback(async (id: string, text: string) => setFacts(await updateFact(id, text)), []);
  const setProfile = useCallback((p: UserProfile) => {
    const next = { ...p, updatedAt: Date.now() };
    setProfileState(next);
    try {
      localStorage.setItem(PROFILE_LOCAL_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.clearTimeout(profileTimer.current);
    profileTimer.current = window.setTimeout(() => void storage.save(PROFILE_KEY, next), 1200);
  }, []);
  const resetProfile = useCallback(() => setProfile({ ...DEFAULT_PROFILE }), [setProfile]);
  const addMemory = useCallback((f: { id?: string; fact: string; tag?: string; ts?: number }) => void addFact(f).then(setFacts), []);
  const logout = useCallback(async () => {
    await apiRequest('/api/auth', { method: 'DELETE' });
    window.location.href = '/';
  }, []);
  const openConnectors = useCallback((notice?: string) => setDrawer({ open: true, notice: notice ?? null }), []);

  const onPermissions = useCallback((next: Record<string, Permission>) => {
    setPermissions(next);
    void storage.save('prefs/permissions', next);
  }, []);

  const app = useMemo<AppCtx>(
    () => ({ settings, setSetting, resetSettings, notify, openConnectors, permissions, facts, removeFact, addFactManual, editFact, profile, setProfile, resetProfile, logout }),
    [settings, setSetting, resetSettings, notify, openConnectors, permissions, facts, removeFact, addFactManual, editFact, profile, setProfile, resetProfile, logout],
  );

  if (authed === null) return <Splash />;
  if (!authed) return <LoginScreen onLoggedIn={() => setAuthed(true)} />;

  return (
    <AppContext.Provider value={app}>
      <ChatEngine facts={facts} addMemory={addMemory}>
        {children}
      </ChatEngine>
      <ConnectorsDrawer open={drawer.open} onClose={() => setDrawer({ open: false, notice: null })} permissions={permissions} onPermissionsChange={onPermissions} initialNotice={drawer.notice ? { type: 'ok', text: drawer.notice } : undefined} />
      <div className='pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4' style={{ top: 'calc(env(safe-area-inset-top) + 68px)' }}>
        {notices.map((n) => (
          <div key={n.id} className='glass-strong pop-in pointer-events-auto max-w-md rounded-2xl px-4 py-2.5 text-sm' style={{ boxShadow: 'var(--shadow)' }}>
            {n.text}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
