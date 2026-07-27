// Minimal SERVER-SIDE fetch client for the C# Platform service (services/Tims.Platform), used to
// dark-route specific tRPC procedures to the C# service when explicitly flagged.
//
// This is NOT the browser client (apps/web/lib/platform-api/client.ts) — that one lets the
// BROWSER choose tRPC vs. C# per a NEXT_PUBLIC_* flag, which only works because the browser holds
// its own Supabase session. The external-vendor surface has no browser caller at all: a
// third-party vendor's server calls our tRPC endpoint directly with `Authorization: Bearer
// tims_...`. So THIS client forwards the CALLER's own Authorization header verbatim — it never
// holds or issues its own credential — letting the C# service's ApiKeyAuthenticationHandler
// authenticate the SAME key independently. Used only by server-to-server dark-cutover proxies
// (currently: external-assessment.service.ts); every other domain's cutover routes client-side.

const PLATFORM_API_URL = process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL;

/** True only when the C# Platform base URL is configured. */
export function isPlatformApiEnabled(): boolean {
  return typeof PLATFORM_API_URL === 'string' && PLATFORM_API_URL.trim().length > 0;
}

type QueryParams = Record<string, string | number | undefined>;

function buildQueryString(query: QueryParams | undefined): string {
  if (!query) return '';
  const pairs = Object.entries(query)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/** A raw platform-API response: the caller maps the status code to its own error semantics. */
export interface PlatformApiResponse {
  status: number;
  body: unknown;
}

/**
 * GETs the C# Platform service, forwarding `authorizationHeader` (the vendor's OWN raw
 * `Authorization` header value, e.g. `Bearer tims_...`) verbatim. Returns the raw status + parsed
 * JSON body (or `null` for a 204/empty body) — deliberately does NOT throw on non-2xx, since each
 * call site needs to map specific statuses to its own tRPC error semantics (e.g. a 404 must
 * become the exact pre-existing NOT_FOUND message).
 */
export async function platformGetWithAuth(
  path: string,
  authorizationHeader: string,
  query?: QueryParams,
): Promise<PlatformApiResponse> {
  if (!isPlatformApiEnabled()) {
    throw new Error('Platform API is disabled: NEXT_PUBLIC_TIMS_PLATFORM_API_URL is unset.');
  }

  const base = PLATFORM_API_URL!.replace(/\/+$/, '');
  const response = await fetch(`${base}${path}${buildQueryString(query)}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: authorizationHeader },
  });

  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}

/**
 * POSTs to the C# Platform service, forwarding `authorizationHeader` verbatim (same contract as
 * {@link platformGetWithAuth}) and sending `jsonBody` as the request body. Returns the raw
 * status + parsed JSON body (or `null` for a 204/empty body) — deliberately does NOT throw on
 * non-2xx, for the same reason as the GET variant: each call site maps specific statuses (404,
 * 409, ...) to its own tRPC error semantics.
 */
export async function platformPostWithAuth(
  path: string,
  authorizationHeader: string,
  jsonBody: unknown,
): Promise<PlatformApiResponse> {
  if (!isPlatformApiEnabled()) {
    throw new Error('Platform API is disabled: NEXT_PUBLIC_TIMS_PLATFORM_API_URL is unset.');
  }

  const base = PLATFORM_API_URL!.replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: authorizationHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(jsonBody),
  });

  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}

/** A raw platform-API response carrying unparsed response text (see {@link platformPostRaw}). */
export interface PlatformApiRawResponse {
  status: number;
  text: string;
}

/**
 * POSTs a RAW string body to the C# Platform service with explicit `headers`, WITHOUT JSON-encoding
 * it — unlike {@link platformPostWithAuth}, which always serializes `jsonBody`. Needed for payloads
 * whose signature is verified over the EXACT bytes received (Stripe webhooks): re-serializing a
 * parsed-then-re-stringified body would not byte-match what Stripe originally signed. Returns the
 * raw status + response text unparsed; the caller decides how to interpret/parse it.
 */
export async function platformPostRaw(
  path: string,
  headers: Record<string, string>,
  rawBody: string,
): Promise<PlatformApiRawResponse> {
  if (!isPlatformApiEnabled()) {
    throw new Error('Platform API is disabled: NEXT_PUBLIC_TIMS_PLATFORM_API_URL is unset.');
  }

  const base = PLATFORM_API_URL!.replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: rawBody });
  const text = await response.text();
  return { status: response.status, text };
}
