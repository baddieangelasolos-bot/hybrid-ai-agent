'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ApprovalModal from './ApprovalModal';
import { useApp, useChatActions, useChatMeta } from './AppProviders';
import { Icon, type IconName } from './Icons';
import Logo from './Logo';
import StorageBanner from './StorageBanner';

const PAGES: { href: string; label: string; hint: string; icon: IconName }[] = [
  { href: '/', label: 'Chat', hint: 'Talk to your agents', icon: 'chat' },
  { href: '/history', label: 'History', hint: 'Saved chats and branches', icon: 'history' },
  { href: '/agents', label: 'Agents', hint: 'Models and fallback order', icon: 'bot' },
  { href: '/health', label: 'Health', hint: 'Which models are ready', icon: 'activity' },
  { href: '/settings', label: 'Settings', hint: 'Profile, memory, connectors', icon: 'settings' },
];

const NavContext = createContext<{ open: () => void }>({ open: () => undefined });

/** Hamburger at the left of every header. Opens the navigation drawer. */
export function NavButton() {
  const { open } = useContext(NavContext);
  return (
    <button className='icon-btn flex-none' aria-label='Open menu' onClick={open}>
      <Icon name='menu' size={22} />
    </button>
  );
}

const MENU_W = 176;
const MENU_H = 150;

