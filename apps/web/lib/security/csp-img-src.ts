// The image hosts the Content-Security-Policy `img-src` directive allows (besides 'self', data: and
// blob:). Single source of truth: `buildCsp` (csp.ts) emits exactly this list, and the branding
// settings + every org-logo render check a URL against it, so a logo the browser would block is
// refused at save time and never rendered as a broken image.
export const CSP_IMG_SRC_HOSTS = [
  'https://*.supabase.co',
  'https://*.googleusercontent.com',
  'https://*.cloudfront.net',
] as const;

function hostMatches(hostname: string, source: string): boolean {
  const pattern = source.replace(/^https:\/\//, '');
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".supabase.co"
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
}

/**
 * True when the browser would load the absolute URL `url` under img-src from an allowed external
 * host. Only https URLs qualify: http:// is mixed content and does not match the https host sources
 * above. ('self' is deliberately not considered: an organization logo is never one of our own
 * assets, and the answer must be the same on the server and in the browser.)
 */
export function isCspAllowedImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  const hostname = parsed.hostname.toLowerCase();
  return CSP_IMG_SRC_HOSTS.some((source) => hostMatches(hostname, source));
}
