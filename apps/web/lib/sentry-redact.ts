// Bearer credentials that live in URL paths must never reach Sentry: the candidate video-interview join
// link `/interview/join/<token>` (WP-H) is the ENTIRE credential for that interview. Sentry records page
// URLs in request data, transaction names, spans and navigation breadcrumbs, so every event is scrubbed.

const JOIN_TOKEN_PATH = /\/interview\/join\/[^/?#\s"'<>]+/g;
const REDACTED_PATH = '/interview/join/[redacted]';

// #329 item 4 — the same path percent-encoded, as it appears in a `?next=`/`returnTo=` query value, a serialized
// redirect target or an encoded span attribute: `%2Finterview%2Fjoin%2F<token>` (any mix of `/` and `%2F`, either
// hex case). The token itself is base64url, so the match stops at the next escape (and never re-matches an
// already-written `[redacted]`).
const ENCODED_JOIN_TOKEN_PATH = /(?:\/|%2F)interview(?:\/|%2F)join(?:\/|%2F)[a-z0-9_-]+/gi;
const REDACTED_ENCODED_PATH = '%2Finterview%2Fjoin%2F[redacted]';

// Belt and braces: ANY 43-character base64url run (the exact shape of a join token: 32 random bytes, unpadded)
// that follows the word "join" and a short separator — `join=`, `join: `, `join%2F`, `"join":"` — regardless of
// the surrounding URL shape. Bounded on both sides so a longer identifier is not partially rewritten.
const JOIN_PREFIXED_TOKEN = /(join(?:%[0-9a-f]{2}|[^a-z0-9_\-%]){1,8})[a-z0-9_-]{43}(?![a-z0-9_-])/gi;

const MAX_DEPTH = 24;

export function redactJoinTokens(value: string): string {
  return value
    .replace(JOIN_TOKEN_PATH, REDACTED_PATH)
    .replace(ENCODED_JOIN_TOKEN_PATH, REDACTED_ENCODED_PATH)
    .replace(JOIN_PREFIXED_TOKEN, '$1[redacted]');
}

function scrub(node: unknown, depth: number): unknown {
  if (typeof node === 'string') return redactJoinTokens(node);
  if (depth >= MAX_DEPTH || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = scrub(node[i], depth + 1);
    return node;
  }
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) record[key] = scrub(record[key], depth + 1);
  return record;
}

/** Sentry beforeSend / beforeSendTransaction hook: scrubs join tokens from every string in the event. */
export function redactSentryEvent<T extends object>(event: T): T {
  return scrub(event, 0) as T;
}
