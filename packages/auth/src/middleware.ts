import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// `requestHeaders` lets the caller forward modified request headers (e.g. the
// per-request CSP nonce) to the downstream render. Next.js reads the nonce from
// the request's Content-Security-Policy header to tag its bootstrap scripts, so
// the headers must travel via `NextResponse.next({ request: { headers } })`.
//
// After `getUser()` resolves, we forward the validated Supabase identity via
// `x-tims-auth-uid` / `x-tims-auth-email` so `createContext` can skip a second
// `getUser()` network call on the staff fast-path.
//
// Forgery defense (strip-then-set):
//  - We ALWAYS delete inbound `x-tims-auth-*` headers BEFORE getUser(), on every
//    request — even unauthenticated ones. This ensures a client-forged value is
//    wiped before it could reach the route handler.
//  - Only after getUser() validates the session do we SET the headers (inside the
//    `if (user)` block). No user = headers remain cleared = route sees null.
//
// Cookie-preservation (Trap 1):
//  - `NextResponse.next({ request: { headers } })` snapshots `headers` at call
//    time. We capture the cookiesToSet list in `setAll` (called when getUser
//    triggers a token refresh) and re-apply them to the FINAL supabaseResponse
//    after setting our auth headers. This preserves refreshed auth cookies.
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers
) {
  const headers = requestHeaders ?? new Headers(request.headers);

  // ALWAYS strip inbound forgeries before anything else.
  headers.delete('x-tims-auth-uid');
  headers.delete('x-tims-auth-email');
  headers.delete('x-tims-auth-aal'); // CB-2a: MFA assurance level is server-derived only.

  let supabaseResponse = NextResponse.next({
    request: { headers },
  });

  // Capture cookies set during a token refresh so we can re-apply them after
  // we re-create the response (Trap 1 — see module comment above).
  let capturedCookies: Array<{ name: string; value: string; options: object }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Snapshot the cookies for re-application after the final re-create.
          capturedCookies = cookiesToSet.map(({ name, value, options }) => ({
            name,
            value,
            options: options ?? {},
          }));
          supabaseResponse = NextResponse.next({
            request: { headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session - this is critical for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Forward the validated identity to the route handler via trusted headers.
  // The strip above guarantees no inbound value survived to this point.
  if (user) {
    headers.set('x-tims-auth-uid', user.id);
    headers.set('x-tims-auth-email', user.email ?? '');
    // CB-2a: forward the session's MFA assurance level so the tRPC MFA-enforcement
    // middleware can gate on it without a second call. getAuthenticatorAssuranceLevel
    // decodes the `aal` claim from the LOCAL session token (no network round-trip).
    // Fail-open on transport: default to 'aal1' if it can't be read, so a read error
    // never spuriously satisfies MFA (aal1 is fail-closed at the gate).
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      headers.set('x-tims-auth-aal', aal?.currentLevel ?? 'aal1');
    } catch {
      headers.set('x-tims-auth-aal', 'aal1');
    }
    // Re-snapshot the response WITH the new headers so the route handler sees them.
    supabaseResponse = NextResponse.next({ request: { headers } });
    // Re-apply any refresh cookies captured in setAll (Trap 1 — else they drop).
    capturedCookies.forEach(({ name, value, options }) =>
      supabaseResponse.cookies.set(name, value, options)
    );
  }

  return { supabaseResponse, user, supabase };
}
