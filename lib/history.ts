import type { UIMessage } from 'ai';

interface Part {
  type: string;
  text?: string;
  url?: string;
  mediaType?: string;
  filename?: string;
  state?: string;
  [key: string]: unknown;
}

export interface HistoryOptions {
  keepTools: boolean;
  maxMessages: number;
  maxChars: number;
}

const OLD_TEXT_LIMIT = 6000;

function partsOf(m: UIMessage): Part[] {
  return m.parts as unknown as Part[];
}

function chars(m: UIMessage): number {
  let n = 0;
  for (const p of partsOf(m)) {
    if (p.type === 'text') n += (p.text ?? '').length;
    else if (p.type === 'file') n += 400;
    else if (p.type.startsWith('tool-')) n += 600;
  }
  return n;
}

/**
 * Shrinks the conversation before it is sent to a model. Keeps the request small (free tiers have
 * tight per-minute token limits), drops stale tool traces and old attachments, and keeps the
 * last assistant tool state so approvals can continue.
 */
export function prepareHistory(messages: UIMessage[], opts: HistoryOptions): UIMessage[] {
  let list = messages.slice(-opts.maxMessages);
  while (list.length > 1 && list[0].role !== 'user') list = list.slice(1);

  let lastAssistant = -1;
  let lastUser = -1;
  list.forEach((m, i) => {
    if (m.role === 'assistant') lastAssistant = i;
    if (m.role === 'user') lastUser = i;
  });

  const out = list.map((m, i): UIMessage => {
    const keepToolState = opts.keepTools && i === lastAssistant && lastAssistant > lastUser;
    const recentUser = m.role === 'user' && i >= lastUser - 2;
    const parts: Part[] = [];
    for (const p of partsOf(m)) {
      if (p.type === 'reasoning' || p.type === 'step-start' || p.type.startsWith('data-')) continue;
      if ((p.type === 'tool-makeQuiz' || p.type === 'tool-makeFlashcards') && p.output && typeof p.output === 'object') {
        // Keep quizzes in the conversation as compact text so typed answers can be graded and "more questions" avoids repeats.
        const o = p.output as { title?: string; questions?: { question: string; options: string[]; answerIndex: number; topic?: string }[]; cards?: { front: string; back: string }[] };
        const body = o.questions
          ? o.questions.map((q, n) => (n + 1) + '. ' + q.question + ' ' + q.options.map((x, k) => String.fromCharCode(65 + k) + ') ' + x).join(' ') + ' [answer ' + String.fromCharCode(65 + q.answerIndex) + (q.topic ? ', topic ' + q.topic : '') + ']').join('\n')
          : (o.cards ?? []).map((c) => c.front + ' = ' + c.back).join('\n');
        parts.push({ type: 'text', text: '[Shown to the learner as an interactive ' + (o.questions ? 'quiz' : 'flashcard deck') + ' "' + (o.title ?? '') + '"; only you can see the answer key]\n' + body.slice(0, 5000) });
        continue;
      }
      if (p.type.startsWith('tool-') || p.type === 'dynamic-tool') {
        if (keepToolState) parts.push(p);
        continue;
      }
      if (p.type === 'file') {
        if (recentUser) parts.push(p);
        else parts.push({ type: 'text', text: '[attachment omitted: ' + (p.filename ?? p.mediaType ?? 'file') + ']' });
        continue;
      }
      if (p.type === 'text') {
        const t = p.text ?? '';
        const limit = i === lastUser ? 60000 : OLD_TEXT_LIMIT;
        parts.push({ ...p, text: t.length > limit ? t.slice(0, limit) + '\n[... trimmed ...]' : t });
        continue;
      }
      parts.push(p);
    }
    return { ...m, parts: parts as unknown as UIMessage['parts'] };
  });

  const cleaned = out.filter((m) => partsOf(m).length > 0);
  let total = cleaned.reduce((n, m) => n + chars(m), 0);
  while (cleaned.length > 1 && total > opts.maxChars) {
    const dropped = cleaned.shift() as UIMessage;
    total -= chars(dropped);
    while (cleaned.length > 1 && cleaned[0].role !== 'user') total -= chars(cleaned.shift() as UIMessage);
  }
  return cleaned;
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3.2);
}

export function historyChars(messages: UIMessage[]): number {
  return messages.reduce((n, m) => n + chars(m), 0);
}
