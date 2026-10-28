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

// Credential-named JSON members, as a request body, breadcrumb or serialized string. The value consumes JSON
// escapes (`\u0039…`, `\"`), so an escaped character cannot cut the match short and leave the rest of the
// credential behind.
// Every credential query parameter except `code` is also a credential when it is a JSON member or object
// property. `code` is not: as a member it is almost always an error code (`{"code":"NOT_FOUND"}`), and the Supabase
// auth code only ever travels as a query parameter, where the query-parameter pass drops it.
const CREDENTIAL_KEYS = [
  'token',
  'candidateToken',
  'signingToken',
  ...BEARER_QUERY_PARAMS.filter((name) => name !== 'code' && name !== 'token'),
] as const;
const KEY_ALT = CREDENTIAL_KEYS.map(escapeRe).join('|');
const JSON_CREDENTIAL_VALUE = new RegExp(`("(?:${KEY_ALT})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)+`, 'gi');
// The same member JSON-escaped inside another JSON string (`{\"token\":\"…\"}`): the value ends at the escaped
// closing quote `\"`; anything else, including a doubly escaped `\\u0039`, belongs to the credential.
const ESCAPED_JSON_CREDENTIAL_VALUE = new RegExp(
  `(\\\\"(?:${KEY_ALT})\\\\"\\s*:\\s*\\\\")(?:(?!\\\\")[^"])+`,
  'gi',
);

// The same names in diagnostic object syntax rather than JSON — unquoted keys, any quote style, or a bare value:
// `{ candidateToken: "…" }` (Prisma / util.inspect), `token: '…'`, `nonce = …`. The key must not be the tail of a
// longer identifier, and a value that is already `[redacted]` (or opens an object/array) is left alone.
const KEY_BOUNDARY = `(?:^|[^A-Za-z0-9_$"'\\\\])`;
const DIAGNOSTIC_QUOTED_VALUE = new RegExp(
  `(${KEY_BOUNDARY}(?:${KEY_ALT})\\s*[:=]\\s*)(["'\`])(?:(?!\\2)[^\\\\]|\\\\.)+(?=\\2)`,
  'gi',
);
// A quoted key in any quote style with a quoted value in any quote style: `'candidateToken': '…'`, `"token": '…'`.
const QUOTED_KEY_VALUE = new RegExp(
  `((["'])(?:${KEY_ALT})\\2\\s*[:=]\\s*)(["'\`])(?:(?!\\3)[^\\\\]|\\\\.)+(?=\\3)`,
  'gi',
);
// A credential value whose closing quote never comes (a message truncated mid-value): redacted to the end.
const UNTERMINATED_CREDENTIAL_VALUE = new RegExp(
  `((?:^|[^A-Za-z0-9_$\\\\])["']?(?:${KEY_ALT})["']?\\s*[:=]\\s*)(["'\`])(?:(?!\\2)[^\\\\]|\\\\[\\s\\S])*(?:\\\\)?$`,
  'i',
);
const DIAGNOSTIC_BARE_VALUE = new RegExp(
  `(${KEY_BOUNDARY}(?:${KEY_ALT})\\s*[:=]\\s*)(?!["'\`\\[{])[^\\s,;}\\])&#"'<>]{6,}`,
  'gi',
);

// A Prisma JSON-path filter on a credential field, as echoed by a diagnostic: `{ path: ["signingToken"], … }`.
// Every sibling of such a path is a comparison on the credential (equals, gte, string_*, nested `not: {…}`, …), so
// the WHOLE enclosing object is replaced, found by a bracket-matching scan; there is no operator list to fall
// behind. A filter cut off before its closing brace loses everything after its opening brace.
const CREDENTIAL_PATH = `["']?path["']?\\s*:\\s*\\[[^\\]{}]*["'](?:${KEY_ALT})["'][^\\]{}]*\\]`;
const CREDENTIAL_PATH_RE = new RegExp(CREDENTIAL_PATH, 'gi');
const FILTER_NON_VALUE_KEYS: ReadonlySet<string> = new Set(['path', 'mode']);

