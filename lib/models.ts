/**
 * Single source of truth for every model the app can use.
 * Chains per agent live in lib/agents.ts and refer to models by key ("provider:id").
 * Every chain entry is checked at runtime against the provider's live model catalog
 * (a free call that uses no tokens), so a retired or misspelled id is skipped, never fatal.
 */

export type Provider = 'groq' | 'gemini' | 'openrouter';
export type Tier = 'frontier' | 'strong' | 'fast' | 'tiny';
export type ReasoningKind = 'gemini' | 'gpt-oss' | 'qwen' | 'none';

export interface ModelDef {
  key: string;
  provider: Provider;
  id: string;
  label: string;
  tier: Tier;
  vision: boolean;
  /** PDF, audio and video understanding. */
  docs: boolean;
  tools: boolean;
  ctx: number;
  maxOut: number;
  /** Free-plan input budget per minute. Requests that would not fit skip the model. */
  inTpm?: number;
  reasoning: ReasoningKind;
  free: string;
  best: string;
}

const k = (provider: Provider, id: string) => provider + ':' + id;

function def(p: Omit<ModelDef, 'key'>): ModelDef {
  return { ...p, key: k(p.provider, p.id) };
}

export const MODELS: ModelDef[] = [
  /* ------------------------------- Google AI Studio ------------------------------- */
  def({ provider: 'gemini', id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', tier: 'frontier', vision: true, docs: true, tools: true, ctx: 1_000_000, maxOut: 65536, reasoning: 'gemini', free: 'Free tier (only Gemini 4 model that is free)', best: 'Hardest coding, agents, long documents' }),
  def({ provider: 'gemini', id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'strong', vision: true, docs: true, tools: true, ctx: 1_000_000, maxOut: 65536, reasoning: 'gemini', free: 'Free tier', best: 'Strong all-rounder, writing, coding' }),
  def({ provider: 'gemini', id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', tier: 'strong', vision: true, docs: true, tools: true, ctx: 1_000_000, maxOut: 65536, reasoning: 'gemini', free: 'Free via API', best: 'Solid mid-tier coding and tool use' }),
  def({ provider: 'gemini', id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', tier: 'strong', vision: true, docs: true, tools: true, ctx: 1_000_000, maxOut: 65536, reasoning: 'gemini', free: 'Free via API', best: 'Reliable older fallback' }),
  def({ provider: 'gemini', id: 'gemma-4-31b-it', label: 'Gemma 4 31B', tier: 'strong', vision: true, docs: false, tools: true, ctx: 256_000, maxOut: 8192, reasoning: 'none', free: 'Free only (open weights)', best: 'Math, logic and code for its size' }),
  def({ provider: 'gemini', id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B MoE', tier: 'fast', vision: true, docs: false, tools: true, ctx: 256_000, maxOut: 8192, reasoning: 'none', free: 'Free only (open weights)', best: 'Fast open-weight answers' }),
  def({ provider: 'gemini', id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', tier: 'fast', vision: true, docs: true, tools: true, ctx: 1_000_000, maxOut: 65536, reasoning: 'gemini', free: 'Free tier', best: 'High-volume, low-latency tasks' }),
  def({ provider: 'gemini', id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', tier: 'tiny', vision: true, docs: true, tools: true, ctx: 1_000_000, maxOut: 65536, reasoning: 'gemini', free: 'Free tier', best: 'Last-resort lightweight' }),

  /* ------------------------------------ Groq ------------------------------------ */
  def({ provider: 'groq', id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', tier: 'frontier', vision: false, docs: false, tools: true, ctx: 131_072, maxOut: 2048, inTpm: 8000, reasoning: 'gpt-oss', free: '30 req/min, 1K req/day, 8K tokens/min', best: 'Lead orchestrator: fast reasoning and tool use' }),
  def({ provider: 'groq', id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', tier: 'strong', vision: true, docs: false, tools: true, ctx: 131_072, maxOut: 2048, inTpm: 8000, reasoning: 'qwen', free: '30 req/min, 1K req/day, 8K tokens/min', best: 'Multilingual, vision, coding' }),
  def({ provider: 'groq', id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', tier: 'fast', vision: false, docs: false, tools: true, ctx: 131_072, maxOut: 2048, inTpm: 8000, reasoning: 'gpt-oss', free: '30 req/min, 1K req/day, 8K tokens/min', best: 'Very fast everyday answers' }),
  def({ provider: 'groq', id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', tier: 'strong', vision: false, docs: false, tools: true, ctx: 131_072, maxOut: 2048, inTpm: 6000, reasoning: 'none', free: 'Only if your Groq plan still lists it', best: 'General quality fallback' }),
  def({ provider: 'groq', id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', tier: 'tiny', vision: false, docs: false, tools: true, ctx: 131_072, maxOut: 2048, inTpm: 6000, reasoning: 'none', free: 'Free plan, own quota pool', best: 'Instant replies, last-resort fallback' }),

  /* --------------------------------- OpenRouter --------------------------------- */
  def({ provider: 'openrouter', id: 'openai/gpt-oss-120b:free', label: 'OpenRouter free model', tier: 'strong', vision: false, docs: false, tools: true, ctx: 131_072, maxOut: 2048, reasoning: 'none', free: 'Free models, about 50 req/day', best: 'Third provider if Google and Groq are both out' }),
];

export const MODEL_BY_KEY: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.key, m]));

export interface SpecialModel {
  id: string;
  provider: Provider;
  label: string;
  role: string;
  note: string;
}

/** Non-chat models: used by dedicated server features, not by the chat chains. */
export const SPECIAL_MODELS: SpecialModel[] = [
  { id: 'whisper-large-v3-turbo', provider: 'groq', label: 'Whisper Large v3 Turbo', role: 'Voice and audio transcription (first choice)', note: 'Fast speech-to-text, 99 languages including Bengali' },
  { id: 'whisper-large-v3', provider: 'groq', label: 'Whisper Large v3', role: 'Transcription fallback', note: 'Most accurate Whisper' },
  { id: 'meta-llama/llama-prompt-guard-2-86m', provider: 'groq', label: 'Llama Prompt Guard 2 86M', role: 'Blocks prompt-injection in web pages', note: 'Screens every page the Researcher reads' },
  { id: 'meta-llama/llama-prompt-guard-2-22m', provider: 'groq', label: 'Llama Prompt Guard 2 22M', role: 'Prompt guard fallback', note: 'Smaller, faster guard' },
  { id: 'openai/gpt-oss-safeguard-20b', provider: 'groq', label: 'GPT-OSS Safeguard 20B', role: 'Policy classifier (reserved)', note: 'Available for custom safety rules' },
  { id: 'canopylabs/orpheus-v1-english', provider: 'groq', label: 'Orpheus English', role: 'Text-to-speech (reserved)', note: 'Needs one-time terms acceptance in the Groq console' },
  { id: 'canopylabs/orpheus-arabic-saudi', provider: 'groq', label: 'Orpheus Arabic', role: 'Text-to-speech (reserved)', note: 'Needs one-time terms acceptance in the Groq console' },
];

export const PROVIDER_LABEL: Record<Provider, string> = { groq: 'Groq', gemini: 'Google AI Studio', openrouter: 'OpenRouter' };
export const PROVIDER_ENV: Record<Provider, string> = { groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

export function providerConfigured(p: Provider): boolean {
  return Boolean(process.env[PROVIDER_ENV[p]]?.trim());
}
