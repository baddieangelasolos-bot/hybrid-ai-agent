'use client';

import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AGENTS, type AgentId } from '@/lib/agents';
import { apiRequest } from '@/lib/api';
import { fileTextPart, parseFileMark, type Attachment } from '@/lib/files';
import { addFact, deleteFact, factsForPrompt, loadFacts } from '@/lib/memory';
import { DEFAULT_SETTINGS, SETTINGS_STORE_KEY, applyTheme, haptic, loadCooldowns, loadSettingsLocal, mergeServerLedger, saveSettingsLocal, type Settings } from '@/lib/settings';
import { storage } from '@/lib/storage';
import { THREAD_INDEX_KEY, compactForSave, listThreads, loadThread, newId, previewFrom, threadKey, titleFrom, type ThreadMeta } from '@/lib/threads';
import type { MemoryFact, Permission } from '@/lib/types';
import { speak } from '@/lib/voice';
import ConnectorsDrawer from './ConnectorsDrawer';
import { Icon } from './Icons';

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

export interface ChatCtx {
  messages: UIMessage[];
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  error: Error | undefined;
  busy: boolean;
  route: RouteInfo | null;
  threadId: string;
  incognito: boolean;
  agent: AgentId;
  setAgent: (a: AgentId) => void;
  threads: ThreadMeta[];
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
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
}

const ChatContext = createContext<ChatCtx | null>(null);

export type ChatActions = Pick<ChatCtx, 'send' | 'edit' | 'retry' | 'branch' | 'remove' | 'stop' | 'clearError' | 'decide' | 'newChat' | 'openThread' | 'deleteThread' | 'renameThread' | 'pinThread' | 'deleteAllThreads' | 'exportAll' | 'setAgent'>;
const ActionsContext = createContext<ChatActions | null>(null);
/** Stable identity across streaming updates, so finished messages never re-render. */
export function useChatActions(): ChatActions {
  const v = useContext(ActionsContext);
  if (!v) throw new Error('useChatActions must be used inside AppProviders');
  return v;
}
export function useChatCtx(): ChatCtx {
  const v = useContext(ChatContext);
  if (!v) throw new Error('useChatCtx must be used inside AppProviders');
  return v;
}

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

function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <div className='grid place-items-center text-white' style={{ width: size, height: size, borderRadius: size * 0.3, background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', boxShadow: '0 10px 30px color-mix(in srgb, var(--accent) 40%, transparent)' }}>
      <Icon name='spark' size={size * 0.5} />
    </div>
  );
}

