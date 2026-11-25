import type { ReactNode } from 'react';

export type IconName =
  | 'search' | 'x' | 'check' | 'plus' | 'send' | 'trash' | 'copy' | 'down' | 'right' | 'cloud' | 'cloud-off'
  | 'refresh' | 'plug' | 'key' | 'external' | 'clip' | 'spark' | 'terminal' | 'lock' | 'menu' | 'play' | 'code' | 'alert'
  | 'brain' | 'pen' | 'eye' | 'book' | 'image' | 'bolt' | 'ghost' | 'mic' | 'mic-off' | 'more' | 'edit' | 'branch' | 'speaker' | 'sun' | 'moon' | 'settings' | 'activity' | 'history' | 'chat' | 'user' | 'download' | 'file' | 'stop' | 'shield' | 'info' | 'pin' | 'globe' | 'phone' | 'bot' | 'upload' | 'arrow-up' | 'left' | 'reply' | 'up';

const PATHS: Record<IconName, ReactNode> = {
  search: (<><circle cx='11' cy='11' r='7' /><path d='M21 21l-4.3-4.3' /></>),
  x: <path d='M18 6L6 18M6 6l12 12' />,
  reply: (<><path d='M9 14L4 9l5-5' /><path d='M20 20v-7a4 4 0 0 0-4-4H4' /></>),
  up: <path d='M18 15l-6-6-6 6' />,
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
  brain: (<><path d='M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z' /><path d='M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z' /><path d='M12 5v13' /></>),
  pen: (<><path d='M12 20h9' /><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' /></>),
  edit: (<><path d='M12 20h9' /><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' /></>),
  eye: (<><path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' /><circle cx='12' cy='12' r='3' /></>),
  book: (<><path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20' /><path d='M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' /></>),
  image: (<><rect x='3' y='3' width='18' height='18' rx='2' /><circle cx='8.5' cy='8.5' r='1.5' /><path d='M21 15l-5-5L5 21' /></>),
  bolt: <path d='M13 2L3 14h9l-1 8 10-12h-9l1-8z' />,
  ghost: (<><path d='M9 10h.01M15 10h.01' /><path d='M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z' /></>),
  mic: (<><rect x='9' y='2' width='6' height='12' rx='3' /><path d='M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8' /></>),
  'mic-off': (<><path d='M1 1l22 22' /><path d='M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6' /><path d='M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 22h8' /></>),
  more: (<><circle cx='12' cy='5' r='1.4' /><circle cx='12' cy='12' r='1.4' /><circle cx='12' cy='19' r='1.4' /></>),
  branch: (<><path d='M6 3v12' /><circle cx='18' cy='6' r='3' /><circle cx='6' cy='18' r='3' /><path d='M18 9a9 9 0 0 1-9 9' /></>),
  speaker: (<><path d='M11 5L6 9H2v6h4l5 4V5z' /><path d='M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14' /></>),
  sun: (<><circle cx='12' cy='12' r='4' /><path d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41' /></>),
  moon: <path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' />,
  settings: <path d='M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' />,
  activity: <path d='M22 12h-4l-3 9L9 3l-3 9H2' />,
  history: (<><path d='M3 3v5h5' /><path d='M3.05 13A9 9 0 1 0 6 5.3L3 8' /><path d='M12 7v5l4 2' /></>),
  chat: <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />,
  user: (<><circle cx='12' cy='8' r='4' /><path d='M4 21a8 8 0 0 1 16 0' /></>),
  download: <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3' />,
  file: (<><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' /><path d='M14 2v6h6' /></>),
  stop: <rect x='6' y='6' width='12' height='12' rx='2' />,
  shield: <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' />,
  info: (<><circle cx='12' cy='12' r='10' /><path d='M12 16v-4M12 8h.01' /></>),
  pin: <path d='M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z' />,
  globe: (<><circle cx='12' cy='12' r='10' /><path d='M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z' /></>),
  phone: (<><rect x='5' y='2' width='14' height='20' rx='2' /><path d='M12 18h.01' /></>),
  bot: (<><path d='M12 8V4M8 4h8' /><rect x='3' y='8' width='18' height='12' rx='3' /><circle cx='9' cy='14' r='1' /><circle cx='15' cy='14' r='1' /></>),
  upload: <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12' />,
  'arrow-up': <path d='M12 19V5M5 12l7-7 7 7' />,
  left: <path d='M15 18l-6-6 6-6' />,
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
