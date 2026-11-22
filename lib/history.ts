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
