import { errMsg } from './http';
import { redactSecrets } from './security';

export type Aspect = 'square' | 'portrait' | 'landscape';

export interface ImageProviderInfo {
  id: string;
  label: string;
  model: string;
  env: string[];
  configured: boolean;
  note: string;
}

export interface ImageOk {
  ok: true;
  provider: string;
  model: string;
  mediaType: string;
  dataUrl: string;
}
export interface ImageFail {
  ok: false;
  error: string;
}

const SIZE: Record<Aspect, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 768, height: 1024 },
  landscape: { width: 1024, height: 768 },
};

const MAX_BYTES = 3 * 1024 * 1024;

interface Provider {
  id: string;
  label: string;
  model: string;
  env: string[];
  note: string;
  run: (prompt: string, aspect: Aspect) => Promise<{ bytes: Uint8Array; mediaType: string }>;
}

function sniff(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  return '';
}

async function asImage(res: Response): Promise<{ bytes: Uint8Array; mediaType: string }> {
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + redactSecrets((await res.text()).slice(0, 160)));
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    const data = (await res.json()) as { result?: { image?: string }; image?: string };
    const b64 = data.result?.image ?? data.image;
    if (!b64) throw new Error('No image in response');
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    return { bytes, mediaType: sniff(bytes) || 'image/png' };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mediaType = sniff(bytes);
  if (!mediaType) throw new Error('Response was not an image');
  return { bytes, mediaType };
}

const cf = () => ({ acct: process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '', token: process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '' });

async function cloudflare(model: string, body: Record<string, unknown>): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const { acct, token } = cf();
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts/' + acct + '/ai/run/' + model, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  return asImage(res);
}

async function huggingFace(model: string, prompt: string, aspect: Aspect): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const s = SIZE[aspect];
  const res = await fetch('https://router.huggingface.co/hf-inference/models/' + model, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.HF_TOKEN, 'Content-Type': 'application/json', Accept: 'image/png' },
    body: JSON.stringify({ inputs: prompt, parameters: { width: s.width, height: s.height } }),
    signal: AbortSignal.timeout(60000),
  });
  return asImage(res);
}

const PROVIDERS: Provider[] = [
  {
    id: 'cloudflare-flux',
    label: 'Cloudflare Workers AI',
    model: 'FLUX.1 schnell',
    env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    note: 'Best free quality. Generous daily free allowance.',
    run: (prompt) => cloudflare('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 6 }),
  },
  {
    id: 'cloudflare-sdxl',
    label: 'Cloudflare Workers AI',
    model: 'SDXL Lightning',
    env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    note: 'Fast second option on the same Cloudflare key.',
    run: (prompt, aspect) => cloudflare('@cf/bytedance/stable-diffusion-xl-lightning', { prompt, width: SIZE[aspect].width, height: SIZE[aspect].height }),
  },
  {
    id: 'hf-flux',
    label: 'Hugging Face',
    model: 'FLUX.1 schnell',
    env: ['HF_TOKEN'],
    note: 'Free monthly credits with a free token.',
    run: (prompt, aspect) => huggingFace('black-forest-labs/FLUX.1-schnell', prompt, aspect),
  },
  {
    id: 'hf-sdxl',
    label: 'Hugging Face',
    model: 'SDXL base 1.0',
    env: ['HF_TOKEN'],
    note: 'Second Hugging Face model.',
    run: (prompt, aspect) => huggingFace('stabilityai/stable-diffusion-xl-base-1.0', prompt, aspect),
  },
  {
    id: 'pollinations',
    label: 'Pollinations',
    model: 'FLUX',
    env: [],
    note: 'No key needed. Last resort: quality and speed vary.',
    run: async (prompt, aspect) => {
      const s = SIZE[aspect];
      const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?model=flux&nologo=true&width=' + s.width + '&height=' + s.height + '&seed=' + Math.floor(Math.random() * 1e6);
      const headers: Record<string, string> = {};
      if (process.env.POLLINATIONS_TOKEN) headers.Authorization = 'Bearer ' + process.env.POLLINATIONS_TOKEN;
      return asImage(await fetch(url, { headers, signal: AbortSignal.timeout(50000) }));
    },
  },
];

export function imageProviders(): ImageProviderInfo[] {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, model: p.model, env: p.env, note: p.note, configured: p.env.every((e) => Boolean(process.env[e]?.trim())) }));
}

/** Tries each configured generator in order and returns the first image. */
export async function generateImage(prompt: string, aspect: Aspect): Promise<(ImageOk | ImageFail) & { attempts: string[] }> {
  const attempts: string[] = [];
  for (const p of PROVIDERS) {
    if (!p.env.every((e) => Boolean(process.env[e]?.trim()))) continue;
    try {
      const { bytes, mediaType } = await p.run(prompt, aspect);
      if (bytes.length > MAX_BYTES) {
        attempts.push(p.label + ' ' + p.model + ': image too large');
        continue;
      }
      return { ok: true, provider: p.label, model: p.model, mediaType, dataUrl: 'data:' + mediaType + ';base64,' + Buffer.from(bytes).toString('base64'), attempts };
    } catch (e) {
      attempts.push(p.label + ' ' + p.model + ': ' + redactSecrets(errMsg(e)).slice(0, 140));
    }
  }
  const hasPaid = imageProviders().some((p) => p.env.length > 0 && p.configured);
  return {
    ok: false,
    error: 'No image generator could produce this image. ' + attempts.join(' | ') + (hasPaid ? '' : ' Add CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free) for reliable image generation.'),
    attempts,
  };
}