function Splash() {
  return (
    <div className='grid h-[100dvh] place-items-center'>
      <div className='fade-up flex flex-col items-center gap-4'>
        <LogoMark size={64} />
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
          <LogoMark />
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

function ChatEngine({ children, facts, addMemory }: { children: ReactNode; facts: MemoryFact[]; addMemory: (f: { id?: string; fact: string; tag?: string; ts?: number }) => void }) {
  const app = useApp();
  const { settings } = app;
  const [agent, setAgent] = useState<AgentId>(settings.agent);
  const [incognito, setIncognito] = useState(false);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [threads, setThreads] = useState<ThreadMeta[]>([]);

  const ref = useRef({ settings, permissions: app.permissions, facts, agent, incognito, rotation: 0 });
  ref.current = { ...ref.current, settings, permissions: app.permissions, facts, agent, incognito };
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
  const { messages, status, error, sendMessage, regenerate, setMessages, stop, clearError, addToolApprovalResponse } = useChat({ chat, experimental_throttle: 50 });
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

  /* ---------- actions ---------- */
  const newChat = useCallback(
    (opts?: { incognito?: boolean }) => {
      chat.stop();
      const inc = Boolean(opts?.incognito);
      setIncognito(inc);
      setRoute(null);
      ref.current.rotation = 0;
      setChat(makeChat((inc ? 'incognito-' : '') + newId(), []));
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

  const send = useCallback(
    async (rawText: string, attachments: Attachment[] = []) => {
      const text = rawText.trim();
      const env = text.match(/^\/env\s+([A-Za-z_][A-Za-z0-9_]*)=([\s\S]+)$/);
      if (env) return handleEnv(env[1].toUpperCase(), env[2].trim());
      if (text === '/memory') return app.notify(facts.length ? 'Memory: ' + facts.map((f) => f.fact).join(' | ') : 'Memory is empty.');
      if (text === '/clear') return newChat();
      if (text === '/incognito') return newChat({ incognito: true });
      if (!text && attachments.length === 0) return;

      const parts: PartLike[] = [];
      parts.push({ type: 'text', text: text || 'Please look at the attached file' + (attachments.length > 1 ? 's' : '') + ' and summarise the key points.' });
      for (const a of attachments) {
        if ((a.kind === 'image' || a.kind === 'pdf') && a.dataUrl) parts.push({ type: 'file', mediaType: a.mediaType, url: a.dataUrl, filename: a.name });
        else if (a.text !== undefined) parts.push({ type: 'text', text: fileTextPart(a) });
      }
      ref.current.rotation = 0;
      clearError();
      haptic(settings.haptics);
      await sendMessage({ parts } as never);
    },
    [app, clearError, facts, handleEnv, newChat, sendMessage, settings.haptics],
  );

  const edit = useCallback(
    async (messageId: string, text: string) => {
      const m = messages.find((x) => x.id === messageId);
      if (!m || !text.trim()) return;
      const parts = [...(m.parts as unknown as PartLike[])];
      const i = parts.findIndex((p) => p.type === 'text' && !parseFileMark(p.text ?? ''));
      if (i >= 0) parts[i] = { ...parts[i], text: text.trim() };
      else parts.unshift({ type: 'text', text: text.trim() });
      ref.current.rotation = 0;
      clearError();
      await sendMessage({ parts, messageId } as never);
    },
    [clearError, messages, sendMessage],
  );

  const retry = useCallback(
    (messageId?: string, another?: boolean) => {
      ref.current.rotation = another ? ref.current.rotation + 1 : 0;
      clearError();
      void regenerate(messageId ? { messageId } : undefined);
    },
    [clearError, regenerate],
  );

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

  const openThread = useCallback(
    async (id: string) => {
      chat.stop();
      const msgs = await loadThread(id);
      setIncognito(false);
      setRoute(null);
      const meta = threadsRef.current.find((t) => t.id === id);
      if (meta?.agent && meta.agent in AGENTS) setAgent(meta.agent as AgentId);
      setChat(makeChat(id, msgs));
    },
    [chat, makeChat],
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
    return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Hybrid AI Agent', memory: facts, threads: out }, null, 2);
  }, [facts]);

  /* ---------- url hooks: PWA shortcut ---------- */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      newChat();
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (settings.incognitoDefault && messages.length === 0) setIncognito(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<ChatCtx>(
    () => ({
      messages,
      status,
      error,
      busy,
      route,
      threadId: chat.id,
      incognito,
      agent,
      setAgent,
      threads,
      send,
      edit,
      retry,
      branch,
      remove,
      stop: () => void stop(),
      clearError,
      decide: (approvalId, approved) => void addToolApprovalResponse({ id: approvalId, approved }),
      newChat,
      openThread,
      deleteThread,
      renameThread,
      pinThread,
      deleteAllThreads,
      exportAll,
    }),
    [messages, status, error, busy, route, chat.id, incognito, agent, threads, send, edit, retry, branch, remove, stop, clearError, addToolApprovalResponse, newChat, openThread, deleteThread, renameThread, pinThread, deleteAllThreads, exportAll],
  );

  const liveRef = useRef<ChatActions>(value);
  liveRef.current = value;
  const actions = useMemo<ChatActions>(
    () => ({
      send: (...a) => liveRef.current.send(...a),
      edit: (...a) => liveRef.current.edit(...a),
      retry: (...a) => liveRef.current.retry(...a),
      branch: (...a) => liveRef.current.branch(...a),
      remove: (...a) => liveRef.current.remove(...a),
      stop: () => liveRef.current.stop(),
      clearError: () => liveRef.current.clearError(),
      decide: (...a) => liveRef.current.decide(...a),
      newChat: (...a) => liveRef.current.newChat(...a),
      openThread: (...a) => liveRef.current.openThread(...a),
      deleteThread: (...a) => liveRef.current.deleteThread(...a),
      renameThread: (...a) => liveRef.current.renameThread(...a),
      pinThread: (...a) => liveRef.current.pinThread(...a),
      deleteAllThreads: () => liveRef.current.deleteAllThreads(),
      exportAll: () => liveRef.current.exportAll(),
      setAgent: (...a) => liveRef.current.setAgent(...a),
    }),
    [],
  );

  return (
    <ChatContext.Provider value={value}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </ChatContext.Provider>
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
  const [drawer, setDrawer] = useState<{ open: boolean; notice: string | null }>({ open: false, notice: null });
  const syncTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const s = loadSettingsLocal();
    setSettings(s);
    applyTheme(s);
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
    () => ({ settings, setSetting, resetSettings, notify, openConnectors, permissions, facts, removeFact, logout }),
    [settings, setSetting, resetSettings, notify, openConnectors, permissions, facts, removeFact, logout],
  );

  if (authed === null) return <Splash />;
  if (!authed) return <LoginScreen onLoggedIn={() => setAuthed(true)} />;

  return (
    <AppContext.Provider value={app}>
      <ChatEngine facts={facts} addMemory={addMemory}>
        {children}
      </ChatEngine>
      <ConnectorsDrawer open={drawer.open} onClose={() => setDrawer({ open: false, notice: null })} permissions={permissions} onPermissionsChange={onPermissions} initialNotice={drawer.notice ? { type: 'ok', text: drawer.notice } : undefined} />
      <div className='pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4' style={{ bottom: 'calc(env(safe-area-inset-bottom) + 84px)' }}>
        {notices.map((n) => (
          <div key={n.id} className='glass-strong pop-in pointer-events-auto max-w-md rounded-2xl px-4 py-2.5 text-sm' style={{ boxShadow: 'var(--shadow)' }}>
            {n.text}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
