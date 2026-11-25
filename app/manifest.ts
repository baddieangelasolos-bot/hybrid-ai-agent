import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Hybrid AI Agent',
    short_name: 'Hybrid AI',
    description: 'Your private multi-agent AI assistant',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#070a18',
    theme_color: '#0a0c11',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png?v=17', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png?v=17', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png?v=17', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/logo.svg?v=17', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'New chat', short_name: 'New chat', url: '/?new=1', icons: [{ src: '/icons/icon-192.png?v=17', sizes: '192x192', type: 'image/png' }] },
      { name: 'Model health', short_name: 'Health', url: '/health', icons: [{ src: '/icons/icon-192.png?v=17', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
