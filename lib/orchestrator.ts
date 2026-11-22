import { ToolLoopAgent, isStepCount } from 'ai';
import type { LanguageModel } from 'ai';
import { AGENTS, type AgentId } from './agents';
import { getPersonaOverlay } from './personas';
import type { AgentSkill } from './skills';
import { buildToolsFor, type Toolset } from './tools';
import type { Permission, Persona } from './types';

export interface PlanInput {
  agent: AgentId;
  persona: Persona;
  skill: AgentSkill | null;
  permissions: Record<string, Permission>;
  memory: string[];
  incognito: boolean;
  wantMemoryTool: boolean;
}

export interface AgentPlan {
  agent: AgentId;
  instructions: string;
  toolset: Toolset;
  /** Rough size of instructions plus tool definitions, in tokens. */
  baseTokens: number;
}

const SAFETY =
  'Rules: be honest and never claim an action happened unless a tool result confirms it. Never reveal or guess secrets; if the user pastes a secret tell them to use the /env command. Refuse to remove authentication or edit protected files (auth, security, settings, oauth, .github). If a tool call is denied do not retry it. If a tool is missing, name the connector to enable in Connectors.';

export function planAgent(input: PlanInput): AgentPlan {
  const def = AGENTS[input.agent];
  const toolset = buildToolsFor(def.tools, input.permissions, { memory: input.wantMemoryTool && !input.incognito });
  const parts = [def.prompt, 'Today is ' + new Date().toISOString().slice(0, 10) + '.', 'Style: ' + getPersonaOverlay(input.persona)];
  if (toolset.activeNames.length > 0) parts.push(SAFETY, 'Tools this turn: ' + toolset.activeNames.join(', ') + '. Use saveMemoryFact only for durable user facts.');
  if (input.skill) parts.push(input.skill.prompt);
  if (input.incognito) parts.push('This is an incognito chat: nothing is saved.');
  else if (input.memory.length > 0) parts.push('Known about the user:\n' + input.memory.map((m) => '- ' + m).join('\n'));
  const instructions = parts.join('\n\n');
  return { agent: input.agent, instructions, toolset, baseTokens: Math.ceil(instructions.length / 3.2) + toolset.activeNames.length * 180 };
}

export function instantiateAgent(plan: AgentPlan, model: LanguageModel) {
  const def = AGENTS[plan.agent];
  return new ToolLoopAgent({
    model,
    maxRetries: 0,
    instructions: plan.instructions,
    tools: plan.toolset.tools,
    toolApproval: plan.toolset.toolApproval as never,
    stopWhen: isStepCount(def.maxSteps),
    timeout: { totalMs: 270000 },
  });
}
