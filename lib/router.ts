import type { AgentId } from './agents';

export interface RouteResult {
  agent: AgentId;
  reason: string;
}

const RULES: { agent: AgentId; reason: string; test: RegExp }[] = [
  {
    agent: 'image',
    reason: 'Looks like an image request',
    test: /\b(draw|paint|sketch|render|generate|create|make|design|imagine)\b[^.\n]{0,40}\b(image|picture|photo|pic|logo|icon|wallpaper|illustration|poster|artwork|portrait|banner|avatar|sticker)s?\b|\b(image|picture|photo) of\b/i,
  },
  {
    agent: 'study',
    reason: 'Learning request',
    test: /\b(quiz|flashcards?|mcq|practice (questions|problems)|test me|study|revise|revision|teach me|homework|lesson|syllabus|memori[sz]e)\b/i,
  },
  {
    agent: 'coder',
    reason: 'Code or repo task',
    test: /```|\b(code|coding|bug|debug|typescript|javascript|python|java|rust|golang|php|react|next\.?js|node(\.?js)?|npm|css|html|sql|regex|api|endpoint|repo|repository|github|commit|vercel|deploy|docker|compile|stack ?trace|refactor|function|component|script|webhook|n8n)\b/i,
  },
  {
    agent: 'reasoner',
    reason: 'Needs careful step-by-step reasoning',
    test: /\b(solve|prove|derive|calculate|integral|derivative|equation|probability|theorem|algebra|geometry|puzzle|riddle|logic)\b/i,
  },
  {
    agent: 'researcher',
    reason: 'Needs fresh information from the web',
    test: /https?:\/\/|\b(search|look ?up|google|latest|news|today|tonight|yesterday|this (week|month|year)|currently|right now|recent(ly)?|price of|weather|score|stock|release date|trending|reviews? of)\b/i,
  },
  {
    agent: 'writer',
    reason: 'Writing task',
    test: /\b(write|draft|compose|rewrite|rephrase|paraphrase|proofread|translate|summari[sz]e|essay|email|letter|story|poem|blog|caption|speech|resume)\b/i,
  },
];

/** Free, instant intent routing. Plain chat stays on the lead orchestrator. */
export function routeIntent(text: string, flags: { image: boolean; doc: boolean }): RouteResult {
  const t = text.trim();
  const rule = RULES.find((r) => r.test.test(t));
  if (flags.image || flags.doc) {
    if (rule && (rule.agent === 'study' || rule.agent === 'coder')) return { agent: rule.agent, reason: rule.reason };
    return { agent: 'vision', reason: flags.doc ? 'Document attached' : 'Image attached' };
  }
  if (rule) return { agent: rule.agent, reason: rule.reason };
  return { agent: 'auto', reason: 'Direct answer' };
}

export function wantsMemoryTool(text: string): boolean {
  return /\b(remember|don'?t forget|note that|keep in mind|my name is|call me|i prefer|i like|i love|i hate|i don'?t like|i'?m a|i am a|i'?m (in|from|studying|preparing)|i live|i study|i'?m preparing|my (exam|goal|subject|favou?rite)|from now on|always (use|reply|answer|explain)|never (use|reply|answer))\b/i.test(text);
}
