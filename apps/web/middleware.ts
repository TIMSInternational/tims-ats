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
];

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);

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
    return NextResponse.redirect(loginUrl);
  }

  // Redirect logged-in users away from auth pages
  if (isPublicPath && user && pathname !== '/auth/callback') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo_tims.png).*)'],
};
