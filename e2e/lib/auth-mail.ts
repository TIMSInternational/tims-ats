/**
 * Supabase auth mail (OTP codes, magic links, signup confirmations) in the local stack's Mailpit
 * inbox. Pure parsing plus an injectable-fetch poller: no Playwright, no stack-file reads, so root
 * vitest can test it. Every URL it reads or returns must be local; anything else is refused.
 */

export interface MailpitSummary {
  id: string;
  /** Lower-cased recipient addresses. */
  to: string[];
  subject: string;
  created: Date;
}

export interface MailpitMessage {
  id: string;
  /** Lower-cased recipient addresses. */
  to: string[];
  subject: string;
  text: string;
  html: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bad(what: string): never {
  throw new Error(`[e2e] unexpected Mailpit response: ${what}`);
}

function parseRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) bad('To is not an array');
  return value.map((r) => {
    if (!isRecord(r) || typeof r.Address !== 'string') bad('recipient without Address');
    return r.Address.toLowerCase();
  });
}

function requireId(value: Record<string, unknown>): string {
  if (typeof value.ID !== 'string' || value.ID.length === 0) bad('missing ID');
  return value.ID;
}

function optionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') bad(`${field} is not a string`);
  return value;
}

/** Parse `GET /api/v1/messages`. */
export function parseMailpitList(raw: unknown): MailpitSummary[] {
  if (!isRecord(raw) || !Array.isArray(raw.messages)) bad('list has no messages array');
  return raw.messages.map((m: unknown) => {
    if (!isRecord(m)) bad('list entry is not an object');
    const created = new Date(typeof m.Created === 'string' ? m.Created : Number.NaN);
    if (Number.isNaN(created.getTime())) bad('bad Created date');
    return { id: requireId(m), to: parseRecipients(m.To), subject: optionalString(m.Subject, 'Subject'), created };
  });
}

/** Parse `GET /api/v1/message/{ID}`. */
export function parseMailpitMessage(raw: unknown): MailpitMessage {
  if (!isRecord(raw)) bad('message is not an object');
  return {
    id: requireId(raw),
    to: parseRecipients(raw.To),
    subject: optionalString(raw.Subject, 'Subject'),
    text: optionalString(raw.Text, 'Text'),
    html: optionalString(raw.HTML, 'HTML'),
  };
}

/** Newest message addressed to `address` (exact, case-insensitive), optionally created at/after `since`. */
export function pickLatestFor(list: MailpitSummary[], address: string, since?: Date): MailpitSummary | undefined {
  const wanted = address.toLowerCase();
  let latest: MailpitSummary | undefined;
  for (const m of list) {
    if (!m.to.includes(wanted)) continue;
    if (since && m.created.getTime() < since.getTime()) continue;
    if (!latest || m.created.getTime() > latest.created.getTime()) latest = m;
  }
  return latest;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

/** What a reader sees: tags (and their attributes) and URLs removed, entities decoded. */
function visibleText(body: string): string {
  return decodeEntities(body.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(
    /[a-z][a-z0-9+.-]*:\/\/\S+/gi,
    ' ',
  );
}

function codesIn(body: string, digits: number): Set<string> {
  const re = new RegExp(`(?<!\\w)\\d{${digits}}(?!\\w)`, 'g');
  return new Set(visibleText(body).match(re) ?? []);
}

/** The OTP code in an auth mail: text body first, html as fallback. Throws if absent or ambiguous. */
export function extractOtp(message: MailpitMessage, options: { digits?: number } = {}): string {
  const digits = options.digits ?? 6;
  let codes = codesIn(message.text, digits);
  if (codes.size === 0) codes = codesIn(message.html, digits);
  if (codes.size === 0) throw new Error(`[e2e] no ${digits}-digit code in mail "${message.subject}"`);
  if (codes.size > 1) throw new Error(`[e2e] ambiguous mail "${message.subject}": more than one code`);
  return [...codes][0]!;
}

/** Parse `raw` and return it only if it is an http(s) URL on localhost / 127.0.0.1 / [::1] with no userinfo. */
export function assertLocalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('[e2e] refusing a non-local URL (unparseable)');
  }
  const ok =
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    LOCAL_HOSTS.has(url.hostname);
  if (!ok) throw new Error(`[e2e] refusing a non-local URL (host "${url.hostname}", protocol "${url.protocol}")`);
  return url;
}

/** The Supabase `/auth/v1/verify` link in an auth mail; refused unless it and its `redirect_to` stay local. */
export function extractAuthLink(message: MailpitMessage): URL {
  const candidates = [...`${message.html}\n${message.text}`.matchAll(/https?:\/\/[^"'<>\s]+/g)].map((m) =>
    decodeEntities(m[0]),
  );
  const verify = candidates.find((raw) => {
    try {
      return new URL(raw).pathname === '/auth/v1/verify';
    } catch {
      return false;
    }
  });
  if (!verify) throw new Error(`[e2e] no auth verify link in mail "${message.subject}"`);
  const url = assertLocalUrl(verify);
  const redirect = url.searchParams.get('redirect_to');
  if (redirect !== null) {
    try {
      assertLocalUrl(redirect);
    } catch {
      throw new Error('[e2e] refusing an auth link whose redirect_to is not local');
    }
  }
  return url;
}

export interface WaitForAuthMailOptions {
  /** Mailpit base URL, e.g. http://127.0.0.1:54324. Must be local. */
  baseUrl: string;
  address: string;
  /** Ignore mail created before this (so a stale OTP is never reused). */
  since?: Date;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: (input: string) => Promise<Response>;
}

async function getJson(fetchImpl: (input: string) => Promise<Response>, url: string): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`[e2e] Mailpit returned HTTP ${res.status} for ${new URL(url).pathname}`);
  return res.json();
}

/** Poll Mailpit until a mail for `address` (newer than `since`) arrives; return the full message. */
export async function waitForAuthMail(options: WaitForAuthMailOptions): Promise<MailpitMessage> {
  const { address, since, timeoutMs = 30_000, intervalMs = 500 } = options;
  const base = assertLocalUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? ((input: string) => fetch(input));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = parseMailpitList(await getJson(fetchImpl, new URL('/api/v1/messages', base).href));
    const hit = pickLatestFor(list, address, since);
    if (hit) {
      const url = new URL(`/api/v1/message/${encodeURIComponent(hit.id)}`, base).href;
      return parseMailpitMessage(await getJson(fetchImpl, url));
    }
    if (Date.now() >= deadline) {
      throw new Error(`[e2e] no auth mail for ${address} within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
