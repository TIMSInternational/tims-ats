import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@tims/auth/middleware';
import { buildCsp, originOf, s3PresignedPostOrigin, type CspOrigins } from './lib/security/csp';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/auth/confirm',
  '/accept-invitation',
  '/careers',
  // Candidate AI voice-interview magic-link is unauthenticated — the candidateToken
  // in the URL is the bearer credential (verified server-side). Must be public or
  // the candidate gets bounced to /login and never reaches the consent/voice screen.
  '/ai-interview',
  // Candidate offer e-signature link (/offers/sign/[token]): the signing token is
  // the bearer credential (offer.getBySigningToken / acceptByToken /
  // declineByToken are public procedures). A candidate has no staff session, so
  // this must never bounce to staff /login — regardless of which host serves it.
  '/offers/sign',
  '/logout',
];

const IS_PROD = process.env.NODE_ENV === 'production';

// Build-time-stable origins added to connect-src; each is '' (dark) when its env
// is unset, so the CSP gains nothing until the backend is actually configured.
const CSP_ORIGINS: CspOrigins = {
  // C# Platform API origin (App Runner) the browser fetches directly once a read
  // surface is cut over (see lib/platform-api).
  platformApi: originOf(process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL),
  // CV S3 bucket the careers apply form POSTs to (presigned POST from
  // packages/api/src/lib/s3.ts). Same bucket/region resolution as s3.ts.
  cvUpload: s3PresignedPostOrigin(
    process.env.CV_UPLOADS_BUCKET,
    process.env.CV_UPLOADS_REGION || process.env.AWS_REGION,
  ),
};

// A path is public when it IS one of PUBLIC_PATHS or is nested under one
// (segment-aware: '/offers/sign' does not make '/offers/signatures' public).
function isPublicPathname(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  // base64 nonce from a CSPRNG (Web Crypto is available in the Edge runtime).
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, request.nextUrl.pathname, CSP_ORIGINS, IS_PROD);

  // Forward the nonce + CSP on the REQUEST so Next stamps its inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const { supabaseResponse, user } = await updateSession(request, requestHeaders);

  // Mirror the CSP onto every response we return (including redirects).
  const applyCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set('content-security-policy', csp);
    if (request.nextUrl.pathname === '/accept-invitation' || request.nextUrl.pathname === '/reset-password') {
      res.headers.set('referrer-policy', 'no-referrer');
      res.headers.set('cache-control', 'no-store');
    }
    return res;
  };
  applyCsp(supabaseResponse);

  const hostname = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;

  // Allow public paths without auth
  const isPublicPath = isPublicPathname(pathname);
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
  // session and must stay in the portal (e.g. /careers/[org]/dashboard) rather than be
  // bounced into the staff app. /auth/* (callback/confirm) is also excluded.
  const STAFF_AUTH_PAGES = ['/login', '/register', '/forgot-password'];
  if (user && STAFF_AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    return applyCsp(NextResponse.redirect(new URL('/', request.url)));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // All non-API, non-static routes (asset extensions excluded by the negative lookahead).
    '/((?!_next/static|_next/image|favicon.ico|logo_tims.png|auth-hero.png|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
    // Security: ALWAYS run middleware for every /api/ path regardless of suffix so
    // the auth fast-path's x-tims-auth-* strip-then-set cannot be bypassed via an
    // asset-extension-shaped tRPC batch URL (e.g. /api/trpc/proc,x.svg?batch=1).
    // The asset-extension exclusions in the entry above must NOT apply under /api.
    '/api/:path*',
  ],
};
