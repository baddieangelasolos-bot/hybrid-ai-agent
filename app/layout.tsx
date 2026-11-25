import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import PwaRegister from '@/components/PwaRegister';
import './globals.css';
import './perf.css';

export const metadata: Metadata = {
  title: 'Hybrid AI Agent',
  description: 'Your private multi-agent AI assistant',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  applicationName: 'Hybrid AI Agent',
  appleWebApp: { capable: true, title: 'Hybrid AI', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icons/logo.svg?v=17', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png?v=17', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png?v=17',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0a0c11',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

/** Runs before first paint so the saved theme never flashes. */
const BOOT = `(function(){try{var s=JSON.parse(localStorage.getItem('hya:settings')||'{}');var t=s.theme||'dark';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var d=document.documentElement;d.dataset.theme=t;d.dataset.accent=s.accent||'indigo';d.dataset.font=s.fontScale||'md';if(s.reduceMotion)d.dataset.motion='off';var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',t==='dark'?'#0a0c11':'#f2f4f9');}catch(e){document.documentElement.dataset.theme='dark'}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' data-theme='dark' suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
