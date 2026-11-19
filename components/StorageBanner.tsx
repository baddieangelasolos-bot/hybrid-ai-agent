'use client';

import { useSyncExternalStore } from 'react';
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

export default function StorageBanner({ onOpenConnectors }: { onOpenConnectors: () => void }) {
  const s = useStorageStatus();
  if (s.mode === 'drive' && s.pending === 0) return null;
  if (s.mode === 'local' && s.checking && s.reason === null) return null;
  const needsConnect = s.reason === 'not-configured' || s.reason === 'auth';
  return (
    <div className='flex flex-wrap items-center gap-3 px-4 py-2 text-sm text-amber-100' style={{ background: 'rgba(251,191,36,0.1)', borderBottom: '1px solid rgba(251,191,36,0.25)' }} role='status'>
      <Icon name='alert' size={15} />
      <span className='min-w-0 flex-1'>
        {s.mode === 'drive' ? 'Syncing ' + s.pending + ' queued item' + (s.pending === 1 ? '' : 's') + ' to Google Drive...' : s.message}
        {s.pending > 0 && s.mode === 'local' ? ' (' + s.pending + ' waiting to sync)' : ''}
      </span>
      {needsConnect && (
        <button type='button' onClick={onOpenConnectors} className='ghost-btn rounded-lg px-3 py-1 text-xs'>
          Connect Drive
        </button>
      )}
      <button type='button' onClick={() => void storage.checkHealth()} className='ghost-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs' disabled={s.checking}>
        <Icon name='refresh' size={12} />
        Retry sync
      </button>
    </div>
  );
}
