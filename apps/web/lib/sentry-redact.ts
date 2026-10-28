// Bearer credentials that live in URLs must never reach Sentry. Sentry records page URLs in request data,
// query strings, transaction names, spans and navigation breadcrumbs, so every string in every event is
// scrubbed. The set of bearer-link routes and credential query parameters comes from
// lib/security/bearer-links.ts — the same list the middleware uses for no-referrer / no-store.
//
// Covered shapes:
//   - path tokens: `/offers/sign/<token>`, `/interview/join/<token>`, `/ai-interview/<token>` — plain,
//     `%2F`-encoded and `%252F`-double-encoded (as they appear inside a `?next=`/`returnTo=` value);
//   - credential query values anywhere: `?token=`, `&code=`, `#access_token=`, `refresh_token=`, and the same
//     inside an encoded nested URL (`%3Ftoken%3D…`); also Sentry's `query_string` in object / pair form;
//   - credential-named JSON members (`{"token":"…"}`, also JSON-escaped, and percent-encoded as in a tRPC
//     GET `?input=` value) and object properties;
//   - (#329) any 43-character base64url run that follows the word "join" (the join-token shape).

import { BEARER_QUERY_PARAMS, BEARER_TOKEN_PATH_PREFIXES } from './security/bearer-links';

const REDACTED = '[redacted]';
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `/offers/sign/` → ['offers', 'sign']
const PREFIX_SEGMENTS = BEARER_TOKEN_PATH_PREFIXES.map((prefix) => prefix.split('/').filter(Boolean));

// Plain path: the first segment after the prefix is the credential.
const PATH_TOKEN = new RegExp(
  `(/(?:${PREFIX_SEGMENTS.map((segs) => segs.map(escapeRe).join('/')).join('|')})/)[^/?#&\\s"'<>]+`,
  'g',
);

// The same paths percent-encoded once or twice, in any hex case. The token charset (base64url / UUID) has
// no `%`, so the match stops at the next escape and never re-matches an already-written `[redacted]`.
const SEP = '(?:\\/|%2F|%252F)';
// The separators are kept as written, so re-scrubbing an already-redacted string is a no-op (see below).
const ENCODED_PATH_TOKENS = PREFIX_SEGMENTS.map(
  (segs) => new RegExp(`(${SEP}${segs.map(escapeRe).join(SEP)}${SEP})[a-z0-9_.~-]+`, 'gi'),
);

const PARAMS = BEARER_QUERY_PARAMS.map(escapeRe).join('|');
// `?token=…`, `&code=…`, `#access_token=…`, or a bare `token=…` query string. Only at a parameter boundary,
// so `x_token=` or `session=` are left alone.
const QUERY_PARAM = new RegExp(`((?:^|[?&;#])(?:${PARAMS})=)[^&#\\s"'<>]+`, 'gi');
// The same inside an encoded nested URL, encoded once (`%3Ftoken%3D…`, `%26code%3D…`) or twice
// (`%253Ftoken%253D…`). Escapes inside the value are consumed except an encoded `&` / `#` / `%`, which end it
// (a double-encoded separator starts with `%25`).
const ENCODED_QUERY_PARAM = new RegExp(
  `((?:%3F|%26|%23|%253F|%2526|%2523)(?:${PARAMS})(?:%3D|%253D))(?:[^&#%\\s"'<>]|%(?!26|23|25)[0-9a-f]{2})+`,
  'gi',
);

// Any 43-character base64url run (the exact shape of a join token: 32 random bytes, unpadded) that follows
// the word "join" and a short separator — `join=`, `join: `, `join%2F`, `"join":"`. Bounded on both sides so
// a longer identifier is not partially rewritten.
const JOIN_PREFIXED_TOKEN = /(join(?:%[0-9a-f]{2}|[^a-z0-9_\-%]){1,8})[a-z0-9_-]{43}(?![a-z0-9_-])/gi;

// Credential-named JSON members, as a request body, breadcrumb or serialized string (also JSON-escaped inside
// another string: `{\"token\":\"…\"}`).
const CREDENTIAL_KEYS = ['token', 'candidateToken', 'signingToken', 'access_token', 'refresh_token'] as const;
const JSON_CREDENTIAL_VALUE = new RegExp(
  `(\\\\?"(?:${CREDENTIAL_KEYS.map(escapeRe).join('|')})\\\\?"\\s*:\\s*\\\\?")[^"\\\\]+`,
  'gi',
);

