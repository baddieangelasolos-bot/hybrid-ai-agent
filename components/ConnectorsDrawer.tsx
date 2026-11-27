'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { strictest } from '@/lib/connectors/permissions';
import { CATEGORIES, CONNECTORS, requiredEnv, type Category, type ConnectorDef } from '@/lib/connectors/registry';
import { apiRequest } from '@/lib/api';
import { storage } from '@/lib/storage';
import type { Permission } from '@/lib/types';
import { Icon } from './Icons';

interface CustomConnector {
  id: string;
  name: string;
  category: Category;
  description: string;
  createdAt: number;
}

interface EnvStatus {
  ok: boolean;
  runtime: Record<string, boolean>;
  vercelNames: string[] | null;
  vercelError: string | null;
  canWrite: boolean;
  driveConfigured: boolean;
  redirectUri: string;
}

interface SaveResponse {
  ok: boolean;
  saved?: string[];
  masked?: Record<string, string>;
  redeploy?: { ok: boolean; detail: string } | null;
}

type ConnState = 'connected' | 'pending' | 'disconnected' | 'planned';
type Notice = { type: 'ok' | 'error'; text: string } | null;
type Target = { kind: 'builtin'; def: ConnectorDef } | { kind: 'custom'; custom: CustomConnector } | null;

interface Props {
  open: boolean;
  onClose: () => void;
  permissions: Record<string, Permission>;
  onPermissionsChange: (next: Record<string, Permission>) => void;
  initialNotice?: Notice;
}

const CUSTOM_KEY = 'connectors/custom';
const PERMISSION_LABEL: Record<Permission, string> = { always: 'Always allow', ask: 'Ask first', blocked: 'Blocked' };

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

