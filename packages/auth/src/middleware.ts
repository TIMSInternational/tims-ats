import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// `requestHeaders` lets the caller forward modified request headers (e.g. the
// per-request CSP nonce) to the downstream render. Next.js reads the nonce from
// the request's Content-Security-Policy header to tag its bootstrap scripts, so
// the headers must travel via `NextResponse.next({ request: { headers } })`.
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers
) {
  const headers = requestHeaders ?? new Headers(request.headers);

  let supabaseResponse = NextResponse.next({
    request: { headers },
  });

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

  return { supabaseResponse, user, supabase };
}
