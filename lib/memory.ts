import { storage } from './storage';
import type { MemoryFact } from './types';

const KEY = 'memory/facts';
const MAX_FACTS = 200;

export async function loadFacts(): Promise<MemoryFact[]> {
  const res = await storage.load<MemoryFact[]>(KEY);
  return Array.isArray(res.value) ? res.value : [];
}

async function persist(facts: MemoryFact[]): Promise<MemoryFact[]> {
  const trimmed = facts.slice(0, MAX_FACTS);
  await storage.save(KEY, trimmed);
  return trimmed;
}

export async function addFact(input: { id?: string; fact: string; tag?: string; ts?: number }): Promise<MemoryFact[]> {
  const facts = await loadFacts();
  const normalized = input.fact.trim().toLowerCase();
  if (facts.some((f) => f.fact.trim().toLowerCase() === normalized || (input.id !== undefined && f.id === input.id))) return facts;
  const next: MemoryFact = {
    id: input.id ?? crypto.randomUUID(),
    fact: input.fact.trim(),
    tag: input.tag ?? 'other',
    ts: input.ts ?? Date.now(),
  };
  return persist([next, ...facts]);
}

/** Edit = same id, new text (delete + add with the same id, kept in place). */
export async function updateFact(id: string, fact: string): Promise<MemoryFact[]> {
  const facts = await loadFacts();
  const text = fact.trim();
  if (!text) return facts;
  return persist(facts.map((f) => (f.id === id ? { ...f, fact: text, ts: Date.now() } : f)));
}

export async function deleteFact(id: string): Promise<MemoryFact[]> {
  const facts = await loadFacts();
  return persist(facts.filter((f) => f.id !== id));
}

export function factsForPrompt(facts: MemoryFact[], max = 10): string[] {
  return [...facts]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, max)
    .map((f) => f.fact);
}
