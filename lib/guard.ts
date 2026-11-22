import { catalogHas } from './catalog';

const GUARDS = ['meta-llama/llama-prompt-guard-2-86m', 'meta-llama/llama-prompt-guard-2-22m'];

/**
 * Screens untrusted web text with Groq's Llama Prompt Guard 2 (a tiny classifier with its own
 * generous free quota). Fails open: if the guard is unavailable the page is returned as before,
 * still wrapped as untrusted data.
 */
export async function guardText(text: string): Promise<{ flagged: boolean; score: number | null; model: string | null }> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return { flagged: false, score: null, model: null };
  const sample = text.slice(0, 1800);
  for (const model of GUARDS) {
    if (!catalogHas('groq', model)) continue;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: sample }], max_tokens: 8, temperature: 0 }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = data.choices?.[0]?.message?.content ?? '';
      const score = Number.parseFloat(raw);
      if (Number.isFinite(score)) return { flagged: score >= 0.95, score, model };
      return { flagged: /injection|jailbreak/i.test(raw), score: null, model };
    } catch {
      /* try the next guard */
    }
  }
  return { flagged: false, score: null, model: null };
}
