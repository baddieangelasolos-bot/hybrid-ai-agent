import type { Persona } from './types';

export const PERSONAS: Record<Persona, { label: string; overlay: string }> = {
  default: { label: 'Balanced', overlay: 'Be direct, warm and practical. Match the length of your answer to the question.' },
  coder: {
    label: 'Coder',
    overlay: 'Act as a senior engineer. Prefer working code, explain trade-offs briefly, and delegate multi-file work to the coder worker.',
  },
  researcher: {
    label: 'Researcher',
    overlay: 'Verify claims with webSearch and readWebPage before answering factual questions. Cite the source URL for every external fact.',
  },
  concise: { label: 'Concise', overlay: 'Answer in as few words as possible. No preamble, no recap.' },
};

export function normalizePersona(value: unknown): Persona {
  return value === 'coder' || value === 'researcher' || value === 'concise' ? value : 'default';
}

export function getPersonaOverlay(persona: Persona): string {
  return PERSONAS[persona].overlay;
}
