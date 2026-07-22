// Minimal typed fetch client for the TIMS C# Platform service (services/Tims.Platform).
//
// This is the reusable foundation for routing individual READ surfaces to the C#
// backend one env-flag at a time during the backend migration. It is DARK by default:
// when NEXT_PUBLIC_TIMS_PLATFORM_API_URL is unset the client is DISABLED and callers
// fall back to the existing tRPC path (see lib/platform-api/team-intel.ts).
//
// Auth reuses the SAME Supabase browser session helper the rest of apps/web uses
// (`createSupabaseBrowserClient` from '@tims/auth/client') — no new auth path. No
// secrets, no privileged server keys, no token/PII logging.

import type { paths } from './schema';
import { createSupabaseBrowserClient } from '@tims/auth/client';

// Client-visible base URL (NEXT_PUBLIC_* so it reaches the browser). Unset ⇒ disabled.
const PLATFORM_API_URL = process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL;

/**
 * True only when the C# Platform base URL is configured. When false the whole
 * platform-api client is considered disabled and no request is ever attempted.
 */
export function isPlatformApiEnabled(): boolean {
  return typeof PLATFORM_API_URL === 'string' && PLATFORM_API_URL.trim().length > 0;
}

/** Typed error thrown on any non-2xx response. Carries the HTTP status. */
export class PlatformApiError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Platform API request failed: ${status} ${statusText}`);
    this.name = 'PlatformApiError';
    this.status = status;
  }
}

// Paths that expose a GET returning an application/json 200 body.
type GetPaths = {
  [P in keyof paths]: paths[P] extends {
    get: { responses: { 200: { content: { 'application/json': unknown } } } };
  }
    ? P
    : never;
}[keyof paths];

// The JSON response body type for a given GET path (from the generated contract).
type GetJsonResponse<P extends GetPaths> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer R } } } };
}
  ? R
  : never;

/**
 * Reads the current Supabase access token client-side via the shared browser client.
 * Returns null when there is no active session (the request then goes out unauthenticated
 * and the C# service replies 401 — never a silent success).
 */
async function getAccessToken(): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Optional GET query string, mirroring the C# endpoints' minimal query contract (e.g.
// `?period=30D`). Values are stringified; `undefined` entries are dropped so an omitted
// optional param sends nothing (server applies its own default — Zod/enum parity).
type QueryParams = Record<string, string | number | undefined>;

function buildQueryString(query: QueryParams | undefined): string {
  if (!query) return '';
  const pairs = Object.entries(query)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

// Optional path parameters for templated paths (e.g. `/evaluation360/cycles/{cycleId}/progress`).
// Each `{name}` token in the path template is substituted with the matching URL-encoded value
// before the request goes out, while the response type stays keyed to the literal template path.
// Param-less callers (team-intel / reporting / billing) pass nothing — their behavior is unchanged.
type PathParams = Record<string, string>;

function applyPathParams(path: string, params: PathParams | undefined): string {
  if (!params) return path;
  return path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Platform API path parameter "${key}" is missing.`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * Typed GET against the C# Platform service. Path + response are typed from the
 * committed OpenAPI contract (lib/platform-api/schema.d.ts). Attaches a Bearer token
 * (Supabase session) and Accept: application/json, throws {@link PlatformApiError} on
 * non-2xx, and parses the JSON body. Optional {@link QueryParams} are appended as a
 * query string (undefined entries omitted). Optional {@link PathParams} substitute any
 * `{name}` token in a templated path before the request is sent.
 */
export async function platformGet<P extends GetPaths>(
  path: P,
  query?: QueryParams,
  pathParams?: PathParams,
): Promise<GetJsonResponse<P>> {
  if (!isPlatformApiEnabled()) {
    throw new Error('Platform API is disabled: NEXT_PUBLIC_TIMS_PLATFORM_API_URL is unset.');
  }

  const token = await getAccessToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const base = PLATFORM_API_URL!.replace(/\/+$/, '');
  const resolvedPath = applyPathParams(path, pathParams);
  const response = await fetch(`${base}${resolvedPath}${buildQueryString(query)}`, {
    method: 'GET',
    headers,
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new PlatformApiError(response.status, response.statusText);
  }

  return (await response.json()) as GetJsonResponse<P>;
}
