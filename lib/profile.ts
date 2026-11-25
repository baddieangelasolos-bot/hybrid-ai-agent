/** Master user profile + learned answer-style preferences. Pure helpers (client and server). */

export interface UserProfile {
  name: string;
  location: string;
  track: string;
  language: string;
  about: string;
  style: { format: 'auto' | 'bullets' | 'paragraphs' | 'tables'; detail: 'auto' | 'concise' | 'detailed'; tone: 'auto' | 'friendly' | 'formal' };
  learned: string[];
  updatedAt: number;
}

export const DEFAULT_PROFILE: UserProfile = {
  name: '',
  location: 'Bangladesh',
  track: 'HSC (Bangladesh national curriculum, NCTB textbooks and board exams)',
  language: 'English and Bangla',
  about: '',
  style: { format: 'auto', detail: 'auto', tone: 'auto' },
  learned: [],
  updatedAt: 0,
};

export const PROFILE_KEY = 'prefs/profile';
export const PROFILE_LOCAL_KEY = 'hya:profile';

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, n) : '');

/** Turns an untrusted profile object into one short prompt block (server side). */
export function profileBlock(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const p = raw as Partial<UserProfile>;
  const lines: string[] = [];
  const add = (label: string, v: string) => v && lines.push('- ' + label + ': ' + v);
  add('Name', clip(p.name, 60));
  add('Location', clip(p.location, 80));
  add('Study track / curriculum (assume this unless told otherwise, e.g. "HSC" means this, never another country)', clip(p.track, 160));
  add('Preferred language', clip(p.language, 60));
  add('About', clip(p.about, 300));
  const s = (p.style ?? {}) as Partial<UserProfile['style']>;
  if (s.format && s.format !== 'auto') add('Answer format', s.format === 'bullets' ? 'bullet points' : s.format === 'tables' ? 'tables where useful' : 'flowing paragraphs');
  if (s.detail && s.detail !== 'auto') add('Answer length', s.detail === 'concise' ? 'short and concise' : 'detailed and thorough');
  if (s.tone && s.tone !== 'auto') add('Tone', s.tone);
  if (Array.isArray(p.learned)) for (const l of p.learned.slice(0, 12)) add('Learned', clip(l, 140));
  return lines.length ? lines.join('\n') : '';
}

/** Free, deterministic learning from explicit feedback phrases. Returns null when nothing was learned. */
export function learnFromMessage(text: string, p: UserProfile): { profile: UserProfile; note: string } | null {
  const t = text.toLowerCase();
  const next: UserProfile = { ...p, style: { ...p.style }, learned: [...p.learned] };
  let note = '';
  const set = (cond: boolean, apply: () => void, msg: string) => {
    if (cond && !note) {
      apply();
      note = msg;
    }
  };
  set(/\b(too long|shorter|be (more )?(brief|concise)|keep it short|short answers?)\b/.test(t), () => (next.style.detail = 'concise'), 'You prefer concise answers');
  set(/\b(more detail|in detail|detailed (answer|explanation)|explain (it )?more|too short)\b/.test(t), () => (next.style.detail = 'detailed'), 'You prefer detailed answers');
  set(/\b(use|in|with) (bullet ?points?|bullets|a list)\b/.test(t), () => (next.style.format = 'bullets'), 'You prefer bullet points');
  set(/\b(use|in|with) (a )?tables?\b/.test(t), () => (next.style.format = 'tables'), 'You prefer tables');
  set(/\b(answer|reply|respond|explain|write)\b.{0,20}\b(in|using)\s+(bangla|bengali)\b|\u09ac\u09be\u0982\u09b2\u09be\u09df|\bin (bangla|bengali)\b/.test(t) || /\u09ac\u09be\u0982\u09b2\u09be\u09af\u09bc/.test(text), () => (next.language = 'Bangla (with English technical terms)'), 'You prefer Bangla answers');
  if (!note) return null;
  if (!next.learned.includes(note)) next.learned = [note, ...next.learned].slice(0, 12);
  next.updatedAt = Date.now();
  return { profile: next, note };
}
