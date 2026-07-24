import { stripTrpcJson, buildTrpcQueryUrl } from './trpc';

// ── Auth-mechanism investigation (Task 6, Step 1) ──────────────────────────
//
// C# side (confirmed): every REST endpoint authenticates via a plain
// `Authorization: Bearer <supabase access_token>` header — `callCsharp` below
// matches that directly.
//
// TS side (investigated 2026-07-24, reading `packages/auth/src/{server,middleware}.ts`
// + `apps/web/app/api/trpc/[trpc]/route.ts`): the Next.js tRPC route is
// **cookie-only** — there is NO Authorization-header code path anywhere in the
// auth stack.
//   - `apps/web/middleware.ts` -> `packages/auth/src/middleware.ts` `updateSession()`
//     builds a Supabase `createServerClient` whose `cookies.getAll()` reads
//     `request.cookies.getAll()` and calls `supabase.auth.getUser()`. Only a
//     *validated* identity is forwarded (via the trusted `x-tims-auth-uid` /
//     `x-tims-auth-email` headers) to the tRPC context builder.
//   - `apps/web/app/api/trpc/[trpc]/route.ts` `createContext()` either takes
//     that trusted-header fast path, or falls back to
//     `createSupabaseServerClient()` (`packages/auth/src/server.ts`), which
//     also reads cookies exclusively via `cookies()` (`next/headers`) and
//     calls `supabase.auth.getUser()`.
//   - Both `createServerClient` cookie adapters only ever call `getAll()` /
//     `getUser()` against `sb-<project-ref>-auth-token` (chunked as
//     `.0`, `.1`, ... by `@supabase/ssr` once >4KB) — never `req.headers.get('authorization')`.
//
// The Supabase session cookie's value is a JSON-serialized `base64-`-prefixed
// base64url **session envelope** (`access_token`, `refresh_token`, `expires_at`,
// `expires_in`, `token_type`, `user`), chunked into `.0`/`.1` past ~3180 bytes
// by `@supabase/ssr` — NOT a bare access token. So `callTs` sends a `Cookie:`
// header, NOT `Authorization: Bearer`. The cookie is built by `getSessionCookie`
// (`scripts/parity/supabase.ts`), which signs the seeded user in through the
// app's own `@supabase/ssr` `createServerClient` encoder (capturing `setAll`),
// making the emitted `sb-<ref>-auth-token` cookie byte-identical to what the
// Next.js app writes and reads.
//
// LIVE-VERIFIED (2026-07-24) against the prod TS app (tims-ats.vercel.app),
// `teamIntel.getDashboardKpis`: super_admin cookie → 200, hrbp cookie → 403
// ("No tienes permiso…"), no cookie → 401 (UNAUTHORIZED). So a valid cookie
// authenticates and RBAC is enforced — TS-side parity results are trustworthy.
type Fetch = typeof fetch;

export async function callCsharp(
  base: string,
  path: string,
  token: string,
  fetchFn: Fetch = fetch
): Promise<{ status: number; body: unknown }> {
  const res = await fetchFn(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!text) return { status: res.status, body: null };
  // A non-2xx (or misconfigured) response can come back as an HTML/plain-text
  // error page rather than JSON — e.g. a 403/404/500 from a proxy or the
  // framework's default error page. Status-only checks (RLS/RBAC) still need a
  // usable `status` in that case, so fall back to the raw text instead of
  // throwing a raw `SyntaxError` out of this caller.
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

export async function callTs(
  base: string,
  procedure: string,
  input: unknown,
  cookie: string,
  fetchFn: Fetch = fetch
): Promise<unknown> {
  const url = buildTrpcQueryUrl(base, procedure, input);
  // Cookie auth (sb-<ref>-auth-token) — the TS Next.js app is cookie-only; see
  // the module-level note above. `cookie` comes from `getSessionCookie`.
  const res = await fetchFn(url, { headers: { Cookie: cookie } });
  const body: unknown = await res.json();
  return stripTrpcJson(body);
}
