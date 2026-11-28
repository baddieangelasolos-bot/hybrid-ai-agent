import { AGENTS, AGENT_ORDER, type AgentId } from './agents';
import { CONNECTORS, requiredEnv } from './connectors/registry';
import type { Toolset } from './tools';
import type { Permission } from './types';

const firstSentence = (s: unknown) => (typeof s === 'string' ? s.split(/(?<=[.!?])\s/)[0].slice(0, 120) : '');

/** What is really connected right now, read from the server environment (never from the model's memory). */
export function connectorLines(permissions: Record<string, Permission>): string[] {
  const out: string[] = [];
  for (const c of CONNECTORS) {
    if (c.status !== 'active' || c.tools.length === 0 || c.method === 'webhook') continue;
    if ((permissions[c.id] ?? c.defaultPermission) === 'blocked') {
      out.push(c.name + ': blocked by the user in Connectors');
      continue;
    }
    const missing = requiredEnv(c).filter((n) => !process.env[n]?.trim());
    const tools = c.tools.map((t) => t.name + (t.risk === 'critical' ? ' (asks the user to approve)' : '')).join(', ');
    out.push(missing.length === 0 ? c.name + ': CONNECTED. Tools: ' + tools : c.name + ': not connected yet (needs ' + missing.join(', ') + ' in Connectors). Tools once connected: ' + tools);
  }
  return out;
}

/**
 * The block every agent receives. The recurring failure was an agent saying "I do not have that connector"
 * while it did; this gives it the real list for this exact turn.
 */
export function capabilityBlock(agentId: AgentId, toolset: Toolset, permissions: Record<string, Permission>): string {
  const lines = ['APP CAPABILITIES (authoritative for this turn; trust this over your own assumptions):'];
  const held = toolset.activeNames.map((n) => {
    const d = firstSentence((toolset.tools[n] as { description?: string } | undefined)?.description);
    return d ? n + ' (' + d + ')' : n;
  });
  lines.push(held.length > 0 ? 'Tools you can call right now: ' + held.join('; ') + '.' : 'Tools you can call right now: none. Specialist agents hold the tools, and the app hands each request to the right specialist automatically.');
  const conns = connectorLines(permissions);
  if (conns.length > 0) lines.push('Connectors:\n' + conns.map((c) => '- ' + c).join('\n'));
  if (agentId === 'auto') {
    lines.push('Specialists the app can hand work to:\n' + AGENT_ORDER.filter((id) => id !== 'auto').map((id) => '- ' + AGENTS[id].name + ': ' + AGENTS[id].tagline).join('\n'));
  }
  lines.push(
    'Never say you lack a tool or connector that is listed above as available or CONNECTED. If a connector is listed as not connected, tell the user exactly which keys to add in Connectors. If you do not hold a needed tool yourself, name the specialist that does and say you are passing the task on; never ask the user to convince you or to reconfigure something that is already connected. Never claim a tool that is not listed.',
  );
  return lines.join('\n');
}
