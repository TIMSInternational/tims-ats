import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@tims/auth/middleware';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/auth/confirm',
  '/careers',
  // Candidate AI voice-interview magic-link is unauthenticated — the candidateToken
  // in the URL is the bearer credential (verified server-side). Must be public or
  // the candidate gets bounced to /login and never reaches the consent/voice screen.
  '/ai-interview',
  '/logout',
];

const IS_PROD = process.env.NODE_ENV === 'production';

// Per-request, nonce-based Content-Security-Policy. In production the nonce
// replaces 'unsafe-inline' on script-src (Next.js stamps the same nonce onto
// its bootstrap scripts via the request CSP header), shrinking the XSS surface.
// Dev keeps 'unsafe-inline'/'unsafe-eval' so Turbopack/HMR's inline scripts run.
// style-src keeps 'unsafe-inline' (Tailwind/Next inject inline styles); dropping
// it needs hashing and is out of scope here.
function buildCsp(nonce: string): string {
  const scriptSrc = IS_PROD
    ? `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://*.cloudfront.net",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com https://login.microsoftonline.com https://*.daily.co wss://*.daily.co https://*.wss.daily.co https://*.elevenlabs.io wss://*.elevenlabs.io https://*.livekit.cloud wss://*.livekit.cloud https://challenges.cloudflare.com https://*.sentry.io",
    "frame-src 'self' https://accounts.google.com https://login.microsoftonline.com https://*.daily.co https://challenges.cloudflare.com",
    "media-src 'self' blob: https://*.daily.co https://*.elevenlabs.io",
    // ElevenLabs Conversational AI loads its audio-processing AudioWorklet from a
    // blob URL; without worker-src blob: the live voice call fails to initialise.
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
  ].join('; ');
}

export async function middleware(request: NextRequest) {
  // base64 nonce from a CSPRNG (Web Crypto is available in the Edge runtime).
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // Forward the nonce + CSP on the REQUEST so Next stamps its inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const { supabaseResponse, user } = await updateSession(request, requestHeaders);

  // Mirror the CSP onto every response we return (including redirects).
  const applyCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set('content-security-policy', csp);
    return res;
  };
  applyCsp(supabaseResponse);

  const hostname = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;

  // Allow public paths without auth
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isStaticAsset = pathname.startsWith('/_next') || pathname.startsWith('/favicon');
  const isApiRoute = pathname.startsWith('/api/');

  if (isStaticAsset || isApiRoute) return supabaseResponse;

  // Extract subdomain
  const parts = hostname.split('.');
  const subdomain = parts.length >= 2 ? parts[0] : null;

  // Portal routes ({client}.tims.com) — handled separately
  if (subdomain && subdomain !== 'app' && subdomain !== 'localhost' && subdomain !== 'www') {
    supabaseResponse.headers.set('x-org-slug', subdomain);
    return supabaseResponse;
  }

  // Admin routes (app.tims.com or localhost)
  if (!isPublicPath && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return applyCsp(NextResponse.redirect(loginUrl));
  }

  // Redirect logged-in users away from the STAFF auth pages only. The candidate
  // portal (/careers/*) is intentionally excluded: a candidate has a Supabase
  // session and must stay in the portal (e.g. /careers/[org]/me) rather than be
  // bounced into the staff app. /auth/* (callback/confirm) is also excluded.
  const STAFF_AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];
  if (user && STAFF_AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    return applyCsp(NextResponse.redirect(new URL('/', request.url)));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo_tims.png|auth-hero.png|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)'],
};