function initials(name: string): string {
  const parts = name.split(/[\s.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function stateFor(required: string[], env: EnvStatus | null): ConnState {
  if (!env) return 'disconnected';
  if (required.length > 0 && required.every((n) => env.runtime[n])) return 'connected';
  if (required.length > 0 && env.vercelNames && required.every((n) => env.vercelNames?.includes(n))) return 'pending';
  return 'disconnected';
}

function Badge({ state }: { state: ConnState }) {
  const map: Record<ConnState, { label: string; color: string; bg: string }> = {
    connected: { label: 'Connected', color: '#6ee7b7', bg: 'rgba(52,211,153,0.12)' },
    pending: { label: 'Pending redeploy', color: '#fcd34d', bg: 'rgba(251,191,36,0.12)' },
    disconnected: { label: 'Not connected', color: '#9a9ab0', bg: 'rgba(255,255,255,0.05)' },
    planned: { label: 'Planned', color: '#9a9ab0', bg: 'rgba(255,255,255,0.05)' },
  };
  const m = map[state];
  return (
    <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]' style={{ color: m.color, background: m.bg, border: '1px solid ' + m.color + '40' }}>
      {state === 'connected' && <Icon name='check' size={11} />}
      {m.label}
    </span>
  );
}

function Brand({ name, accent }: { name: string; accent: string }) {
  return (
    <span
      className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold'
      style={{ color: accent, background: accent + '1f', border: '1px solid ' + accent + '55', boxShadow: '0 0 14px ' + accent + '33' }}
    >
      {initials(name)}
    </span>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center p-4' role='dialog' aria-modal='true' aria-label={title}>
      <div className='absolute inset-0 bg-black/70' onClick={onClose} />
      <div className='glass-strong relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-5 scroll-thin'>
        <div className='mb-4 flex items-center justify-between'>
          <h3 className='text-base font-semibold'>{title}</h3>
          <button type='button' onClick={onClose} className='ghost-btn rounded-lg p-1.5' aria-label='Close'>
            <Icon name='x' size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ConnectorsDrawer({ open, onClose, permissions, onPermissionsChange, initialNotice = null }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'All'>('All');
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [envError, setEnvError] = useState('');
  const [customs, setCustoms] = useState<CustomConnector[]>([]);
  const [target, setTarget] = useState<Target>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [redeploy, setRedeploy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(initialNotice);
  const [modalError, setModalError] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<Category>('Automation');
  const [newDescription, setNewDescription] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newKey, setNewKey] = useState('');

  const loadEnv = useCallback(async () => {
    const res = await apiRequest<EnvStatus>('/api/settings');
    if (res.ok && res.data) {
      setEnv(res.data);
      setEnvError('');
    } else {
      setEnvError(res.message || 'Could not load connection status.');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadEnv();
    void storage.load<CustomConnector[]>(CUSTOM_KEY).then((r) => setCustoms(Array.isArray(r.value) ? r.value : []));
    const timer = window.setInterval(() => void loadEnv(), 8000);
    return () => window.clearInterval(timer);
  }, [open, loadEnv]);

  useEffect(() => {
    setNotice(initialNotice);
  }, [initialNotice]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (target || customOpen) {
          setTarget(null);
          setCustomOpen(false);
        } else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, target, customOpen]);

  const customAsDefs = useMemo(
    () =>
      customs.map((c) => ({
        custom: c,
        required: ['CUSTOM_' + c.id.toUpperCase() + '_URL'],
      })),
    [customs],
  );

  const q = query.trim().toLowerCase();
  const matches = (name: string, description: string, cat: string, extra: string): boolean =>
    q === '' || (name + ' ' + description + ' ' + cat + ' ' + extra).toLowerCase().includes(q);

  const builtin = CONNECTORS.filter((c) => (category === 'All' || c.category === category) && matches(c.name, c.description, c.category, c.tools.map((t) => t.name).join(' ')));
  const customList = customAsDefs.filter(({ custom }) => (category === 'All' || custom.category === category) && matches(custom.name, custom.description, custom.category, 'custom webhook'));

  function setPermission(id: string, p: Permission): void {
    onPermissionsChange({ ...permissions, [id]: p });
  }

  function openConnect(t: Target): void {
    setValues({});
    setModalError('');
    setTarget(t);
  }

  async function startGoogle(): Promise<void> {
    setBusy(true);
    setModalError('');
    const res = await apiRequest<{ ok: boolean; url?: string }>('/api/oauth/google/start', { method: 'POST', body: {} });
    setBusy(false);
    if (res.ok && res.data?.url) {
      window.location.assign(res.data.url);
    } else {
      setModalError(res.message || 'Could not start Google authorization.');
    }
  }

  async function saveCredentials(vars: Record<string, string>): Promise<SaveResponse | null> {
    const res = await apiRequest<SaveResponse>('/api/settings', { method: 'POST', body: { vars, redeploy } });
    if (!res.ok) {
      setModalError(res.message);
      return null;
    }
    return res.data;
  }

  async function submitBuiltin(def: ConnectorDef): Promise<void> {
    setModalError('');
    const vars: Record<string, string> = {};
    for (const f of def.fields) {
      const v = (values[f.env] ?? '').trim();
      if (v) vars[f.env] = v;
    }
    const missing = def.fields.filter((f) => !f.optional && !vars[f.env] && !(env?.runtime[f.env] || env?.vercelNames?.includes(f.env)));
    if (missing.length > 0) {
      setModalError('Please fill: ' + missing.map((m) => m.label).join(', '));
      return;
    }
    if (def.method === 'webhook') {
      const url = vars[def.fields[0].env];
      if (url && !/^https:\/\//i.test(url)) {
        setModalError('Webhook URLs must start with https://');
        return;
      }
    }
    if (Object.keys(vars).length === 0) {
      setModalError('Enter at least one value to save.');
      return;
    }
    setBusy(true);
    const data = await saveCredentials(vars);
    setBusy(false);
    if (data) {
      setNotice({
        type: 'ok',
        text: def.name + ' saved to Vercel (' + (data.saved ?? []).join(', ') + '). ' + (data.redeploy ? (data.redeploy.ok ? 'Redeploy started, it takes about a minute.' : 'Redeploy failed: ' + data.redeploy.detail) : 'Redeploy to activate.'),
      });
      setTarget(null);
      void loadEnv();
    }
  }

  async function submitCustomUpdate(custom: CustomConnector): Promise<void> {
    setModalError('');
    const base = 'CUSTOM_' + custom.id.toUpperCase();
    const vars: Record<string, string> = {};
    if ((values.url ?? '').trim()) vars[base + '_URL'] = values.url.trim();
    if ((values.key ?? '').trim()) vars[base + '_KEY'] = values.key.trim();
    if (vars[base + '_URL'] && !/^https:\/\//i.test(vars[base + '_URL'])) {
      setModalError('URL must start with https://');
      return;
    }
    if (Object.keys(vars).length === 0) {
      setModalError('Enter a new URL or key to save.');
      return;
    }
    setBusy(true);
    const data = await saveCredentials(vars);
    setBusy(false);
    if (data) {
      setNotice({ type: 'ok', text: custom.name + ' updated. ' + (data.redeploy?.ok ? 'Redeploy started.' : 'Redeploy to activate.') });
      setTarget(null);
      void loadEnv();
    }
  }

  async function submitNewCustom(): Promise<void> {
    setModalError('');
    const id = slug(newName);
    if (newName.trim().length < 2 || id.length < 2) {
      setModalError('Give the connector a name (letters or numbers).');
      return;
    }
    if (customs.some((c) => c.id === id) || CONNECTORS.some((c) => c.id === id)) {
      setModalError('A connector with this name already exists.');
      return;
    }
    if (!/^https:\/\//i.test(newUrl.trim())) {
      setModalError('Webhook / API URL must start with https://');
      return;
    }
    const vars: Record<string, string> = { ['CUSTOM_' + id.toUpperCase() + '_URL']: newUrl.trim() };
    if (newKey.trim()) vars['CUSTOM_' + id.toUpperCase() + '_KEY'] = newKey.trim();
    setBusy(true);
    const data = await saveCredentials(vars);
    if (data) {
      const entry: CustomConnector = { id, name: newName.trim(), category: newCategory, description: newDescription.trim() || 'Custom webhook connector', createdAt: Date.now() };
      const next = [...customs, entry];
      setCustoms(next);
      await storage.save(CUSTOM_KEY, next);
      onPermissionsChange({ ...permissions, ['custom:' + id]: 'ask' });
      setNotice({ type: 'ok', text: entry.name + ' added. Credentials went to Vercel; ' + (data.redeploy?.ok ? 'redeploy started.' : 'redeploy to activate.') });
      setCustomOpen(false);
      setNewName('');
      setNewDescription('');
      setNewUrl('');
      setNewKey('');
      void loadEnv();
    }
    setBusy(false);
  }

  async function removeCustom(custom: CustomConnector): Promise<void> {
    const next = customs.filter((c) => c.id !== custom.id);
    setCustoms(next);
    await storage.save(CUSTOM_KEY, next);
    const copy = { ...permissions };
    delete copy['custom:' + custom.id];
    onPermissionsChange(copy);
    setNotice({ type: 'ok', text: custom.name + ' removed from the list. Its CUSTOM_' + custom.id.toUpperCase() + '_* variables stay in Vercel until you delete them there.' });
  }

  function copyText(text: string): void {
    void navigator.clipboard?.writeText(text);
  }

  if (!open) return null;

  const permissionSelect = (id: string, fallback: Permission) => (
    <select
      aria-label='Permission'
      className='field !w-auto !py-1 text-xs'
      value={strictest(permissions[id] ?? fallback, fallback)}
      onChange={(e) => setPermission(id, e.target.value as Permission)}
    >
      {(Object.keys(PERMISSION_LABEL) as Permission[]).map((p) => (
        <option key={p} value={p} disabled={p === 'always' && fallback !== 'always'}>
          {PERMISSION_LABEL[p]}
          {p === 'always' && fallback !== 'always' ? ' (locked by safety policy)' : ''}
        </option>
      ))}
    </select>
  );

  const googleReady = Boolean(env?.runtime.GOOGLE_CLIENT_ID && env?.runtime.GOOGLE_CLIENT_SECRET);
  let googleOrigin = '';
  try {
    googleOrigin = env?.redirectUri ? new URL(env.redirectUri).origin : '';
  } catch {
    googleOrigin = '';
  }
  const googleValues = googleOrigin
    ? [
        { label: 'Authorised redirect URI (Clients page)', value: env?.redirectUri ?? '' },
        { label: 'Authorised domain (Branding page)', value: googleOrigin.replace(/^https?:\/\//, '') },
        { label: 'Application home page (Branding page)', value: googleOrigin },
        { label: 'Privacy policy link (Branding page)', value: googleOrigin + '/privacy' },
        { label: 'Terms of Service link (Branding page)', value: googleOrigin + '/terms' },
      ]
    : [{ label: 'Authorised redirect URI (Clients page)', value: env?.redirectUri ?? '...' }];
  const googleHostMismatch = Boolean(googleOrigin) && typeof window !== 'undefined' && window.location.origin !== googleOrigin;

  return (
    <div className='fixed inset-0 z-50' role='dialog' aria-modal='true' aria-label='Connectors'>
      <div className='absolute inset-0 bg-black/60' onClick={onClose} />
      <aside className='glass-strong absolute right-0 top-0 flex h-full w-full max-w-xl flex-col'>
        <header className='flex items-center justify-between px-5 py-4' style={{ borderBottom: '1px solid var(--line)' }}>
          <div>
            <h2 className='text-lg font-semibold'>Connectors</h2>
            <p className='text-xs text-[color:var(--muted)]'>Connect tools the agent can use. Secrets are written to Vercel, never kept in the browser.</p>
          </div>
          <button type='button' onClick={onClose} className='ghost-btn rounded-lg p-2' aria-label='Close connectors'>
            <Icon name='x' size={16} />
          </button>
        </header>

        <div className='space-y-3 px-5 pt-4'>
          <div className='relative'>
            <span className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]'>
              <Icon name='search' size={15} />
            </span>
            <input className='field !pl-9' placeholder='Search by name or function (e.g. email, deploy, webhook)' value={query} onChange={(e) => setQuery(e.target.value)} aria-label='Search connectors' />
          </div>
          <div className='flex flex-wrap gap-2' role='tablist' aria-label='Categories'>
            {(['All', ...CATEGORIES] as (Category | 'All')[]).map((c) => (
              <button
                key={c}
                type='button'
                role='tab'
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={(category === c ? 'neon-btn' : 'ghost-btn') + ' rounded-full px-3.5 py-1.5 text-xs'}
              >
                {c}
              </button>
            ))}
          </div>
          {notice && (
            <div
              className='flex items-start gap-2 rounded-xl px-3 py-2 text-sm'
              style={{ background: notice.type === 'ok' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: '1px solid ' + (notice.type === 'ok' ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.4)') }}
              role='status'
            >
              <span className='flex-1'>{notice.text}</span>
              <button type='button' onClick={() => setNotice(null)} aria-label='Dismiss'>
                <Icon name='x' size={13} />
              </button>
            </div>
          )}
          {envError && <p className='text-xs text-amber-300'>{envError}</p>}
          {env && !env.canWrite && (
            <p className='rounded-xl px-3 py-2 text-xs text-amber-200' style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
              The app cannot save credentials yet: add VERCEL_TOKEN (and VERCEL_TEAM_ID for team projects) in Vercel once, then redeploy.
            </p>
          )}
        </div>

        <div className='scroll-thin mt-3 flex-1 space-y-3 overflow-y-auto px-5 pb-5'>
          {builtin.map((c) => {
            const state: ConnState = c.status === 'planned' ? 'planned' : stateFor(requiredEnv(c), env);
            return (
              <article key={c.id} className='glass rounded-2xl p-4'>
                <div className='flex items-start gap-3'>
                  <Brand name={c.name} accent={c.accent} />
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h3 className='text-sm font-semibold'>{c.name}</h3>
                      <span className='text-[11px] text-[color:var(--muted)]'>{c.category}</span>
                      <Badge state={state} />
                    </div>
                    <p className='mt-1 text-xs leading-relaxed text-[color:var(--muted)]'>{c.description}</p>
                    {c.tools.length > 0 && <p className='mt-1 text-[11px] text-[color:var(--muted)]'>Tools: {[...new Set(c.tools.map((t) => t.name))].join(', ')}</p>}
                  </div>
                </div>
                <div className='mt-3 flex flex-wrap items-center justify-end gap-2'>
                  {state === 'connected' && c.tools.length > 0 && permissionSelect(c.id, c.defaultPermission)}
                  {c.status === 'planned' ? (
                    <button type='button' disabled className='ghost-btn rounded-lg px-3.5 py-1.5 text-xs'>
                      Planned
                    </button>
                  ) : (
                    <button type='button' onClick={() => openConnect({ kind: 'builtin', def: c })} className={(state === 'disconnected' ? 'neon-btn' : 'ghost-btn') + ' rounded-lg px-3.5 py-1.5 text-xs'}>
                      {state === 'disconnected' ? 'Connect' : 'Update'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {customList.map(({ custom, required }) => {
            const state = stateFor(required, env);
            return (
              <article key={custom.id} className='glass rounded-2xl p-4'>
                <div className='flex items-start gap-3'>
                  <Brand name={custom.name} accent='#a3a3ff' />
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h3 className='text-sm font-semibold'>{custom.name}</h3>
                      <span className='text-[11px] text-[color:var(--muted)]'>{custom.category} / Custom</span>
                      <Badge state={state} />
                    </div>
                    <p className='mt-1 text-xs text-[color:var(--muted)]'>{custom.description}</p>
                  </div>
                </div>
                <div className='mt-3 flex flex-wrap items-center justify-end gap-2'>
                  {permissionSelect('custom:' + custom.id, 'ask')}
                  <button type='button' onClick={() => openConnect({ kind: 'custom', custom })} className='ghost-btn rounded-lg px-3.5 py-1.5 text-xs'>
                    Update
                  </button>
                  <button type='button' onClick={() => void removeCustom(custom)} className='ghost-btn rounded-lg p-1.5' aria-label={'Remove ' + custom.name}>
                    <Icon name='trash' size={13} />
                  </button>
                </div>
              </article>
            );
          })}

          {builtin.length === 0 && customList.length === 0 && <p className='py-8 text-center text-sm text-[color:var(--muted)]'>No connectors match your search.</p>}

          <button type='button' onClick={() => { setModalError(''); setCustomOpen(true); }} className='neon-btn flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm'>
            <Icon name='plus' size={15} />
            Add Custom Connector
          </button>

          <details className='glass rounded-2xl p-4 text-sm'>
            <summary className='cursor-pointer select-none text-xs font-medium'>Environment inspector (names only, values are never shown)</summary>
            <ul className='mt-3 space-y-1 text-xs'>
              {env ? (
                [...new Set([...Object.keys(env.runtime).filter((k) => env.runtime[k]), ...(env.vercelNames ?? [])])].sort().map((name) => {
                  const live = Boolean(env.runtime[name]);
                  return (
                    <li key={name} className='flex items-center justify-between gap-2'>
                      <code className='truncate'>{name}</code>
                      <span style={{ color: live ? '#6ee7b7' : '#fcd34d' }}>{live ? 'live' : 'pending redeploy'}</span>
                    </li>
                  );
                })
              ) : (
                <li className='text-[color:var(--muted)]'>Loading...</li>
              )}
            </ul>
            {env?.vercelError && <p className='mt-2 text-xs text-amber-300'>Vercel: {env.vercelError}</p>}
          </details>
        </div>
      </aside>

      {target?.kind === 'builtin' && (
        <Modal title={'Connect ' + target.def.name} onClose={() => setTarget(null)}>
          <div className='space-y-3'>
            {target.def.fields.map((f) => (
              <label key={f.env} className='block text-xs'>
                <span className='mb-1 flex items-center justify-between'>
                  <span className='font-medium'>
                    {f.label}
                    {f.optional ? ' (optional)' : ''}
                  </span>
                  {(env?.runtime[f.env] || env?.vercelNames?.includes(f.env)) && <span className='text-emerald-300'>already saved</span>}
                </span>
                <input
                  className='field'
                  type={f.secret ? 'password' : 'text'}
                  autoComplete='off'
                  spellCheck={false}
                  placeholder={f.placeholder}
                  value={values[f.env] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.env]: e.target.value })}
                />
                <span className='mt-1 block text-[11px] text-[color:var(--muted)]'>{f.help}</span>
              </label>
            ))}
            {target.def.method === 'oauth-google' && (
              <div className='rounded-xl p-3 text-xs' style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,0.03)' }}>
                <p className='mb-2 font-medium'>Authorize Google Drive</p>
                <p className='mb-2 text-[color:var(--muted)]'>
                  Paste these exact values into Google Cloud (Google Auth Platform), then authorize. Only the &quot;drive.file&quot; permission is requested.
                </p>
                {googleValues.map((row) => (
                  <div key={row.label} className='mb-2'>
                    <p className='mb-0.5 text-[11px] text-[color:var(--muted)]'>{row.label}</p>
                    <div className='flex items-center gap-2'>
                      <code className='flex-1 break-all rounded bg-black/40 px-2 py-1'>{row.value}</code>
                      <button type='button' className='ghost-btn rounded-lg p-1.5' onClick={() => copyText(row.value)} aria-label={'Copy ' + row.label}>
                        <Icon name='copy' size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {googleHostMismatch && (
                  <p className='mb-2 rounded-lg px-2 py-1.5 text-amber-200' style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
                    You are on {window.location.origin}, but Google will send you back to {googleOrigin}. Open the app at {googleOrigin}, sign in there, then press Authorize.
                  </p>
                )}
                <ol className='mb-3 list-decimal space-y-1 pl-4 text-[11px] text-[color:var(--muted)]'>
                  <li>Clients page: set the redirect URI above and remove any old one.</li>
                  <li>Branding page: set the authorised domain and the three links above, then Save.</li>
                  <li>Audience page: while the status is Testing, add your own Gmail under Test users.</li>
                </ol>
                <button type='button' disabled={busy || !googleReady} onClick={() => void startGoogle()} className='neon-btn w-full rounded-lg px-3 py-2 text-xs'>
                  {googleReady ? 'Authorize with Google' : 'Save the Client ID and Secret first, then wait for the redeploy'}
                </button>
              </div>
            )}
            <a href={target.def.docsUrl} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 text-[11px] text-[color:var(--neon-2)] underline'>
              Where do I find this? <Icon name='external' size={11} />
            </a>
            <label className='flex items-center gap-2 text-xs'>
              <input type='checkbox' checked={redeploy} onChange={(e) => setRedeploy(e.target.checked)} />
              Redeploy automatically so the change goes live
            </label>
            {modalError && <p className='text-xs text-red-300' role='alert'>{modalError}</p>}
            <div className='flex justify-end gap-2'>
              <button type='button' onClick={() => setTarget(null)} className='ghost-btn rounded-lg px-3.5 py-2 text-xs'>
                Cancel
              </button>
              <button type='button' disabled={busy || target.def.fields.length === 0 || !env?.canWrite} onClick={() => void submitBuiltin(target.def)} className='neon-btn rounded-lg px-4 py-2 text-xs'>
                {busy ? 'Saving...' : 'Save to Vercel'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {target?.kind === 'custom' && (
        <Modal title={'Update ' + target.custom.name} onClose={() => setTarget(null)}>
          <div className='space-y-3'>
            <label className='block text-xs'>
              <span className='mb-1 block font-medium'>New webhook / API URL</span>
              <input className='field' type='password' autoComplete='off' placeholder='https://...' value={values.url ?? ''} onChange={(e) => setValues({ ...values, url: e.target.value })} />
            </label>
            <label className='block text-xs'>
              <span className='mb-1 block font-medium'>New API key (optional)</span>
              <input className='field' type='password' autoComplete='off' value={values.key ?? ''} onChange={(e) => setValues({ ...values, key: e.target.value })} />
            </label>
            {modalError && <p className='text-xs text-red-300' role='alert'>{modalError}</p>}
            <div className='flex justify-end gap-2'>
              <button type='button' onClick={() => setTarget(null)} className='ghost-btn rounded-lg px-3.5 py-2 text-xs'>
                Cancel
              </button>
              <button type='button' disabled={busy || !env?.canWrite} onClick={() => void submitCustomUpdate(target.custom)} className='neon-btn rounded-lg px-4 py-2 text-xs'>
                {busy ? 'Saving...' : 'Save to Vercel'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {customOpen && (
        <Modal title='Add Custom Connector' onClose={() => setCustomOpen(false)}>
          <div className='space-y-3'>
            <label className='block text-xs'>
              <span className='mb-1 block font-medium'>Name</span>
              <input className='field' placeholder='e.g. Zapier lead alert' value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label className='block text-xs'>
              <span className='mb-1 block font-medium'>Category</span>
              <select className='field' value={newCategory} onChange={(e) => setNewCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className='block text-xs'>
              <span className='mb-1 block font-medium'>What does it do?</span>
              <input className='field' placeholder='Short description for the agent and for you' value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
            </label>
            <label className='block text-xs'>
              <span className='mb-1 block font-medium'>Webhook or API endpoint (https)</span>
              <input className='field' type='password' autoComplete='off' placeholder='https://hooks.example.com/abc' value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
            </label>
            <label className='block text-xs'>
              <span className='mb-1 block font-medium'>API key or token (optional)</span>
              <input className='field' type='password' autoComplete='off' placeholder='Sent as a Bearer token' value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            </label>
            <p className='text-[11px] text-[color:var(--muted)]'>The URL and key are saved to Vercel as sensitive variables. The agent must ask you before every call to a custom connector.</p>
            {modalError && <p className='text-xs text-red-300' role='alert'>{modalError}</p>}
            <div className='flex items-center justify-between gap-2'>
              <label className='flex items-center gap-2 text-xs'>
                <input type='checkbox' checked={redeploy} onChange={(e) => setRedeploy(e.target.checked)} />
                Redeploy now
              </label>
              <div className='flex gap-2'>
                <button type='button' onClick={() => setCustomOpen(false)} className='ghost-btn rounded-lg px-3.5 py-2 text-xs'>
                  Cancel
                </button>
                <button type='button' disabled={busy || !env?.canWrite} onClick={() => void submitNewCustom()} className='neon-btn rounded-lg px-4 py-2 text-xs'>
                  {busy ? 'Saving...' : 'Add connector'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