// One forward scan, skipping braces inside quoted text: the span [open, close] of every `{…}` object (close = end
// of text when it is cut off).
function objectSpans(text: string): { spans: Array<[number, number]> } {
  const spans: Array<[number, number]> = [];
  const stack: Array<{ char: string; at: number }> = [];
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    // An apostrophe between letters (`Can't`) is prose, not a quote.
    if (c === '"' || c === '`' || (c === "'" && !/[A-Za-z0-9]/.test(text[i - 1] ?? ''))) quote = c;
    else if (c === '{' || c === '[') stack.push({ char: c, at: i });
    else if (c === '}' || c === ']') {
      const top = stack.pop();
      if (top?.char === '{' && c === '}') spans.push([top.at, i]);
    }
  }
  for (const open of stack) if (open.char === '{') spans.push([open.at, text.length - 1]);
  return { spans };
}

function scrubCredentialFilterObjects(value: string): string {
  const re = new RegExp(CREDENTIAL_PATH_RE.source, 'gi');
  if (!re.test(value)) return value;
  // A path inside quoted text is still handled: a serialized diagnostic quotes the whole filter, so skipping it
  // would leave the credential; over-redacting a sentence that merely mentions such a path is the accepted cost.
  const { spans } = objectSpans(value);
  const cuts: Array<[number, number]> = [];
  re.lastIndex = 0;
  for (let match = re.exec(value); match !== null; match = re.exec(value)) {
    let best: [number, number] | null = null;
    for (const span of spans) {
      if (span[0] < match.index && span[1] >= match.index && (best === null || span[0] > best[0])) best = span;
    }
    // No enclosing object could be established (a fragment, or quoting the scan could not follow): fail closed
    // and drop the whole string; no brace found without the scan can be trusted to bound the filter.
    if (best === null) return REDACTED;
    // Quote tracking can be misled by prose (`wrapped "{ … "{", path: … }`) into a span that starts too late, so
    // the cut starts at the FIRST `{` of the string instead: over-redaction, never a comparison left before it.
    const first = value.indexOf('{');
    cuts.push([first !== -1 && first < best[0] ? first : best[0], best[1]]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  // Overlapping cuts are merged, so a later filter's object is never left out because an earlier cut began first.
  const merged: Array<[number, number]> = [];
  for (const cut of cuts) {
    const prev = merged[merged.length - 1];
    if (prev && cut[0] <= prev[1]) prev[1] = Math.max(prev[1], cut[1]);
    else merged.push([cut[0], cut[1]]);
  }
  let out = '';
  let last = 0;
  for (const [open, close] of merged) {
    const closed = value[close] === '}' && close > open;
    out += `${value.slice(last, open)}${value[open] === '{' ? `{${REDACTED}${closed ? '}' : ''}` : REDACTED}`;
    last = close + 1;
  }
  return out + value.slice(last);
}

// A Prisma validation error echoes the whole call (`Invalid \`prisma.offer.findMany()\` invocation: { where: … }`),
// arguments included. Only the first line identifies the failing call; the argument dump is dropped outright.
const PRISMA_INVOCATION = /(Invalid `[^`\n]{1,200}` invocation)[\s\S]*/g;

// A credential-named key whose value is an object or array (`candidateToken: { equals: "…" }`,
// `token: ["…"]`): the whole bracketed value is redacted, found by a bracket-matching scan that skips quoted text.
const CREDENTIAL_CONTAINER_KEY = new RegExp(
  `((?:^|[^A-Za-z0-9_$\\\\])["']?(?:${KEY_ALT})["']?\\s*[:=]\\s*)(?=[\\[{])`,
  'gi',
);

function closingBracket(text: string, open: number): number {
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function scrubCredentialContainers(value: string): string {
  const keys = new RegExp(CREDENTIAL_CONTAINER_KEY.source, 'gi');
  let out = '';
  let last = 0;
  for (let match = keys.exec(value); match !== null; match = keys.exec(value)) {
    const open = keys.lastIndex;
    const close = closingBracket(value, open);
    // Unbalanced (a truncated message): everything after the key goes.
    const end = close === -1 ? value.length : close + 1;
    out += `${value.slice(last, open)}${value[open]}${REDACTED}${close === -1 ? '' : value[close]}`;
    last = end;
    keys.lastIndex = end;
  }
  return out + value.slice(last);
}

// The same members percent-encoded once or twice, as in a tRPC GET URL:
// `/api/trpc/offer.getBySigningToken?input=%7B%220%22%3A%7B%22json%22%3A%7B%22token%22%3A%22<token>%22%7D…`.
// The value runs until its closing (encoded) quote; other escapes inside it are consumed.
const ENCODED_JSON_CREDENTIAL_VALUE = new RegExp(
  `((?:%22|%2522)(?:${CREDENTIAL_KEYS.map(escapeRe).join('|')})(?:%22|%2522)(?:%3A|%253A)(?:%22|%2522))` +
    `(?:[^%&#\\s"'<>]|%(?!22|25)[0-9a-f]{2})+`,
  'gi',
);

const CREDENTIAL_KEY_SET: ReadonlySet<string> = new Set(CREDENTIAL_KEYS.map((key) => key.toLowerCase()));
const MAX_DEPTH = 24;

// JSON `\uXXXX` escapes (also doubly escaped, `\\uXXXX`) that spell a letter, digit or `_` are decoded before
// matching, so a credential key written as `"to\u006ben"` in free text (an exception message, a serialized body)
// reads as `"token"`. Escapes of any other character are left as they are.
const KEY_CHAR_ESCAPE = /\\{1,2}u([0-9a-f]{4})/gi;

function unescapeKeyChars(value: string): string {
  return value.replace(KEY_CHAR_ESCAPE, (escape, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[A-Za-z0-9_]$/.test(char) ? char : escape;
  });
}

function scrubPatterns(value: string): string {
  let out = scrubCredentialFilterObjects(scrubCredentialContainers(
    unescapeKeyChars(value).replace(PRISMA_INVOCATION, '$1: [arguments redacted]'),
  )).replace(PATH_TOKEN, `$1${REDACTED}`);
  for (const pattern of ENCODED_PATH_TOKENS) out = out.replace(pattern, `$1${REDACTED}`);
  return out
    .replace(QUERY_PARAM, `$1${REDACTED}`)
    .replace(ENCODED_QUERY_PARAM, `$1${REDACTED}`)
    .replace(JOIN_PREFIXED_TOKEN, `$1${REDACTED}`)
    .replace(JSON_CREDENTIAL_VALUE, `$1${REDACTED}`)
    .replace(ESCAPED_JSON_CREDENTIAL_VALUE, `$1${REDACTED}`)
    .replace(DIAGNOSTIC_QUOTED_VALUE, `$1$2${REDACTED}`)
    .replace(QUOTED_KEY_VALUE, `$1$3${REDACTED}`)
    .replace(DIAGNOSTIC_BARE_VALUE, `$1${REDACTED}`)
    .replace(UNTERMINATED_CREDENTIAL_VALUE, `$1$2${REDACTED}`)
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

// JSON text is parsed and scrubbed structurally, so credential keys are matched AFTER JSON decoding: an escaped
// key (`"to\u006ben"`) or value cannot slip past the text patterns. Returns null for anything that is not a
// JSON object or array.
function scrubJsonText(text: string, depth: number): string | null {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    // A serialized string (`JSON.stringify(message)`): scrub its decoded content, then serialize it again.
    if (typeof parsed === 'string') return JSON.stringify(redactBearerTokens(parsed, depth + 1));
    if (parsed === null || typeof parsed !== 'object') return null;
    return JSON.stringify(scrub(parsed, depth + 1));
  } catch {
    return null;
  }
}

// Query parameters are matched by NAME the way a URL parser reads it (percent escapes and `+` decoded, case
// folded), and a sensitive parameter's RAW value is dropped before anything inside it is decoded, so no
// encoding of the value can survive. Sensitive: the credential parameters, plus tRPC's `input`, which carries
// the whole procedure input (a credential or personal data) and is never needed to debug an error.
const DROPPED_QUERY_PARAMS: ReadonlySet<string> = new Set([...BEARER_QUERY_PARAMS, 'input']);
// Only the parameter NAME is matched by pattern. A dropped value then runs to the real query boundary (`&` or
// `#`): URL parsers keep a literal `;` or `?` inside a value, and a raw `query_string` may hold unencoded JSON with
// spaces, so stopping at any of those would leave its tail behind. Over-redaction (a URL quoted mid-sentence loses
// the rest of the sentence) is the accepted cost. Scanning resumes right after each `=`, so a parameter nested in a decoded URL (`?next=/x?input=…`) is
// still seen on its own.
const QUERY_PARAMETER_NAME = /(?:^|[?&;#])([^=&#?;\s"'<>]+)=/g;
const QUERY_VALUE_END = /[&#]/;

function queryParamName(raw: string): string {
  let name = raw;
  for (let level = 0; level < MAX_DECODE_LEVELS; level++) {
    const decoded = percentDecode(name.replace(/\+/g, ' '));
    if (decoded === name) break;
    name = decoded;
  }
  return name.trim().toLowerCase();
}

function isDroppedQueryParam(rawName: string): boolean {
  return DROPPED_QUERY_PARAMS.has(queryParamName(rawName));
}

function scrubQueryParams(value: string): string {
  const names = new RegExp(QUERY_PARAMETER_NAME.source, 'g');
  let out = '';
  let last = 0;
  for (let match = names.exec(value); match !== null; match = names.exec(value)) {
    if (!isDroppedQueryParam(match[1])) continue;
    const start = names.lastIndex;
    let end = start;
    while (end < value.length && !QUERY_VALUE_END.test(value[end])) end++;
    if (end > start && value.slice(start, end) !== REDACTED) {
      out += value.slice(last, start) + REDACTED;
      last = end;
    }
    names.lastIndex = end;
  }
  return out + value.slice(last);
}

// One scrubbing pass over a string: the structural JSON pass first (keys compared after JSON decoding) or, for
// anything else, the query-parameter pass; then the text patterns over the result, which still catch shapes
// only text reveals, such as a join token stored under an unrelated key.
function scrubLevel(text: string, depth: number): string {
  if (depth >= MAX_DEPTH) return scrubPatterns(scrubQueryParams(text));
  return scrubPatterns(scrubJsonText(text, depth) ?? scrubQueryParams(text));
}

export function redactBearerTokens(value: string, depth = 0): string {
  const scrubbed = scrubLevel(value, depth);
  // Encoded forms the patterns above do not anticipate (an escaped character inside a token, JSON whitespace
  // inside an encoded body, a serialized string embedded in a message, a third encoding level, …): decode level
  // by level — percent escapes, then backslash escapes of quotes — and re-scrub each level. If any decoded level
  // still revealed something, the event carries the decoded, scrubbed form instead.
  let current = scrubbed;
  let revealed = false;
  for (let level = 0; level < MAX_DECODE_LEVELS && (current.includes('%') || current.includes('\\')); level++) {
    let decoded = current;
    // Form semantics: in a query value `+` is a space, so `"token":+"…"` must read as JSON whitespace.
    if (decoded.includes('%')) decoded = percentDecode(decoded.replace(/\+/g, ' '));
    decoded = decoded.replace(/\\(["'`\\/])/g, '$1');
    if (decoded === current) break;
    current = scrubLevel(decoded, depth);
    // Any change means this level exposed something the previous level did not (a new token, the rest of one cut
    // short by an escape, or JSON that only parses once decoded); the decoded, scrubbed form is then kept.
    if (current !== decoded) revealed = true;
  }
  return revealed ? current : scrubbed;
}

// Sentry's `request.query_string` may be a string (handled by the regexes) or an object / array of
// [name, value] pairs, where the value has no `name=` context to match on.
function scrubQueryString(node: unknown): void {
  if (Array.isArray(node)) {
    for (const pair of node) {
      if (Array.isArray(pair) && typeof pair[0] === 'string' && isDroppedQueryParam(pair[0])) {
        pair[1] = REDACTED;
      }
    }
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (isDroppedQueryParam(key)) record[key] = REDACTED;
    }
  }
}

function scrub(node: unknown, depth: number): unknown {
  if (typeof node === 'string') return redactBearerTokens(node, depth);
  if (depth >= MAX_DEPTH || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = scrub(node[i], depth + 1);
    return node;
  }
  const record = node as Record<string, unknown>;
  // A structured JSON-path filter on a credential field (`{ path: ['signingToken'], equals: … }`): the compared
  // values are the credential even though their own keys are not credential names.
  const filterPath = record.path;
  if (
    Array.isArray(filterPath) &&
    filterPath.some((segment) => typeof segment === 'string' && CREDENTIAL_KEY_SET.has(segment.toLowerCase()))
  ) {
    for (const key of Object.keys(record)) {
      if (!FILTER_NON_VALUE_KEYS.has(key) && record[key] !== null && record[key] !== undefined) record[key] = REDACTED;
    }
  }
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (key === 'query_string') scrubQueryString(value);
    // A parsed body (`request.data = { token }`): the bare value has no surrounding text to match on.
    record[key] =
      CREDENTIAL_KEY_SET.has(key.toLowerCase()) && value !== null && value !== undefined && value !== ''
        ? REDACTED
        : scrub(value, depth + 1);
  }
  return record;
}

/** Sentry beforeSend / beforeSendTransaction hook (breadcrumbs ride inside the event): scrubs credentials in place. */
export function redactSentryEvent<T extends object>(event: T): T {
  return scrub(event, 0) as T;
}
