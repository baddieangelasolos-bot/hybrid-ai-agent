import type { Tool } from 'ai';
import type { ToolGroup } from '../agents';
import { CONNECTORS, type ToolRisk } from '../connectors/registry';
import type { Permission } from '../types';
import { renderMultiFileWorkspace, saveMemoryFact } from './core';
import { listRepoFiles, pushToGitHubRepo, readRepoFile } from './github';
import { generateImageTool } from './image';
import { makeFlashcards, makeQuiz } from './study';
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

/**
 * Builds only the tools one agent needs. Small toolsets keep prompts short, which matters on
 * free tiers with tight per-minute token limits.
 */
export function buildToolsFor(groups: ToolGroup[], permissions: Record<string, Permission>, opts: { memory: boolean }): Toolset {
  const tools: Record<string, Tool> = {};
  const toolApproval: Toolset['toolApproval'] = {};

  if (opts.memory) tools.saveMemoryFact = saveMemoryFact as unknown as Tool;
  if (groups.includes('workspace')) tools.renderMultiFileWorkspace = renderMultiFileWorkspace as unknown as Tool;
  if (groups.includes('image')) tools.generateImage = generateImageTool as unknown as Tool;
  if (groups.includes('study')) {
    tools.makeQuiz = makeQuiz as unknown as Tool;
    tools.makeFlashcards = makeFlashcards as unknown as Tool;
  }

  const wanted = new Set<string>();
  if (groups.includes('repo')) for (const id of ['github', 'vercel']) wanted.add(id);
  if (groups.includes('web')) wanted.add('web');

  for (const c of CONNECTORS) {
    if (c.status !== 'active' || !wanted.has(c.id)) continue;
    const permission = permissions[c.id] ?? c.defaultPermission;
    if (permission === 'blocked') continue;
    for (const t of c.tools) {
      const impl = IMPLEMENTATIONS[t.name];
      if (!impl || t.name === 'callWebhookConnector') continue;
      tools[t.name] = impl;
      const rule = approvalFor(t.name, t.risk, permission);
      if (rule) toolApproval[t.name] = () => rule;
    }
  }

  if (groups.includes('repo')) {
    const webhookIds = ['make', 'n8n', ...Object.keys(permissions).filter((k) => k.startsWith('custom:'))];
    if (webhookIds.some((id) => (permissions[id] ?? 'ask') !== 'blocked')) {
      tools.callWebhookConnector = IMPLEMENTATIONS.callWebhookConnector;
      toolApproval.callWebhookConnector = (input) => {
        const id = typeof input.connectorId === 'string' ? input.connectorId : '';
        const permission = permissions[id] ?? 'blocked';
        if (permission === 'blocked') return { type: 'user-approval', reason: 'Connector is blocked; denying is recommended.' };
        return approvalFor('callWebhookConnector', 'write', permission);
      };
    }
  }

  return { tools, toolApproval, activeNames: Object.keys(tools) };
}
