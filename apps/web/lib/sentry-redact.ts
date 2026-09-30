// Bearer credentials that live in URL paths must never reach Sentry: the candidate video-interview join
// link `/interview/join/<token>` (WP-H) is the ENTIRE credential for that interview. Sentry records page
// URLs in request data, transaction names, spans and navigation breadcrumbs, so every event is scrubbed.

const JOIN_TOKEN_PATH = /\/interview\/join\/[^/?#\s"'<>]+/g;
const REDACTED_PATH = '/interview/join/[redacted]';
const MAX_DEPTH = 24;

export function redactJoinTokens(value: string): string {
  return value.replace(JOIN_TOKEN_PATH, REDACTED_PATH);
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
