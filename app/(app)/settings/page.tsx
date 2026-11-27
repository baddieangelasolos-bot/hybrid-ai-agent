'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useApp, useChatActions } from '@/components/AppProviders';
import { PageScroll } from '@/components/AppShell';
import { Icon, type IconName } from '@/components/Icons';
import { StoragePill } from '@/components/StorageBanner';
import { AGENTS, AGENT_ORDER, type AgentId } from '@/lib/agents';
import { PERSONAS } from '@/lib/personas';
import { DEFAULT_PROFILE, type UserProfile } from '@/lib/profile';
import { CLIENT_COMMANDS, SKILLS } from '@/lib/skills';
import type { AccentPref, Settings, ThemePref } from '@/lib/settings';
import type { Persona } from '@/lib/types';

const ACCENTS: { id: AccentPref; color: string }[] = [
  { id: 'indigo', color: '#5b7bff' },
  { id: 'violet', color: '#8b6cff' },
  { id: 'teal', color: '#14b8a6' },
  { id: 'rose', color: '#f0558a' },
  { id: 'amber', color: '#e8970f' },
  { id: 'red', color: '#ef4444' },
];

const LANGS: [string, string][] = [
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['bn-BD', 'Bangla (Bangladesh)'], ['bn-IN', 'Bangla (India)'], ['hi-IN', 'Hindi'], ['ur-PK', 'Urdu'],
  ['ar-SA', 'Arabic'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'], ['pt-BR', 'Portuguese (Brazil)'], ['ru-RU', 'Russian'],
  ['tr-TR', 'Turkish'], ['id-ID', 'Indonesian'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese (Mandarin)'],
];

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className='mb-6 scroll-mt-20'>
      <h2 className='mb-2 px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]'>{title}</h2>
      <div className='card divide-y divide-[color:var(--line)]'>{children}</div>
    </section>
  );
}

