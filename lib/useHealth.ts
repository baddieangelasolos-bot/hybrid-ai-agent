'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';
import { loadCooldowns, mergeServerLedger } from './settings';

export type ModelState = 'ready' | 'exhausted' | 'busy' | 'missing' | 'no-key' | 'bad-key' | 'unknown';

export interface ModelStatus {
  state: ModelState;
  detail: string;
  until: number;
  rate?: { remReq?: number; limReq?: number; remTok?: number; limTok?: number; at: number };
  lastOkAt?: number;
}

export interface HealthData {
  at: number;
  providers: { id: string; label: string; env: string; configured: boolean; status: 'ok' | 'no-key' | 'bad-key' | 'error'; detail: string; count: number }[];
  models: Record<string, ModelStatus>;
  special: Record<string, ModelStatus>;
  image: { id: string; label: string; model: string; env: string[]; configured: boolean; note: string }[];
  ledger: { key: string; until: number }[];
}

export interface ServiceCheck {
  id: string;
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'missing';
  detail: string;
}

/** Folds in cooldowns this phone remembers, so a restarted server never shows an exhausted model as ready. */
function withLocal(data: HealthData): HealthData {
  const local = loadCooldowns();
  const models = { ...data.models };
  for (const [key, until] of Object.entries(local)) {
    const m = models[key];
    if (m && (m.state === 'ready' || m.state === 'unknown') && until > Date.now()) models[key] = { ...m, state: 'exhausted', until, detail: 'Daily free quota used up (remembered from your last chat).' };
  }
  return { ...data, models };
}

/**
 * Loads model health. Every call is a free metadata check (model catalogs plus what the server
 * learned from real chats), so it refreshes on open, on tab focus and every 45s without spending quota.
 */
export function useModelHealth() {
  const [data, setData] = useState<HealthData | null>(null);
  const [services, setServices] = useState<ServiceCheck[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const refresh = useCallback(async (withServices = true) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    const [m, s] = await Promise.all([apiRequest<HealthData>('/api/health/models'), withServices ? apiRequest<{ checks: ServiceCheck[] }>('/api/health') : Promise.resolve(null)]);
    if (m.ok && m.data) {
      mergeServerLedger(m.data.ledger);
      setData(withLocal(m.data));
      setError('');
    } else setError(m.message || 'Could not load model health.');
    if (s?.ok && s.data) setServices(s.data.checks);
    setLoading(false);
    busy.current = false;
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh(false);
    document.addEventListener('visibilitychange', onVisible);
    const t = window.setInterval(() => document.visibilityState === 'visible' && void refresh(false), 45000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(t);
    };
  }, [refresh]);

  return { data, services, loading, error, refresh };
}

export function formatReset(until: number): string {
  const ms = until - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  return Math.round(s / 3600) + 'h ago';
}

export const STATE_LABEL: Record<ModelState, string> = {
  ready: 'Ready',
  exhausted: 'Out of quota',
  busy: 'Busy',
  missing: 'Not available',
  'no-key': 'No key',
  'bad-key': 'Key rejected',
  unknown: 'Unknown',
};

export const STATE_COLOR: Record<ModelState, string> = {
  ready: 'var(--good)',
  exhausted: 'var(--bad)',
  busy: 'var(--warn)',
  missing: 'var(--muted)',
  'no-key': 'var(--muted)',
  'bad-key': 'var(--bad)',
  unknown: 'var(--warn)',
};
