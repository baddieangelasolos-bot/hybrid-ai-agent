import type { Permission } from '../types';
import { CONNECTORS } from './registry';

const RANK: Record<Permission, number> = { always: 0, ask: 1, blocked: 2 };

export function normalizePermission(value: unknown): Permission | null {
  return value === 'always' || value === 'ask' || value === 'blocked' ? value : null;
}

export function strictest(a: Permission, b: Permission): Permission {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * The client may only make a connector stricter than the server default, never looser.
 * Unknown custom connectors default to 'ask'.
 */
export function resolvePermissions(client: Record<string, unknown> | undefined): Record<string, Permission> {
  const out: Record<string, Permission> = {};
  for (const c of CONNECTORS) {
    const requested = normalizePermission(client?.[c.id]);
    out[c.id] = requested ? strictest(requested, c.defaultPermission) : c.defaultPermission;
  }
  if (client) {
    for (const key of Object.keys(client)) {
      if (!/^custom:[a-z0-9_]{1,30}$/.test(key)) continue;
      const requested = normalizePermission(client[key]);
      out[key] = requested ? strictest(requested, 'ask') : 'ask';
    }
  }
  return out;
}
