import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export type Provider = 'groq' | 'gemini' | 'openrouter';
export type ChainKind = 'orchestrator' | 'coder';

export interface ModelNode {
  provider: Provider;
  modelId: string;
  label: string;
  vision: boolean;
  create: () => LanguageModel;
}

function nodeFor(provider: Provider): ModelNode | null {
  if (provider === 'groq') {
    const key = process.env.GROQ_API_KEY;
    if (!key) return null;
    const id = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    return { provider, modelId: id, label: 'Groq / ' + id, vision: false, create: () => createGroq({ apiKey: key })(id) };
  }
  if (provider === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    const id = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    return { provider, modelId: id, label: 'Gemini / ' + id, vision: true, create: () => createGoogleGenerativeAI({ apiKey: key })(id) };
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const id = process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free';
  return {
    provider,
    modelId: id,
    label: 'OpenRouter / ' + id,
    vision: false,
    create: () => createOpenAICompatible({ name: 'openrouter', apiKey: key, baseURL: 'https://openrouter.ai/api/v1' }).chatModel(id),
  };
}

const ORDER: Record<ChainKind, Provider[]> = {
  orchestrator: ['groq', 'gemini', 'openrouter'],
  coder: ['gemini', 'openrouter', 'groq'],
};

/** Models that are configured (have an API key), in failover order. */
export function getChain(kind: ChainKind, needsVision = false): ModelNode[] {
  const nodes: ModelNode[] = [];
  for (const p of ORDER[kind]) {
    const n = nodeFor(p);
    if (n && (!needsVision || n.vision)) nodes.push(n);
  }
  return nodes;
}

export function pickNode(chain: ModelNode[], index: number): ModelNode | null {
  if (chain.length === 0) return null;
  const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return chain[i % chain.length];
}