// The same members percent-encoded once or twice, as in a tRPC GET URL:
// `/api/trpc/offer.getBySigningToken?input=%7B%220%22%3A%7B%22json%22%3A%7B%22token%22%3A%22<token>%22%7D…`.
// The value runs until its closing (encoded) quote; other escapes inside it are consumed.
const ENCODED_JSON_CREDENTIAL_VALUE = new RegExp(
  `((?:%22|%2522)(?:${CREDENTIAL_KEYS.map(escapeRe).join('|')})(?:%22|%2522)(?:%3A|%253A)(?:%22|%2522))` +
    `(?:[^%&#\\s"'<>]|%(?!22|25)[0-9a-f]{2})+`,
  'gi',
);

const CREDENTIAL_KEY_SET: ReadonlySet<string> = new Set(CREDENTIAL_KEYS);
const QUERY_PARAM_SET: ReadonlySet<string> = new Set(BEARER_QUERY_PARAMS);
const MAX_DEPTH = 24;

function scrubPatterns(value: string): string {
  let out = value.replace(PATH_TOKEN, `$1${REDACTED}`);
  for (const pattern of ENCODED_PATH_TOKENS) out = out.replace(pattern, `$1${REDACTED}`);
  return out
    .replace(QUERY_PARAM, `$1${REDACTED}`)
    .replace(ENCODED_QUERY_PARAM, `$1${REDACTED}`)
    .replace(JOIN_PREFIXED_TOKEN, `$1${REDACTED}`)
    .replace(JSON_CREDENTIAL_VALUE, `$1${REDACTED}`)
    .replace(ENCODED_JSON_CREDENTIAL_VALUE, `$1${REDACTED}`);
}

// Percent-decodes every well-formed escape run, leaving malformed ones (a stray `%`) as they are. Never throws.
function percentDecode(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

const MAX_DECODE_LEVELS = 3;

export function redactBearerTokens(value: string): string {
  const scrubbed = scrubPatterns(value);
  // Encoded forms the patterns above do not anticipate (an escaped character inside a token, JSON whitespace
  // inside an encoded body, a third encoding level, …): decode level by level and re-scrub each level. If any
  // decoded level still revealed a credential, the event carries the decoded, scrubbed form instead.
  let current = scrubbed;
  let revealed = false;
  for (let level = 0; level < MAX_DECODE_LEVELS && current.includes('%'); level++) {
    const decoded = percentDecode(current);
    if (decoded === current) break;
    current = scrubPatterns(decoded);
    // scrubPatterns is idempotent on already-redacted text, so any change means this level exposed credential
    // content the previous level did not (a new token, or the rest of one cut short by an escape).
    if (current !== decoded) revealed = true;
  }
  return revealed ? current : scrubbed;
}

// Sentry's `request.query_string` may be a string (handled by the regexes) or an object / array of
// [name, value] pairs, where the value has no `name=` context to match on.
function scrubQueryString(node: unknown): void {
  if (Array.isArray(node)) {
    for (const pair of node) {
      if (Array.isArray(pair) && typeof pair[0] === 'string' && QUERY_PARAM_SET.has(pair[0].toLowerCase())) {
        pair[1] = REDACTED;
      }
    }
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (QUERY_PARAM_SET.has(key.toLowerCase())) record[key] = REDACTED;
    }
  }
}

function scrub(node: unknown, depth: number): unknown {
  if (typeof node === 'string') return redactBearerTokens(node);
  if (depth >= MAX_DEPTH || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = scrub(node[i], depth + 1);
    return node;
  }
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (key === 'query_string') scrubQueryString(value);
    // A parsed body (`request.data = { token }`): the bare value has no surrounding text to match on.
    record[key] =
      CREDENTIAL_KEY_SET.has(key) && typeof value === 'string' && value.length > 0 ? REDACTED : scrub(value, depth + 1);
  }
  return record;
}

/** Sentry beforeSend / beforeSendTransaction hook (breadcrumbs ride inside the event): scrubs credentials in place. */
export function redactSentryEvent<T extends object>(event: T): T {
  return scrub(event, 0) as T;
}
