/** Hybrid AI Agent emblem as one SVG string (server and client safe). Single source for the favicon, header emblem and /icons/logo.svg. */

const R = 150;
const CX = 256;
const CY = 256;
const hex = [-90, -30, 30, 90, 150, 210].map((d) => {
  const a = (d * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)] as const;
});
const pts = hex.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
const nodes = [hex[0], hex[2], hex[4]];

export function logoSvg(prefix = 'hya'): string {
  const id = (n: string) => prefix + '-' + n;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" role="img" aria-label="Hybrid AI Agent">' +
    '<defs>' +
    '<radialGradient id="' + id('bg') + '" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#1d2866"/><stop offset=".55" stop-color="#0c1131"/><stop offset="1" stop-color="#05070f"/></radialGradient>' +
    '<linearGradient id="' + id('ring') + '" x1="100" y1="90" x2="412" y2="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#22d3ee"/><stop offset=".5" stop-color="#6366f1"/><stop offset="1" stop-color="#d946ef"/></linearGradient>' +
    '<filter id="' + id('glow') + '" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>' +
    '</defs>' +
    '<rect width="512" height="512" rx="112" fill="url(#' + id('bg') + ')"/>' +
    '<polygon points="' + pts + '" fill="none" stroke="url(#' + id('ring') + ')" stroke-width="34" stroke-linejoin="round" filter="url(#' + id('glow') + ')" opacity=".7"/>' +
    '<polygon points="' + pts + '" fill="none" stroke="url(#' + id('ring') + ')" stroke-width="20" stroke-linejoin="round"/>' +
    nodes.map(([x, y]) => '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="30" fill="#67e8f9" opacity=".35" filter="url(#' + id('glow') + ')"/><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="15" fill="#fff"/>').join('') +
    '<path d="M256 160 C263 224 288 249 352 256 C288 263 263 288 256 352 C249 288 224 263 160 256 C224 249 249 224 256 160Z" fill="#fff" filter="url(#' + id('glow') + ')" opacity=".6"/>' +
    '<path d="M256 168 C262 224 288 250 344 256 C288 262 262 288 256 344 C250 288 224 262 168 256 C224 250 250 224 256 168Z" fill="#fff"/>' +
    '</svg>'
  );
}

export const LOGO_SVG = logoSvg('hya');
