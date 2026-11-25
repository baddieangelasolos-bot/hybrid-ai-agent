/** Marker text parts (file chips and reply quotes). Plain module: safe on server and client. */

export const FILE_MARK = '[[file:';
export const REPLY_MARK = '[[reply:';

/** A quoted message travels as its own text part with a marker: the UI shows a quote card, the model reads the quote. */
export function replyTextPart(role: string, snippet: string): string {
  return REPLY_MARK + role + ']]\n' + snippet.replace(/\s+/g, ' ').trim().slice(0, 600);
}

export function parseReplyMark(text: string): { role: string; body: string } | null {
  if (!text.startsWith(REPLY_MARK)) return null;
  const end = text.indexOf(']]');
  return end < 0 ? null : { role: text.slice(REPLY_MARK.length, end), body: text.slice(end + 3) };
}

export function parseFileMark(text: string): { name: string; body: string } | null {
  if (!text.startsWith(FILE_MARK)) return null;
  const end = text.indexOf(']]');
  if (end < 0) return null;
  return { name: text.slice(FILE_MARK.length, end), body: text.slice(end + 3) };
}

export function isMarkerText(text: string): boolean {
  return text.startsWith(FILE_MARK) || text.startsWith(REPLY_MARK);
}

/** Plain-language version of a reply marker for the model. */
export function replyForModel(text: string): string {
  const r = parseReplyMark(text);
  return r ? '(The user is replying to this earlier ' + (r.role === 'user' ? 'message of theirs' : 'answer of yours') + ': "' + r.body + '")' : text;
}
