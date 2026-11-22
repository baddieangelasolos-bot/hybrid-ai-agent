import { generateText } from 'ai';
import { requireAuth } from '@/lib/auth';
import { catalogHas, loadCatalog } from '@/lib/catalog';
import { classifyModelError, createFailoverModel, describeShort, getChain, markFailure, markSuccess } from '@/lib/failover';
import { errMsg, json } from '@/lib/http';
import { redactSecrets } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const WHISPER = ['whisper-large-v3-turbo', 'whisper-large-v3'];

/** Speech to text: Groq Whisper first (free, 99 languages), Gemini audio understanding as fallback. */
export async function POST(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, message: 'Send the audio as multipart form data.' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, message: 'No audio received.' }, 400);
  if (file.size > MAX_BYTES) return json({ ok: false, message: 'Audio is too large (limit 4 MB, about 15 minutes of speech).' }, 413);
  const language = String(form.get('language') ?? '').slice(0, 2).toLowerCase();
  const failures: string[] = [];

  if (process.env.GROQ_API_KEY) {
    await loadCatalog('groq').catch(() => undefined);
    for (const model of WHISPER) {
      if (!catalogHas('groq', model)) continue;
      try {
        const fd = new FormData();
        fd.append('file', file, file.name || 'audio.webm');
        fd.append('model', model);
        fd.append('response_format', 'json');
        fd.append('temperature', '0');
        if (/^[a-z]{2}$/.test(language)) fd.append('language', language);
        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
          body: fd,
          signal: AbortSignal.timeout(40000),
        });
        if (!res.ok) throw Object.assign(new Error(await res.text()), { statusCode: res.status });
        const data = (await res.json()) as { text?: string };
        markSuccess('groq:' + model, res.headers);
        return json({ ok: true, text: (data.text ?? '').trim(), engine: 'Groq ' + model });
      } catch (e) {
        const info = classifyModelError(e);
        markFailure('groq:' + model, info);
        failures.push(model + ': ' + describeShort(info));
      }
    }
  }

  const chain = getChain({ agent: 'vision', docs: true });
  if (chain.nodes.length > 0) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await generateText({
        model: createFailoverModel(chain.nodes, { effort: 'low', ttftMs: 40000 }),
        maxRetries: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this audio exactly in the language spoken. Output only the transcript.' },
              { type: 'file', data: bytes, mediaType: file.type || 'audio/webm' },
            ],
          },
        ],
      });
      return json({ ok: true, text: result.text.trim(), engine: 'Gemini audio' });
    } catch (e) {
      failures.push('Gemini: ' + redactSecrets(errMsg(e)).slice(0, 120));
    }
  }
  return json({ ok: false, message: 'Could not transcribe. ' + (failures.join(' | ') || 'Set GROQ_API_KEY (free) for Whisper speech-to-text.') }, 502);
}
