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
// The Supabase session cookie's value is a JSON-serialized (optionally
// base64url-with-`base64-`-prefix-encoded) **session envelope**
// (`access_token`, `refresh_token`, `expires_at`, `expires_in`, `token_type`,
// `user`), NOT a bare access token. The harness's `getToken()`
// (`scripts/parity/supabase.ts`, Task 4) only returns `session.access_token`
// as a plain string — it discards `refresh_token`/`user`/`expires_at` — so
// there isn't enough information at this call site to construct a valid
// `sb-<ref>-auth-token` cookie value. Producing one would require changing
// `getToken`'s return shape (and threading `projectRef` into every caller),
// which is out of scope for this task's given `(base, procedure, input,
// token, fetchFn?)` signature.
//
// Per the task brief's documented escape hatch: `callTs` below sends
// `Authorization: Bearer <token>` (mirroring `callCsharp`) rather than a
// cookie. THIS HEADER IS NOT READ BY THE CURRENT TS AUTH STACK, so `callTs`
// will resolve to an unauthenticated context (`ctx.user === null`) against
// the real Next.js app as it exists today. This is flagged for **live
// verification at Task 11**: either (a) extend `getToken`/`HarnessConfig` to
// carry the full session + `projectRef` and switch `callTs` to send a
// `Cookie: sb-${projectRef}-auth-token=<encoded session>` header, or (b) add
// a bearer-token auth path to the TS tRPC context (out of scope here — a
// product change, not a harness change). Do not treat TS-side parity
// results as authenticated until one of those is resolved.
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
  token: string,
  fetchFn: Fetch = fetch
): Promise<unknown> {
  const url = buildTrpcQueryUrl(base, procedure, input);
  // See the module-level note above: Bearer is a documented placeholder,
  // NOT proven to authenticate against the real TS app — live-verify at Task 11.
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  const body: unknown = await res.json();
  return stripTrpcJson(body);
}
