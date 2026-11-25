'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ApprovalModal from './ApprovalModal';
import { useApp } from './AppProviders';
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
