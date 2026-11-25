'use client';

import type { UIMessage } from 'ai';
import { storage } from './storage';

export interface ThreadMeta {
  id: string;
  title: string;
  updatedAt: number;
  preview?: string;
  agent?: string;
  branchOf?: string;
  pinned?: boolean;
}

export const THREAD_INDEX_KEY = 'threads/index';
export const threadKey = (id: string) => 'threads/' + id;

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

interface PartLike {
  type: string;
  text?: string;
  url?: string;
  filename?: string;
  mediaType?: string;
  output?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Keeps saved chats small so Drive sync stays fast: big attachments and generated images are not
 * stored (the chat keeps a placeholder). Small images and all text are kept.
 */
export function compactForSave(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: (m.parts as unknown as PartLike[])
      .filter((p) => p.type !== 'reasoning' && p.type !== 'step-start')
      .map((p) => {
        if (p.type === 'file' && typeof p.url === 'string' && p.url.length > 120_000) {
          return { type: 'text', text: '[attachment not stored: ' + (p.filename ?? p.mediaType ?? 'file') + ']' };
        }
        if (p.type.startsWith('tool-') && p.output && typeof p.output.dataUrl === 'string' && p.output.dataUrl.length > 120_000) {
          return { ...p, output: { ...p.output, dataUrl: '', expired: true } };
        }
        return p;
      }) as unknown as UIMessage['parts'],
  }));
}

export function titleFrom(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const text = ((first?.parts ?? []) as unknown as PartLike[]).map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join(' ').replace(/\s+/g, ' ').trim();
  const clean = text.replace(/^\/[a-z-]+\s+/i, '') || text;
  return clean ? (clean.length > 48 ? clean.slice(0, 48) + '...' : clean) : 'New chat';
}

export function previewFrom(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = ((messages[i].parts ?? []) as unknown as PartLike[]).map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join(' ').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 90);
  }
  return '';
}

export async function listThreads(): Promise<ThreadMeta[]> {
  const r = await storage.load<ThreadMeta[]>(THREAD_INDEX_KEY);
  return (r.value ?? []).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
}

export async function loadThread(id: string): Promise<UIMessage[]> {
  const r = await storage.load<UIMessage[]>(threadKey(id));
  return r.value ?? [];
}
