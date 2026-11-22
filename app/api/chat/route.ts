import { createAgentUIStreamResponse, type UIMessage } from 'ai';
import { AGENTS, normalizeAgent, type AgentId } from '@/lib/agents';
import { requireAuth } from '@/lib/auth';
import { resolvePermissions } from '@/lib/connectors/permissions';
import { FailoverError, absorbClientCooldowns, classifyModelError, createFailoverModel, describeShort, getChain, type ModelNode } from '@/lib/failover';
import { estimateTokens, historyChars, prepareHistory } from '@/lib/history';
import { errMsg, json } from '@/lib/http';
import { instantiateAgent, planAgent } from '@/lib/orchestrator';
import { normalizePersona } from '@/lib/personas';
import { routeIntent, wantsMemoryTool } from '@/lib/router';
import { redactSecrets } from '@/lib/security';
import { detectSkill } from '@/lib/skills';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface Body {
  messages?: unknown;
  permissions?: Record<string, unknown>;
  persona?: string;
  memory?: unknown;
  agent?: string;
  incognito?: boolean;
  rotation?: number;
  cooldowns?: unknown;
}

interface PartLike {
  type: string;
  text?: string;
  mediaType?: string;
}

function lastUserMessage(messages: UIMessage[]): UIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i];
  return undefined;
}

/** Turns any stream error into a short, safe, readable message for the chat UI. */
function friendlyStreamError(error: unknown): string {
  console.error('[chat] stream error:', redactSecrets(errMsg(error)).slice(0, 800));
  if (error instanceof FailoverError) return redactSecrets(error.message);
  return redactSecrets('The model call failed: ' + describeShort(classifyModelError(error)));
}

export async function POST(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, code: 'bad-request', message: 'Invalid JSON body.' }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ ok: false, code: 'bad-request', message: 'messages must be a non-empty array.' }, 400);
  }
  const messages = body.messages as UIMessage[];
  absorbClientCooldowns(body.cooldowns);

  const lastUser = lastUserMessage(messages);
  const lastParts = (lastUser?.parts ?? []) as unknown as PartLike[];
  const userText = lastParts.map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join(' ');
  const hasImage = lastParts.some((p) => p.type === 'file' && (p.mediaType ?? '').startsWith('image/'));
  const hasDoc = lastParts.some((p) => p.type === 'file' && !(p.mediaType ?? '').startsWith('image/'));

  const skill = detectSkill(userText).skill;
  const requested = normalizeAgent(body.agent);
  let agentId: AgentId;
  let reason: string;
  if (requested !== 'auto') {
    agentId = requested;
    reason = 'You chose ' + AGENTS[requested].name;
  } else if (skill) {
    agentId = skill.agent;
    reason = 'Command ' + skill.command;
  } else {
    const r = routeIntent(userText, { image: hasImage, doc: hasDoc });
    agentId = r.agent;
    reason = r.reason;
  }

  const incognito = body.incognito === true;
  const memory = !incognito && Array.isArray(body.memory)
    ? (body.memory as unknown[]).filter((m): m is string => typeof m === 'string').map((m) => redactSecrets(m).slice(0, 300)).slice(0, 10)
    : [];

  const plan = planAgent({
    agent: agentId,
    persona: normalizePersona(body.persona),
    skill,
    permissions: resolvePermissions(body.permissions),
    memory,
    incognito,
    wantMemoryTool: agentId === 'auto' && wantsMemoryTool(userText),
  });

  const keepTools = plan.toolset.activeNames.length > 0;
  const history = prepareHistory(messages, { keepTools, maxMessages: agentId === 'auto' || agentId === 'quick' ? 10 : 24, maxChars: agentId === 'auto' || agentId === 'quick' ? 12000 : 120000 });
  const estTokens = plan.baseTokens + estimateTokens(historyChars(history));

  const chain = getChain({
    agent: agentId,
    vision: hasImage,
    docs: hasDoc,
    tools: keepTools,
    estTokens,
    rotation: typeof body.rotation === 'number' ? body.rotation : 0,
  });
  if (chain.nodes.length === 0) {
    const why = chain.skipped.length > 0 ? ' (' + chain.skipped.slice(0, 4).map((s) => s.key.split(':')[1] + ': ' + s.why).join('; ') + ')' : '';
    return json(
      { ok: false, code: 'no-model', message: (hasDoc ? 'PDF and audio input need a Google AI Studio key (GEMINI_API_KEY). ' : hasImage ? 'Image input needs GEMINI_API_KEY (or a Groq key for Qwen vision). ' : 'No AI model is available for this request. Set GROQ_API_KEY and GEMINI_API_KEY in Vercel.') + why },
      503,
    );
  }

  const def = AGENTS[agentId];
  let answered: ModelNode | null = null;
  const model = createFailoverModel(chain.nodes, { effort: def.effort, ttftMs: def.ttftMs, onModel: (n) => (answered = n) });
  const agent = instantiateAgent(plan, model);
  console.log('[chat]', agentId, '~' + estTokens + ' tok', chain.nodes.map((n) => n.def.id).join(' > '));

  const run = (uiMessages: UIMessage[]) =>
    createAgentUIStreamResponse({
      agent,
      uiMessages,
      onError: friendlyStreamError,
      messageMetadata: ({ part }: { part: { type: string } }) =>
        part.type === 'start' || part.type === 'finish'
          ? { agent: agentId, agentName: def.name, reason, model: (answered as ModelNode | null)?.label ?? chain.nodes[0].label }
          : undefined,
    } as never);

  try {
    let response: Response;
    try {
      response = await run(history);
    } catch (e) {
      if (!keepTools || !/validat|schema|tool/i.test(errMsg(e))) throw e;
      response = await run(prepareHistory(messages, { keepTools: false, maxMessages: 24, maxChars: 120000 }));
    }
    const headers = new Headers(response.headers);
    headers.set('x-agent-id', agentId);
    headers.set('x-agent-name', def.name);
    headers.set('x-agent-reason', reason);
    headers.set('x-agent-node', chain.nodes[0].label);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (e) {
    return json({ ok: false, code: 'agent-error', message: friendlyStreamError(e) }, 500);
  }
}
