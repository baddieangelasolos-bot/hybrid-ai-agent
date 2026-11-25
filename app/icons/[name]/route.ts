import { LOGO_SVG } from '@/lib/logo';
import { renderIcon } from '@/lib/png';

export const runtime = 'nodejs';

const SPECS: Record<string, { size: number; maskable: boolean }> = {
  'icon-192.png': { size: 192, maskable: false },
  'icon-512.png': { size: 512, maskable: false },
  'icon-maskable-512.png': { size: 512, maskable: true },
  'apple-touch-icon.png': { size: 180, maskable: true },
};

const cache = new Map<string, Buffer>();

/** Public on purpose: the browser fetches the manifest and icons before sign-in. */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await ctx.params;
  if (name === 'logo.svg') return new Response(LOGO_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
  const spec = SPECS[name];
  if (!spec) return new Response('Not found', { status: 404 });
  let png = cache.get(name);
  if (!png) {
    png = renderIcon(spec.size, spec.maskable);
    cache.set(name, png);
  }
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' } });
}
