import type { AgentId } from './agents';

export interface RouteResult {
  agent: AgentId;
  reason: string;
}

/** Words that clearly ask for a different job than "save this about me". */
const OTHER_TASK = /\b(quiz|flashcards?|mcq|code|debug|search|look ?up|write|draw|image|solve|translate|summari[sz]e)\b/i;

/**
 * Saving, changing or forgetting a fact about the user. The lead orchestrator owns saveMemoryFact,
 * so these never go to a specialist ("memorize that my exam is on Dec 5" is not a study request).
 */
export function isMemoryIntent(text: string): boolean {
  const verb = /\b(memori[sz]e|remember|don'?t forget|note (down|that)|keep in mind|save (this|that|it)\b.{0,12}\bmemory|store (this|that)|forget (that|my))\b/i.test(text);
  const aboutMe = /\b(about me|that i\b|i('m| am| have| like| love| hate| prefer| study| live| work| was| need)|my (name|birthday|exam|goal|subject|school|college|class|roll|phone|email|address|favou?rite|plan|schedule|teacher)|call me)\b/i.test(text);
  const standing = /\b(my name is|call me|from now on|always (use|reply|answer|explain)|never (use|reply|answer))\b/i.test(text);
  if (standing) return true;
  return verb && aboutMe && !OTHER_TASK.test(text.replace(/\b(memori[sz]e|remember)\b/gi, ''));
}

const CODE_ERROR = /\b(error|exception|traceback|stack ?trace|crash(ed|es|ing)?|segfault|syntax|compile[dr]?|build (fail|error)|failed to (build|compile|deploy)|typeerror|referenceerror|undefined is not|cannot find module|npm err|eslint|lint|404|500|not working|doesn'?t work|broken|bug)\b/i;

const RULES: { agent: AgentId; reason: string; test: RegExp }[] = [
  {
    agent: 'image',
    reason: 'Looks like an image request',
    test: /^(please |can you |could you )?(draw|paint|sketch|illustrate)\b|\b(draw|paint|sketch|render|generate|create|make|design|imagine)\b[^.\n]{0,40}\b(image|picture|photo|pic|logo|icon|wallpaper|illustration|poster|artwork|portrait|banner|avatar|sticker)s?\b|\b(image|picture|photo) of\b/i,
  },
  {
    agent: 'study',
    reason: 'Learning request',
    test: /\b(quiz|flashcards?|mcq|practice (questions|problems)|test me|study|revise|revision|teach me|homework|lesson|syllabus|uddipak|board questions?|memori[sz]e (the |these |this |my )?(formulas?|chapter|lesson|vocab(ulary)?|dates|definitions|poem|table|notes|topic|equations?))\b/i,
  },
  {
    agent: 'coder',
    reason: 'Code, repo or deployment task',
    test: /```|\b(code|coding|typescript|javascript|python|java|rust|golang|php|react|next\.?js|node(\.?js)?|npm|css|html|sql|regex|api|endpoint|repos?|repository|github|git|commit|push|pull request|branch|merge|vercel|deploy(ment)?|docker|compile|refactor|function|component|script|webhook|n8n|sandbox|terminal|bash|shell command)\b/i,
  },
  {
    agent: 'coder',
    reason: 'Error or bug report',
    test: CODE_ERROR,
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

/** With an attachment only these can take the job over; anything else is plain reading of the file. */
const ATTACHMENT_OK = new Set<AgentId>(['coder', 'study', 'reasoner']);

/** Free, instant intent routing. Plain chat stays on the lead orchestrator. */
export function routeIntent(text: string, flags: { image: boolean; doc: boolean }): RouteResult {
  const t = text.trim();
  if (isMemoryIntent(t)) return { agent: 'auto', reason: 'Saving something about you' };
  const attached = flags.image || flags.doc;
  // An attached picture can never be handed to the image generator: it cannot edit or read pictures.
  const rule = RULES.find((r) => (!attached || r.agent !== 'image') && r.test.test(t));
  if (attached) {
    if (rule && ATTACHMENT_OK.has(rule.agent)) return { agent: rule.agent, reason: rule.reason + ' (with your attachment)' };
    return { agent: 'vision', reason: flags.doc ? 'Document attached' : 'Image attached' };
  }
  if (rule) return { agent: rule.agent, reason: rule.reason };
  return { agent: 'auto', reason: 'Direct answer' };
}

export function wantsMemoryTool(text: string): boolean {
  return isMemoryIntent(text) || /\b(remember|don'?t forget|note that|keep in mind|my name is|call me|i prefer|i like|i love|i hate|i don'?t like|i'?m a|i am a|i'?m (in|from|studying|preparing)|i live|i study|i'?m preparing|my (exam|goal|subject|favou?rite)|from now on|always (use|reply|answer|explain)|never (use|reply|answer))\b/i.test(text);
}
