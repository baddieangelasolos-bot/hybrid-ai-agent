'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { storage, type StorageStatus } from '@/lib/storage';
import { Icon } from './Icons';

export function useStorageStatus(): StorageStatus {
  return useSyncExternalStore(storage.subscribe, storage.getStatus, storage.getStatus);
}

export function StoragePill() {
  const s = useStorageStatus();
  const drive = s.mode === 'drive';
  return (
    <span
      className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ' + (drive ? 'text-emerald-300' : 'text-amber-300')}
      style={{ border: '1px solid ' + (drive ? 'rgba(52,211,153,0.35)' : 'rgba(251,191,36,0.35)'), background: drive ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)' }}
      title={s.message}
    >
      <Icon name={drive ? 'cloud' : 'cloud-off'} size={13} />
      {s.checking && s.lastSyncAt === null && s.mode === 'local' ? 'Checking...' : drive ? 'Cloud Sync' : 'Local Backup Mode'}
    </span>
  );
}

/** One slim line instead of a big banner. Dismissible for the session. */
export default function StorageBanner({ onOpenConnectors }: { onOpenConnectors: () => void }) {
  const s = useStorageStatus();
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(sessionStorage.getItem('hya:sync-hidden') === '1'), []);
  if (hidden) return null;
  if (s.mode === 'drive' && s.pending === 0) return null;
  if (s.mode === 'local' && s.checking && s.reason === null) return null;
  const needsConnect = s.reason === 'not-configured' || s.reason === 'auth';
  return (
    <div className='safe-top flex items-center gap-2 px-3 py-1.5 text-xs' style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--bg))', borderBottom: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)', color: 'var(--ink)' }}>
      <span style={{ color: 'var(--warn)' }}><Icon name={s.mode === 'drive' ? 'cloud' : 'cloud-off'} size={14} /></span>
      <span className='min-w-0 flex-1 truncate' title={s.message}>
        {s.mode === 'drive' ? 'Syncing ' + s.pending + ' item' + (s.pending === 1 ? '' : 's') + ' to Drive...' : 'Local backup mode' + (s.pending > 0 ? ' · ' + s.pending + ' waiting' : '') + ' · chats stay on this device'}
      </span>
      {needsConnect && (
        <button type='button' onClick={onOpenConnectors} className='rounded-md px-2 py-1 font-medium' style={{ color: 'var(--accent)' }}>Connect</button>
      )}
      <button type='button' onClick={() => void storage.checkHealth()} className='rounded-md px-2 py-1' style={{ color: 'var(--muted)' }} disabled={s.checking} aria-label='Retry sync'>
        <Icon name='refresh' size={13} />
      </button>
      <button type='button' aria-label='Dismiss' className='rounded-md px-1.5 py-1' style={{ color: 'var(--muted)' }} onClick={() => { sessionStorage.setItem('hya:sync-hidden', '1'); setHidden(true); }}>
        <Icon name='x' size={13} />
      </button>
    </div>
  );
}
