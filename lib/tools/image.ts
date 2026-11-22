import { tool } from 'ai';
import { z } from 'zod';
import { generateImage } from '../image';

export const generateImageTool = tool({
  description: 'Generate an image from a detailed English prompt using free image models with automatic fallback. The image is shown to the user directly.',
  inputSchema: z.object({
    prompt: z.string().min(4).max(900).describe('Rich English prompt: subject, style, lighting, composition, mood'),
    aspect: z.enum(['square', 'portrait', 'landscape']).default('square'),
  }),
  execute: async ({ prompt, aspect }) => {
    const r = await generateImage(prompt, aspect);
    return r.ok ? { ok: true as const, prompt, provider: r.provider, model: r.model, mediaType: r.mediaType, dataUrl: r.dataUrl } : { ok: false as const, error: r.error };
  },
  toModelOutput: ({ output }) => {
    const o = output as { ok: boolean; provider?: string; model?: string; error?: string };
    return { type: 'text', value: o.ok ? 'Image generated with ' + o.provider + ' ' + o.model + ' and already displayed to the user.' : 'Image generation failed: ' + o.error };
  },
});
