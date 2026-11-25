import { AGENT_ORDER, AGENTS, type AgentId } from './agents';
import { MODELS, type ModelDef } from './models';

export type ChatCommand =
  | { kind: 'last-chat' }
  | { kind: 'find-chat'; query: string }
  | { kind: 'primary'; model: ModelDef; agent: AgentId }
  | { kind: 'model-unknown'; text: string }
  | { kind: 'profile' };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
const STOP = new Set(['it', 'this', 'that', 'one', 'them', 'the', 'a', 'an', 'model', 'models', 'my', 'your']);

/** Fuzzy model lookup: every word of the query must appear in the model name or id. */
export function resolveModel(query: string): ModelDef | null {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0 || words.every((w) => STOP.has(w))) return null;
  const scored = MODELS.map((m) => {
    const hay = norm(m.label + ' ' + m.id);
    return { m, ok: words.every((w) => hay.includes(w)), len: hay.length };
  }).filter((x) => x.ok);
  scored.sort((a, b) => a.len - b.len);
  return scored[0]?.m ?? null;
}

/** Which agent a phrase names, or null when it names none. */
export function recognizeAgent(text: string): AgentId | null {
  const t = norm(text);
  if (!t) return null;
  if (/orchest|lead|auto/.test(t)) return 'auto';
  if (/self|modif/.test(t)) return 'selfmod';
  if (/cod|dev/.test(t)) return 'coder';
  if (/research|search/.test(t)) return 'researcher';
  if (/reason|math|logic/.test(t)) return 'reasoner';
  if (/writ/.test(t)) return 'writer';
  if (/vision|doc|image read/.test(t)) return 'vision';
  if (/stud|tutor/.test(t)) return 'study';
  if (/image|draw/.test(t)) return 'image';
  if (/quick|fast/.test(t)) return 'quick';
  return AGENT_ORDER.find((id) => t.includes(norm(AGENTS[id].name))) ?? null;
}

export function resolveAgent(text: string, fallback: AgentId): AgentId {
  return recognizeAgent(text) ?? fallback;
}

/** Local commands that must change app state instead of being sent to a model. */
export function parseCommand(text: string, currentAgent: AgentId): ChatCommand | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 200) return null;
  if (/^\/last\b/i.test(t) || /^(please |can you |could you )?(switch|go|jump|open|continue|resume|return|take me)( back)?( to)?( the| my)? (last|previous|prior|recent|earlier) (chat|conversation|thread)\b/i.test(t)) return { kind: 'last-chat' };
  const find = t.match(/^(?:open|find|show|switch to|go to) (?:the |my )?(?:chat|conversation|thread) (?:about|on|named|called|with) (.+)$/i);
  if (find) return { kind: 'find-chat', query: find[1].trim() };
  if (/^\/profile\b/i.test(t)) return { kind: 'profile' };

  let modelText = '';
  let agentText = '';
  const slash = t.match(/^\/primary\s+(.+)$/i);
  if (slash) {
    const explicit = slash[1].split(/\s+(?:for|in|on)\s+/i);
    if (explicit.length > 1) {
      modelText = explicit[0];
      agentText = explicit[1];
    } else {
      // "/primary qwen 3.8 27b researcher": the longest leading words that name a model; the rest names the agent.
      const words = slash[1].split(' ');
      for (let n = words.length; n >= 1; n--) {
        if (resolveModel(words.slice(0, n).join(' '))) {
          modelText = words.slice(0, n).join(' ');
          agentText = words.slice(n).join(' ');
          break;
        }
      }
      if (!modelText) modelText = slash[1];
    }
  } else {
    const a = t.match(/^(?:please )?(?:make|set|put) (.+?) (?:as )?(?:the |your )?(?:primary|first|main|#1)(?: model| one)?(?:(?: (?:for|of|in) (?:the |your )?| )(.+?))?$/i);
    const b = t.match(/^(.+?),? (?:make it|set it as|be|use it as) (?:the |your )?(?:primary|first|main)(?: model)?\s*(.*)$/i);
    const m = a ?? b;
    if (m) {
      modelText = m[1];
      agentText = (m[2] ?? '').replace(/^(?:for|of|in)\s+/i, '').replace(/^(?:the|your)\s+/i, '');
    }
  }
  if (!modelText) return null;
  const model = resolveModel(modelText.replace(/^(?:the|model)\s+/i, ''));
  if (!model) return slash ? { kind: 'model-unknown', text: modelText } : null;
  // Trailing words must really name an agent, otherwise "make it the main focus" would look like a command.
  const named = recognizeAgent(agentText);
  if (agentText.trim() && !named) return slash ? { kind: 'model-unknown', text: agentText } : null;
  return { kind: 'primary', model, agent: named ?? currentAgent };
}
