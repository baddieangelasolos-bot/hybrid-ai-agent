import { createAgentUIStreamResponse, type UIMessage } from 'ai';
import { requireAuth } from '@/lib/auth';
import { resolvePermissions } from '@/lib/connectors/permissions';
import { getChain, pickNode } from '@/lib/failover';
import { errMsg, json } from '@/lib/http';
import { buildAgent } from '@/lib/orchestrator';
import { normalizePersona } from '@/lib/personas';
import { redactSecrets } from '@/lib/security';
import { detectSkill } from '@/lib/skills';
import type { ChatRequestBody } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

function lastUserMessage(messages: UIMessage[]): UIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i];
  }
  return undefined;
}

export async function POST(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return json({ ok: false, code: 'bad-request', message: 'Invalid JSON body.' }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ ok: false, code: 'bad-request', message: 'messages must be a non-empty array.' }, 400);
  }
  const messages = body.messages as UIMessage[];

  const lastUser = lastUserMessage(messages);
  const userText = (lastUser?.parts ?? [])
    .map((p) => (p.type === 'text' ? ((p as unknown as { text?: string }).text ?? '') : ''))
    .join(' ');
  const hasImage = (lastUser?.parts ?? []).some((p) => p.type === 'file' && String((p as unknown as { mediaType?: string }).mediaType ?? '').startsWith('image/'));

  const chain = getChain('orchestrator', hasImage);
  const node = pickNode(chain, typeof body.nodeIndex === 'number' ? body.nodeIndex : 0);
  if (!node) {
    return json(
      {
        ok: false,
        code: 'no-model',
        message: hasImage
          ? 'Image input needs a vision model: set GEMINI_API_KEY.'
          : 'No AI model is configured. Set GROQ_API_KEY and/or GEMINI_API_KEY in Vercel.',
      },
      503,
    );
  }

  const memory = Array.isArray(body.memory)
    ? (body.memory as unknown[]).filter((m): m is string => typeof m === 'string').map((m) => redactSecrets(m).slice(0, 300)).slice(0, 12)
    : [];

  try {
    const agent = buildAgent({
      node,
      persona: normalizePersona(body.persona),
      skill: detectSkill(userText).skill,
      permissions: resolvePermissions(body.permissions),
      memory,
    });
    const response = await createAgentUIStreamResponse({ agent, uiMessages: messages });
    const headers = new Headers(response.headers);
    headers.set('x-agent-node', node.label);
    headers.set('x-agent-chain', String(chain.length));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (e) {
    return json({ ok: false, code: 'agent-error', message: redactSecrets(errMsg(e)) }, 500);
  }
}
