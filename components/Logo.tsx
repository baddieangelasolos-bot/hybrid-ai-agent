'use client';

import { useId } from 'react';
import { logoSvg } from '@/lib/logo';

/** The app emblem. Rendered from the same SVG as the favicon, so every place looks identical. */
export default function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  const uid = 'l' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return <span className={'inline-block flex-none ' + className} style={{ width: size, height: size, borderRadius: size * 0.22, boxShadow: '0 8px 24px color-mix(in srgb, var(--accent) 35%, transparent)' }} aria-hidden='true' dangerouslySetInnerHTML={{ __html: logoSvg(uid) }} />;
}
