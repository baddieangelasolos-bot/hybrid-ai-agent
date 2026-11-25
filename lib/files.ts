'use client';

import { FILE_MARK } from './markers';

export { FILE_MARK, REPLY_MARK, isMarkerText, parseFileMark, parseReplyMark, replyTextPart } from './markers';

export type AttachKind = 'image' | 'pdf' | 'text' | 'audio';

export interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  kind: AttachKind;
  size: number;
  /** image / pdf payload */
  dataUrl?: string;
  /** text or transcript payload */
  text?: string;
  note?: string;
}

export const MAX_PDF_BYTES = 2.4 * 1024 * 1024;
export const MAX_TEXT_CHARS = 120_000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const ACCEPT = 'image/*,application/pdf,audio/*,text/*,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.go,.rs,.php,.rb,.sql,.yml,.yaml,.xml,.log,.sh,.html,.css,.ini,.toml';

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|js|jsx|ts|tsx|py|java|c|h|cpp|cs|go|rs|php|rb|sql|yml|yaml|xml|log|sh|html|htm|css|scss|ini|toml|tex|srt|vtt)$/i;

const uid = () => Math.random().toString(36).slice(2, 10);

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
}

async function shrinkImage(file: File): Promise<{ dataUrl: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  let max = 1600;
  let quality = 0.84;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is not available in this browser.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length < 900_000 || attempt === 3) {
      bitmap.close();
      return { dataUrl, mediaType: 'image/jpeg' };
    }
    max = Math.round(max * 0.75);
    quality -= 0.08;
  }
  bitmap.close();
  throw new Error('Image is too large.');
}

export async function transcribeBlob(blob: Blob, language: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', blob, (blob as File).name || 'audio.webm');
  fd.append('language', language);
  const res = await fetch('/api/transcribe', { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; message?: string };
  if (!res.ok || !data.ok) throw new Error(data.message ?? 'Transcription failed (' + res.status + ').');
  return data.text ?? '';
}

/** Turns a picked file into something the chat can send. Throws a readable message on failure. */
export async function processFile(file: File, language: string): Promise<Attachment> {
  const base = { id: uid(), name: file.name || 'file', size: file.size };
  const type = file.type || '';
  if (type.startsWith('image/')) {
    const { dataUrl, mediaType } = await shrinkImage(file);
    return { ...base, kind: 'image', mediaType, dataUrl };
  }
  if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new Error('PDF is larger than 2.4 MB. Split it or send a smaller export (Vercel limits request size).');
    return { ...base, kind: 'pdf', mediaType: 'application/pdf', dataUrl: await readAsDataUrl(file) };
  }
  if (type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm|flac|aac)$/i.test(file.name)) {
    if (file.size > MAX_AUDIO_BYTES) throw new Error('Audio is larger than 4 MB (about 15 minutes). Trim it first.');
    const text = await transcribeBlob(file, language.slice(0, 2));
    return { ...base, kind: 'audio', mediaType: type || 'audio/mpeg', text, note: 'Transcribed' };
  }
  if (type.startsWith('text/') || TEXT_EXT.test(file.name) || type === 'application/json' || type === 'application/xml') {
    if (/(^|\/)\.env/i.test(file.name)) throw new Error('Environment files contain secrets and are blocked. Use /env instead.');
    let text = await file.text();
    let note: string | undefined;
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      note = 'Truncated to the first ' + MAX_TEXT_CHARS.toLocaleString() + ' characters';
    }
    return { ...base, kind: 'text', mediaType: type || 'text/plain', text, note };
  }
  throw new Error('This file type is not supported yet. Use an image, PDF, audio or text/code file (for Word or Excel, export to PDF or CSV first).');
}

/** Text attachments travel as their own text part with a marker, so the UI can show a chip instead of the content. */
export function fileTextPart(a: Attachment): string {
  return FILE_MARK + a.name + ']]\n' + (a.kind === 'audio' ? 'Transcript of audio file "' + a.name + '":\n' : '```\n') + (a.text ?? '') + (a.kind === 'audio' ? '' : '\n```');
}

export function formatBytes(n: number): string {
  return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
}