function Row({ icon, label, hint, children, stack }: { icon?: IconName; label: string; hint?: string; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={'p-3.5 ' + (stack ? '' : 'flex items-center justify-between gap-3')}>
      <div className='flex min-w-0 items-center gap-3'>
        {icon && <span className='grid h-9 w-9 flex-none place-items-center rounded-xl' style={{ background: 'var(--surface-2)' }}><Icon name={icon} size={17} /></span>}
        <div className='min-w-0'>
          <div className='text-[15px] font-medium'>{label}</div>
          {hint && <div className='text-xs leading-snug text-[color:var(--muted)]'>{hint}</div>}
        </div>
      </div>
      {children && <div className={stack ? 'mt-3' : 'flex-none'}>{children}</div>}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role='switch' aria-checked={on} aria-label={label} className='switch' onClick={() => onChange(!on)} />;
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; icon?: IconName }[]; onChange: (v: T) => void }) {
  return (
    <div className='flex rounded-xl p-1' style={{ background: 'var(--surface-2)' }}>
      {options.map((o) => (
        <button
          key={o.id}
          className='flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition'
          style={value === o.id ? { background: 'var(--surface)', boxShadow: '0 1px 3px rgba(0,0,0,.25)', color: 'var(--ink)' } : { color: 'var(--muted)' }}
          onClick={() => onChange(o.id)}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Text field that keeps its own draft and saves when you leave it, so typing never re-renders the whole app. */
function TextField({ label, value, onCommit, placeholder, multiline }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const common = { className: 'field', value: v, placeholder, onBlur: () => v !== value && onCommit(v.trim()), 'aria-label': label };
  return (
    <label className='block p-3.5'>
      <span className='mb-1.5 block text-[13px] font-medium text-[color:var(--muted)]'>{label}</span>
      {multiline ? <textarea rows={3} {...common} onChange={(e) => setV(e.target.value)} /> : <input type='text' {...common} onChange={(e) => setV(e.target.value)} />}
    </label>
  );
}

function FactRow({ id, fact, onSave, onDelete }: { id: string; fact: string; onSave: (id: string, t: string) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(fact);
  if (editing) {
    return (
      <div className='card-flat flex items-center gap-2 px-2 py-2'>
        <input className='field !py-2' value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && (onSave(id, v), setEditing(false))} aria-label='Edit memory' />
        <button className='neon-btn flex-none rounded-lg px-3 py-2 text-sm' disabled={!v.trim()} onClick={() => { onSave(id, v); setEditing(false); }}>Save</button>
        <button className='icon-btn !h-9 !w-9 flex-none' aria-label='Cancel' onClick={() => { setV(fact); setEditing(false); }}><Icon name='x' size={15} /></button>
      </div>
    );
  }
  return (
    <div className='card-flat flex items-center justify-between gap-2 px-3 py-2 text-sm'>
      <span className='min-w-0 break-words'>{fact}</span>
      <span className='flex flex-none'>
        <button className='icon-btn !h-8 !w-8' aria-label='Edit' onClick={() => { setV(fact); setEditing(true); }}><Icon name='pen' size={15} /></button>
        <button className='icon-btn !h-8 !w-8' aria-label='Forget' onClick={() => onDelete(id)}><Icon name='trash' size={15} /></button>
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, setSetting, resetSettings, openConnectors, facts, removeFact, addFactManual, editFact, profile, setProfile, resetProfile, logout, notify } = useApp();
  const actions = useChatActions();
  const [installable, setInstallable] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [newFact, setNewFact] = useState('');
  const s = settings;
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => setSetting(k, v);

  useEffect(() => {
    if (window.location.hash === '#profile') window.setTimeout(() => document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }, []);

  useEffect(() => {
    setStandalone(matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    const on = () => setInstallable(Boolean(window.__hyaInstall));
    on();
    window.addEventListener('hya:installable', on);
    return () => window.removeEventListener('hya:installable', on);
  }, []);

  const setP = (patch: Partial<UserProfile>) => setProfile({ ...profile, ...patch });
  const setStyle = (patch: Partial<UserProfile['style']>) => setProfile({ ...profile, style: { ...profile.style, ...patch } });

  async function install() {
    const ev = window.__hyaInstall;
    if (!ev) return;
    await ev.prompt();
    const choice = await ev.userChoice;
    window.__hyaInstall = null;
    setInstallable(false);
    if (choice.outcome === 'accepted') notify('Installed. Open Hybrid AI from your home screen.');
  }

  async function exportChats() {
    const data = await actions.exportAll();
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hybrid-ai-export-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PageScroll title='Settings' subtitle='Make the app yours'>
      <Section title='Appearance'>
        <Row label='Theme' icon={s.theme === 'light' ? 'sun' : 'moon'} stack>
          <Seg<ThemePref> value={s.theme} onChange={set('theme')} options={[{ id: 'system', label: 'System', icon: 'phone' }, { id: 'dark', label: 'Dark', icon: 'moon' }, { id: 'light', label: 'Light', icon: 'sun' }]} />
        </Row>
        <Row label='Accent color' stack>
          <div className='flex gap-3'>
            {ACCENTS.map((a) => (
              <button key={a.id} aria-label={a.id} className='grid h-9 w-9 place-items-center rounded-full transition active:scale-90' style={{ background: a.color, outline: s.accent === a.id ? '2px solid var(--ink)' : 'none', outlineOffset: 2 }} onClick={() => set('accent')(a.id)}>
                {s.accent === a.id && <span className='text-white'><Icon name='check' size={16} /></span>}
              </button>
            ))}
          </div>
        </Row>
        <Row label='Text size' stack>
          <Seg value={s.fontScale} onChange={set('fontScale')} options={[{ id: 'sm', label: 'Small' }, { id: 'md', label: 'Medium' }, { id: 'lg', label: 'Large' }]} />
        </Row>
        <Row label='Reduce motion' hint='Turns off animations'><Toggle on={s.reduceMotion} onChange={set('reduceMotion')} label='Reduce motion' /></Row>
      </Section>

      <Section title='Agents and chat'>
        <Row label='Default agent' hint={AGENTS[s.agent].tagline} stack>
          <select className='field' value={s.agent} onChange={(e) => set('agent')(e.target.value as AgentId)}>
            {AGENT_ORDER.map((id) => <option key={id} value={id}>{AGENTS[id].name}</option>)}
          </select>
        </Row>
        <Row label='Response style' hint={PERSONAS[s.persona].label} stack>
          <select className='field' value={s.persona} onChange={(e) => set('persona')(e.target.value as Persona)}>
            {(Object.keys(PERSONAS) as Persona[]).map((p) => <option key={p} value={p}>{PERSONAS[p].label}</option>)}
          </select>
        </Row>
        <Row label='Show agent and model' hint='Label under each reply showing who answered'><Toggle on={s.showRoute} onChange={set('showRoute')} label='Show route' /></Row>
        <Row label='Show tool activity' hint='GitHub, web and other tool steps'><Toggle on={s.showTrace} onChange={set('showTrace')} label='Show trace' /></Row>
        <Row label='Enter sends message' hint='Off: Enter adds a new line (better on phones)'><Toggle on={s.sendOnEnter} onChange={set('sendOnEnter')} label='Enter sends' /></Row>
        <Row label='Haptic feedback' hint='Small vibrations on tap'><Toggle on={s.haptics} onChange={set('haptics')} label='Haptics' /></Row>
      </Section>

      <Section title='Voice'>
        <Row label='Voice typing engine' hint={s.voiceEngine === 'browser' ? 'Instant and free. Uses your phone speech recognition.' : 'More accurate for Bangla and noisy rooms. Uses Groq Whisper (free quota).'} stack>
          <Seg value={s.voiceEngine} onChange={set('voiceEngine')} options={[{ id: 'browser', label: 'Browser' }, { id: 'whisper', label: 'Whisper (Groq)' }]} />
        </Row>
        <Row label='Voice language' stack>
          <select className='field' value={s.voiceLang} onChange={(e) => set('voiceLang')(e.target.value)}>
            {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </Row>
        <Row label='Read replies aloud' hint='Speaks each answer when it finishes'><Toggle on={s.autoSpeak} onChange={set('autoSpeak')} label='Auto speak' /></Row>
      </Section>

      <Section title='Your profile' id='profile'>
        <div className='p-3.5 text-[13px] leading-snug text-[color:var(--muted)]'>The Lead Orchestrator and every agent read this, so answers fit you (for example Bangladesh HSC, not another country). It is saved on this device and in Drive when connected. Not used in incognito chats.</div>
        <TextField label='Name' value={profile.name} placeholder='What should I call you?' onCommit={(v) => setP({ name: v })} />
        <TextField label='Location' value={profile.location} onCommit={(v) => setP({ location: v })} />
        <TextField label='Study track / curriculum' value={profile.track} onCommit={(v) => setP({ track: v })} />
        <TextField label='Preferred language' value={profile.language} onCommit={(v) => setP({ language: v })} />
        <TextField label='About you' value={profile.about} multiline placeholder='Subjects, goals, exam date, anything useful' onCommit={(v) => setP({ about: v })} />
        <Row label='Answer format' stack>
          <Seg value={profile.style.format} onChange={(v) => setStyle({ format: v })} options={[{ id: 'auto', label: 'Auto' }, { id: 'bullets', label: 'Bullets' }, { id: 'paragraphs', label: 'Text' }, { id: 'tables', label: 'Tables' }]} />
        </Row>
        <Row label='Answer length' stack>
          <Seg value={profile.style.detail} onChange={(v) => setStyle({ detail: v })} options={[{ id: 'auto', label: 'Auto' }, { id: 'concise', label: 'Short' }, { id: 'detailed', label: 'Detailed' }]} />
        </Row>
        <Row label='Tone' stack>
          <Seg value={profile.style.tone} onChange={(v) => setStyle({ tone: v })} options={[{ id: 'auto', label: 'Auto' }, { id: 'friendly', label: 'Friendly' }, { id: 'formal', label: 'Formal' }]} />
        </Row>
        <div className='p-3.5'>
          <div className='mb-2 text-[13px] text-[color:var(--muted)]'>{profile.learned.length ? 'Learned from your chats' : 'Nothing learned yet. Say things like "keep answers short" or "explain in Bangla" and I will note it.'}</div>
          <div className='flex flex-col gap-1.5'>
            {profile.learned.map((l) => (
              <div key={l} className='card-flat flex items-center justify-between gap-2 px-3 py-2 text-sm'>
                <span className='min-w-0 break-words'>{l}</span>
                <button className='icon-btn !h-8 !w-8 flex-none' aria-label='Forget this' onClick={() => setP({ learned: profile.learned.filter((x) => x !== l) })}><Icon name='trash' size={15} /></button>
              </div>
            ))}
          </div>
        </div>
        <Row icon='refresh' label='Reset profile' hint={'Back to ' + DEFAULT_PROFILE.location + ' and HSC defaults, clears learned items'}>
          <button className='ghost-btn rounded-xl px-3.5 py-2 text-sm' onClick={() => { resetProfile(); notify('Profile reset.'); }}>Reset</button>
        </Row>
      </Section>

      <Section title='Privacy and memory'>
        <Row icon='ghost' label='Start in incognito' hint='New chats are private and not saved'><Toggle on={s.incognitoDefault} onChange={set('incognitoDefault')} label='Incognito default' /></Row>
        <Row icon='brain' label='Memory' hint='Let the assistant remember durable facts about you'><Toggle on={s.memoryEnabled} onChange={set('memoryEnabled')} label='Memory' /></Row>
        <div className='p-3.5'>
          <div className='mb-1 text-[13px] text-[color:var(--muted)]'>{facts.length ? facts.length + ' saved fact' + (facts.length === 1 ? '' : 's') : 'No saved facts yet. Add one below or say "remember that I prefer short answers" in a chat.'}</div>
          <div className='mb-3 text-[11px] leading-snug text-[color:var(--muted)]'>Saved on this device, and in your Drive folder (memory/facts) when Drive is connected. This list is the only memory store: there is no separate whiteboard or highlighter list.</div>
          <div className='mb-3 flex gap-2'>
            <input className='field !py-2' value={newFact} placeholder='Add a fact to remember' onChange={(e) => setNewFact(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newFact.trim()) { void addFactManual(newFact); setNewFact(''); } }} aria-label='New memory' />
            <button className='neon-btn flex-none rounded-xl px-4 py-2 text-sm' disabled={!newFact.trim()} onClick={() => { void addFactManual(newFact); setNewFact(''); }}>Add</button>
          </div>
          <div className='flex flex-col gap-1.5'>
            {facts.map((f) => <FactRow key={f.id + f.ts} id={f.id} fact={f.fact} onSave={(id, t) => void editFact(id, t)} onDelete={(id) => void removeFact(id)} />)}
          </div>
        </div>
        <Row label='Storage' hint='Where chats, memory and profile are kept right now'><StoragePill /></Row>
      </Section>

      <Section title='Commands and help'>
        <div className='p-3.5 text-[13px] leading-snug text-[color:var(--muted)]'>Type <code>/</code> in the message box to see every command. You can also just say it in plain words:</div>
        <div className='flex flex-col gap-1.5 p-3.5 pt-0 text-sm'>
          {['switch to the last chat', 'open chat about photosynthesis', 'make Gemini 4 Hydrogen the primary lead orchestrator', 'remember that I study HSC science'].map((x) => <div key={x} className='card-flat px-3 py-2'>&ldquo;{x}&rdquo;</div>)}
        </div>
        <div className='p-3.5'>
          <div className='mb-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]'>Slash commands</div>
          <div className='flex flex-col gap-2'>
            {[...SKILLS.map((k) => ({ command: k.command, hint: k.hint })), ...CLIENT_COMMANDS].map((c) => (
              <div key={c.command} className='flex items-baseline gap-3 text-sm'>
                <code className='flex-none' style={{ color: 'var(--accent)' }}>{c.command}</code>
                <span className='text-xs text-[color:var(--muted)]'>{c.hint}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title='Connections'>
        <Row icon='plug' label='Connectors and API keys' hint='Gemini, Groq, image generators, GitHub, Vercel, Drive, automations'>
          <button className='ghost-btn rounded-xl px-3.5 py-2 text-sm' onClick={() => openConnectors()}>Manage</button>
        </Row>
        <Row icon='cloud' label='Storage sync' hint='Chats and settings sync to your Google Drive when connected'><StoragePill /></Row>
      </Section>

      <Section title='App'>
        <Row icon='phone' label='Install on your phone' hint={standalone ? 'Running as an installed app.' : installable ? 'Adds Hybrid AI to your home screen as a full-screen app.' : 'Chrome menu (three dots) > Add to Home screen / Install app. On iPhone: Share > Add to Home Screen.'}>
          {!standalone && installable && <button className='neon-btn rounded-xl px-4 py-2 text-sm' onClick={() => void install()}>Install</button>}
        </Row>
        <Row icon='info' label='Version' hint='Hybrid AI Agent 17 · multi-agent, failover, PWA'>
          <span className='chip'>v17</span>
        </Row>
      </Section>

      <Section title='Your data'>
        <Row icon='download' label='Export all chats' hint='Downloads chats and memory as a JSON file'>
          <button className='ghost-btn rounded-xl px-3.5 py-2 text-sm' onClick={() => void exportChats()}>Export</button>
        </Row>
        <Row icon='trash' label='Delete all chats' hint='Removes every saved chat from this device and Drive'>
          <button
            className='rounded-xl px-3.5 py-2 text-sm font-medium'
            style={confirmWipe ? { background: 'var(--bad)', color: '#fff' } : { border: '1px solid var(--line)', color: 'var(--bad)' }}
            onClick={() => {
              if (confirmWipe) {
                setConfirmWipe(false);
                void actions.deleteAllThreads().then(() => notify('All chats deleted.'));
              } else {
                setConfirmWipe(true);
                setTimeout(() => setConfirmWipe(false), 3500);
              }
            }}
          >
            {confirmWipe ? 'Tap to confirm' : 'Delete'}
          </button>
        </Row>
        <Row icon='settings' label='Reset settings' hint='Back to defaults (chats are kept)'>
          <button className='ghost-btn rounded-xl px-3.5 py-2 text-sm' onClick={resetSettings}>Reset</button>
        </Row>
        <Row icon='lock' label='Sign out' hint='Ends this session on this device'>
          <button className='ghost-btn rounded-xl px-3.5 py-2 text-sm' onClick={() => void logout()}>Sign out</button>
        </Row>
      </Section>
    </PageScroll>
  );
}
