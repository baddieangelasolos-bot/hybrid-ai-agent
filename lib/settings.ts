'use client';

import type { AgentId } from './agents';
import type { Persona } from './types';

export type ThemePref = 'system' | 'dark' | 'light';
export type AccentPref = 'indigo' | 'violet' | 'teal' | 'rose' | 'amber';

export interface Settings {
  theme: ThemePref;
  accent: AccentPref;
  fontScale: 'sm' | 'md' | 'lg';
  reduceMotion: boolean;
  agent: AgentId;
  persona: Persona;
  memoryEnabled: boolean;
  incognitoDefault: boolean;
  showRoute: boolean;
  showTrace: boolean;
  sendOnEnter: boolean;
  haptics: boolean;
  voiceEngine: 'browser' | 'whisper';
  voiceLang: string;
  autoSpeak: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'indigo',
  fontScale: 'md',
  reduceMotion: false,
  agent: 'auto',
  persona: 'default',
  memoryEnabled: true,
  incognitoDefault: false,
  showRoute: true,
  showTrace: true,
  sendOnEnter: false,
  haptics: true,
  voiceEngine: 'browser',
  voiceLang: 'en-US',
  autoSpeak: false,
};

export const SETTINGS_KEY = 'hya:settings';
export const SETTINGS_STORE_KEY = 'prefs/settings';

export function loadSettingsLocal(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettingsLocal(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage can be blocked in private windows */
  }
}

export function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'system') return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme(s: Settings): void {
  const d = document.documentElement;
  const theme = resolveTheme(s.theme);
  d.dataset.theme = theme;
  d.dataset.accent = s.accent;
  d.dataset.font = s.fontScale;
  if (s.reduceMotion) d.dataset.motion = 'off';
  else delete d.dataset.motion;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#0a0c11' : '#f2f4f9');
}

export function haptic(enabled: boolean, ms = 8): void {
  if (enabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
}

/** Remembers which models ran out of quota so the server can skip them even on a cold start. */
const COOLDOWN_KEY = 'hya:cooldowns';

export function loadCooldowns(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || '{}') as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number' && v > now));
  } catch {
    return {};
  }
}

export function mergeServerLedger(ledger: { key: string; until: number }[]): Record<string, number> {
  const next = loadCooldowns();
  for (const e of ledger) {
    if (e.until > Date.now()) next[e.key] = e.until;
    else delete next[e.key];
  }
  try {
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
