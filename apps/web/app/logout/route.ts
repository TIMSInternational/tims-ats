import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Sign out the current Supabase session server-side, then bounce to /login. This is
// the non-looping exit for an authenticated session that is NOT a linked staff user
// (e.g. a candidate who navigated to /admin) — see (admin)/layout.tsx. Redirecting
// such a session straight to /login would loop (middleware bounces a logged-in user
// off /login → / → /dashboard → back to the guard); clearing the session first
// breaks that cycle.
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  await supabase.auth.signOut();
  return response;
}
