import type { Tool } from 'ai';
import { CONNECTORS, type ToolRisk } from '../connectors/registry';
import type { Permission } from '../types';
import { delegateToCoderWorker, renderMultiFileWorkspace, saveMemoryFact } from './core';
import { listRepoFiles, pushToGitHubRepo, readRepoFile } from './github';
import { checkVercelDeployment, triggerRedeploy } from './vercel';
import { callWebhookConnector } from './webhook';
import { readWebPage, webSearch } from './web';

const IMPLEMENTATIONS: Record<string, Tool> = {
  listRepoFiles,
  readRepoFile,
  pushToGitHubRepo,
  checkVercelDeployment,
  triggerRedeploy,
  webSearch,
  readWebPage,
  callWebhookConnector,
} as unknown as Record<string, Tool>;

const CORE_TOOLS: Record<string, Tool> = {
  saveMemoryFact,
  renderMultiFileWorkspace,
  delegateToCoderWorker,
} as unknown as Record<string, Tool>;

type Approval = 'user-approval' | { type: 'user-approval'; reason: string } | undefined;

const REASONS: Record<string, string> = {
  pushToGitHubRepo: 'The agent wants to commit files to your GitHub repository.',
  triggerRedeploy: 'The agent wants to redeploy this Vercel project.',
  callWebhookConnector: 'The agent wants to call an external automation webhook.',
};

function approvalFor(tool: string, risk: ToolRisk, permission: Permission): Approval {
  if (risk === 'critical') return { type: 'user-approval', reason: REASONS[tool] ?? 'High-impact action.' };
  if (permission === 'ask') return { type: 'user-approval', reason: REASONS[tool] ?? 'This connector is set to ask first.' };
  if (risk === 'write' && permission !== 'always') return { type: 'user-approval', reason: REASONS[tool] ?? 'Write action.' };
  return undefined;
}

export interface Toolset {
  tools: Record<string, Tool>;
  toolApproval: Record<string, (input: Record<string, unknown>) => Approval>;
  activeNames: string[];
}

/** Builds the tool list for one request from server-resolved permissions. */
export function buildToolset(permissions: Record<string, Permission>): Toolset {
  const tools: Record<string, Tool> = { ...CORE_TOOLS };
  const toolApproval: Toolset['toolApproval'] = {};

  for (const c of CONNECTORS) {
    if (c.status !== 'active') continue;
    const permission = permissions[c.id] ?? c.defaultPermission;
    if (permission === 'blocked') continue;
    for (const t of c.tools) {
      const impl = IMPLEMENTATIONS[t.name];
      if (!impl) continue;
      if (t.name === 'callWebhookConnector') continue;
      tools[t.name] = impl;
      const rule = approvalFor(t.name, t.risk, permission);
      if (rule) toolApproval[t.name] = () => rule;
    }
  }

  const webhookIds = ['make', 'n8n', ...Object.keys(permissions).filter((k) => k.startsWith('custom:'))];
  const allowedWebhook = webhookIds.filter((id) => (permissions[id] ?? 'ask') !== 'blocked');
  if (allowedWebhook.length > 0) {
    tools.callWebhookConnector = IMPLEMENTATIONS.callWebhookConnector;
    toolApproval.callWebhookConnector = (input) => {
      const id = typeof input.connectorId === 'string' ? input.connectorId : '';
      const permission = permissions[id] ?? 'blocked';
      if (permission === 'blocked') return { type: 'user-approval', reason: 'Connector is blocked; denying is recommended.' };
      return approvalFor('callWebhookConnector', 'write', permission);
    };
  }

  return { tools, toolApproval, activeNames: Object.keys(tools) };
}
