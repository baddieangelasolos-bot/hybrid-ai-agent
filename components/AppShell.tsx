'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from './AppProviders';
import { Icon, type IconName } from './Icons';
import StorageBanner from './StorageBanner';

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Chat', icon: 'chat' },
  { href: '/history', label: 'History', icon: 'history' },
  { href: '/agents', label: 'Agents', icon: 'bot' },
  { href: '/health', label: 'Health', icon: 'activity' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

/** Bottom tab bar on phones, side rail on wide screens. Hides while the keyboard is open. */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { openConnectors, settings } = useApp();
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['file', 'checkbox', 'radio', 'range'].includes((t as HTMLInputElement).type)));
    const on = (e: FocusEvent) => isField(e.target) && setTyping(true);
    // Delay so tapping a button next to the text box never moves the layout mid-tap.
    const off = () => window.setTimeout(() => !isField(document.activeElement) && setTyping(false), 250);
    document.addEventListener('focusin', on);
    document.addEventListener('focusout', off);
    return () => {
      document.removeEventListener('focusin', on);
      document.removeEventListener('focusout', off);
    };
  }, []);

  return (
    <div className='app-frame md:flex-row-reverse'>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <StorageBanner onOpenConnectors={() => openConnectors()} />
        <main className='min-h-0 flex-1 overflow-hidden'>{children}</main>
      </div>
      <nav className={'tabbar flex flex-none md:w-[84px] md:flex-col md:justify-start md:gap-1 md:border-r md:border-t-0 md:pt-6 ' + (typing ? 'max-md:hidden' : '')} aria-label='Main'>
        {TABS.map((t) => {
          const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className='tab' aria-current={active ? 'page' : undefined} prefetch onClick={() => settings.haptics && navigator.vibrate?.(6)}>
              <span className='ico'><Icon name={t.icon} size={21} /></span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageScroll({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className='scroll-thin h-full overflow-y-auto overscroll-contain'>
      <div className='mx-auto w-full max-w-3xl px-4 pb-10'>
        <header className='safe-top sticky top-0 z-10 -mx-4 mb-2 px-4 pb-3 pt-4' style={{ background: 'linear-gradient(var(--bg) 70%, transparent)' }}>
          <div className='flex items-center justify-between gap-3'>
            <div className='min-w-0'>
              <h1 className='truncate text-[22px] font-semibold tracking-tight'>{title}</h1>
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
