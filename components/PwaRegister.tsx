'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    __hyaInstall?: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null;
  }
}

/** Registers the service worker (installable app) and keeps the Android install prompt for Settings. */
export default function PwaRegister() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__hyaInstall = e as unknown as NonNullable<Window['__hyaInstall']>;
      window.dispatchEvent(new Event('hya:installable'));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      const onLoad = () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
      if (document.readyState === 'complete') onLoad();
      else window.addEventListener('load', onLoad, { once: true });
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  return null;
}