/** Recent chats like the Claude app: plain titles, a pencil per chat, "See all...". */
function ChatList({ onNavigate }: { onNavigate: () => void }) {
  const { threads, threadId } = useChatMeta();
  const actions = useChatActions();
  const router = useRouter();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; confirm: boolean } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const sorted = useMemo(() => [...threads].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt), [threads]);
  const shown = sorted.slice(0, 7);
  const target = menu ? threads.find((t) => t.id === menu.id) : undefined;

  async function open(id: string) {
    await actions.openThread(id);
    router.push('/');
    onNavigate();
  }

  function openMenu(id: string, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8);
    const below = r.bottom + 4;
    const y = below + MENU_H > window.innerHeight ? Math.max(8, r.top - MENU_H - 4) : below;
    setMenu({ id, x, y, confirm: false });
  }

  function commitRename(id: string) {
    const v = draft.trim();
    setRenaming(null);
    if (v) void actions.renameThread(id, v);
  }

  const itemCls = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] transition hover:bg-white/5';

  return (
    <div className='mt-3 px-2'>
      <div className='mb-1 px-2 text-[15px] font-semibold'>Chats</div>
      {shown.length === 0 && <p className='px-2 py-3 text-sm text-[color:var(--muted)]'>No saved chats yet. Start talking and they will appear here.</p>}
      {shown.map((t) => {
        const active = t.id === threadId;
        return (
          <div key={t.id} className='group flex items-center gap-1 rounded-xl' style={active ? { background: 'color-mix(in srgb, var(--accent) 14%, transparent)' } : undefined}>
            {renaming === t.id ? (
              <div className='flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5'>
                <input
                  autoFocus
                  className='field !py-1.5 text-[15px]'
                  value={draft}
                  maxLength={60}
                  aria-label='Chat name'
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(t.id);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
                <button className='icon-btn !h-8 !w-8 flex-none' aria-label='Save name' onClick={() => commitRename(t.id)}>
                  <Icon name='check' size={16} />
                </button>
                <button className='icon-btn !h-8 !w-8 flex-none' aria-label='Cancel rename' onClick={() => setRenaming(null)}>
                  <Icon name='x' size={16} />
                </button>
              </div>
            ) : (
              <>
                <button className='flex min-w-0 flex-1 items-center gap-2 px-2 py-3 text-left' onClick={() => void open(t.id)} aria-current={active ? 'true' : undefined}>
                  {t.pinned && (
                    <span className='flex-none text-[color:var(--muted)]'>
                      <Icon name='pin' size={12} />
                    </span>
                  )}
                  <span className='truncate text-[16px] leading-snug' style={{ color: active ? 'var(--ink)' : 'color-mix(in srgb, var(--ink) 88%, transparent)' }}>
                    {t.title}
                  </span>
                </button>
                <button className='icon-btn !h-8 !w-8 flex-none' aria-label={'Options for ' + t.title} aria-haspopup='menu' onClick={(e) => openMenu(t.id, e.currentTarget)}>
                  <Icon name='edit' size={15} />
                </button>
              </>
            )}
          </div>
        );
      })}
      <Link href='/history' prefetch onClick={onNavigate} className='block px-2 py-3 text-[15px] text-[color:var(--muted)]'>
        See all...
      </Link>

      {menu &&
        target &&
        createPortal(
          <div className='fixed inset-0 z-[68]' onClick={() => setMenu(null)}>
            <div className='glass-strong pop-in absolute rounded-2xl p-1.5' role='menu' style={{ left: menu.x, top: menu.y, width: MENU_W, boxShadow: 'var(--shadow)' }} onClick={(e) => e.stopPropagation()}>
              {menu.confirm ? (
                <div className='p-2'>
                  <p className='mb-2 text-[13px]'>Delete this chat for good?</p>
                  <div className='flex gap-2'>
                    <button className='ghost-btn flex-1 rounded-lg py-2 text-[13px]' onClick={() => setMenu(null)}>
                      Cancel
                    </button>
                    <button
                      className='flex-1 rounded-lg py-2 text-[13px] font-medium'
                      style={{ background: 'color-mix(in srgb, var(--bad) 22%, transparent)', color: 'var(--bad)' }}
                      onClick={() => {
                        void actions.deleteThread(menu.id);
                        setMenu(null);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    role='menuitem'
                    className={itemCls}
                    onClick={() => {
                      setDraft(target.title);
                      setRenaming(menu.id);
                      setMenu(null);
                    }}
                  >
                    <Icon name='pen' size={16} /> Rename
                  </button>
                  <button
                    role='menuitem'
                    className={itemCls}
                    onClick={() => {
                      void actions.pinThread(menu.id);
                      setMenu(null);
                    }}
                  >
                    <Icon name='pin' size={16} /> {target.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button role='menuitem' className={itemCls} style={{ color: 'var(--bad)' }} onClick={() => setMenu({ ...menu, confirm: true })}>
                    <Icon name='trash' size={16} /> Delete chat
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function NavDrawer({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { settings, openConnectors } = useApp();

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  return createPortal(
    <div className='fixed inset-0 z-[65]' role='dialog' aria-modal='true' aria-label='Main menu'>
      <div className='backdrop-in absolute inset-0 bg-black/55' onClick={onClose} />
      <nav className='drawer-in glass-strong absolute inset-y-0 left-0 flex w-[84%] max-w-[320px] flex-col' style={{ borderRadius: '0 24px 24px 0', boxShadow: 'var(--shadow)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className='flex items-center gap-3 px-5 pb-3 pt-5'>
          <Logo size={44} />
          <div className='min-w-0'>
            <div className='truncate text-[17px] font-semibold leading-tight'>Hybrid AI</div>
            <div className='truncate text-xs text-[color:var(--muted)]'>Your private agent team</div>
          </div>
        </div>
        <div className='scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-2'>
          {PAGES.map((t) => {
            const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                prefetch
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  if (settings.haptics) navigator.vibrate?.(6);
                  onClose();
                }}
                className='mb-1 flex items-center gap-3 rounded-2xl px-3 py-3 transition active:scale-[0.99]'
                style={active ? { background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--ink)' } : { color: 'var(--ink)' }}
              >
                <span className='grid h-10 w-10 flex-none place-items-center rounded-xl' style={active ? { background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)' }}>
                  <Icon name={t.icon} size={19} />
                </span>
                <span className='min-w-0'>
                  <span className='block text-[15px] font-medium'>{t.label}</span>
                  <span className='block truncate text-xs text-[color:var(--muted)]'>{t.hint}</span>
                </span>
              </Link>
            );
          })}
          <ChatList onNavigate={onClose} />
        </div>
        <div className='px-3 pb-4'>
          <button
            className='ghost-btn flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left'
            onClick={() => {
              onClose();
              openConnectors();
            }}
          >
            <span className='grid h-10 w-10 flex-none place-items-center rounded-xl' style={{ background: 'var(--surface-2)' }}><Icon name='plug' size={19} /></span>
            <span className='text-[15px] font-medium'>Connectors</span>
          </button>
          <p className='mt-3 text-center text-[11px] text-[color:var(--muted)]'>Hybrid AI Agent v17</p>
        </div>
      </nav>
    </div>,
    document.body,
  );
}

/** Top-left drawer navigation on every screen size (the old bottom tab bar is gone). */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { openConnectors } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const ctx = useMemo(() => ({ open: () => setNavOpen(true) }), []);

  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <NavContext.Provider value={ctx}>
      <div className='app-frame'>
        <StorageBanner onOpenConnectors={() => openConnectors()} />
        <main className='min-h-0 flex-1 overflow-hidden'>{children}</main>
      </div>
      {navOpen && <NavDrawer onClose={() => setNavOpen(false)} />}
      <ApprovalModal />
    </NavContext.Provider>
  );
}

export function PageScroll({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className='scroll-thin h-full overflow-y-auto overscroll-contain'>
      <div className='mx-auto w-full max-w-3xl px-4 pb-10'>
        <header className='safe-top sticky top-0 z-10 -mx-4 mb-2 px-4 pb-3 pt-3' style={{ background: 'linear-gradient(var(--bg) 70%, transparent)' }}>
          <div className='flex items-center gap-2'>
            <NavButton />
            <div className='min-w-0 flex-1'>
              <h1 className='truncate text-[21px] font-semibold leading-tight tracking-tight'>{title}</h1>
              {subtitle && <p className='truncate text-[13px] text-[color:var(--muted)]'>{subtitle}</p>}
            </div>
            {actions && <div className='flex flex-none items-center gap-1'>{actions}</div>}
          </div>
        </header>
        <div className='fade-up'>{children}</div>
      </div>
    </div>
  );
}
