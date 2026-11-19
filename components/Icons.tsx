import type { ReactNode } from 'react';

export type IconName =
  | 'search' | 'x' | 'check' | 'plus' | 'send' | 'trash' | 'copy' | 'down' | 'right' | 'cloud' | 'cloud-off'
  | 'refresh' | 'plug' | 'key' | 'external' | 'clip' | 'spark' | 'terminal' | 'lock' | 'menu' | 'play' | 'code' | 'alert';

const PATHS: Record<IconName, ReactNode> = {
  search: (<><circle cx='11' cy='11' r='7' /><path d='M21 21l-4.3-4.3' /></>),
  x: <path d='M18 6L6 18M6 6l12 12' />,
  check: <path d='M20 6L9 17l-5-5' />,
  plus: <path d='M12 5v14M5 12h14' />,
  send: (<><path d='M22 2L11 13' /><path d='M22 2l-7 20-4-9-9-4 20-7z' /></>),
  trash: (<><path d='M3 6h18' /><path d='M8 6V4h8v2' /><path d='M19 6l-1 14H6L5 6' /></>),
  copy: (<><rect x='9' y='9' width='13' height='13' rx='2' /><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' /></>),
  down: <path d='M6 9l6 6 6-6' />,
  right: <path d='M9 18l6-6-6-6' />,
  cloud: <path d='M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z' />,
  'cloud-off': (<><path d='M22.6 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3' /><path d='M1 1l22 22' /></>),
  refresh: (<><path d='M23 4v6h-6' /><path d='M1 20v-6h6' /><path d='M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15' /></>),
  plug: (<><path d='M9 2v6M15 2v6' /><path d='M6 8h12v4a6 6 0 0 1-12 0V8z' /><path d='M12 18v4' /></>),
  key: (<><circle cx='7.5' cy='15.5' r='4.5' /><path d='M10.7 12.3L21 2M16 7l3 3' /></>),
  external: (<><path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' /><path d='M15 3h6v6M10 14L21 3' /></>),
  clip: <path d='M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' />,
  spark: <path d='M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z' />,
  terminal: <path d='M4 17l6-6-6-6M12 19h8' />,
  lock: (<><rect x='3' y='11' width='18' height='11' rx='2' /><path d='M7 11V7a5 5 0 0 1 10 0v4' /></>),
  menu: <path d='M3 6h18M3 12h18M3 18h18' />,
  play: <path d='M5 3l14 9-14 9V3z' />,
  code: <path d='M16 18l6-6-6-6M8 6l-6 6 6 6' />,
  alert: (<><path d='M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' /><path d='M12 9v4M12 17h.01' /></>),
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      className={className}
      aria-hidden='true'
    >
      {PATHS[name]}
    </svg>
  );
}
