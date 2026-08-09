import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { clientIpFrom } from '../../packages/api/src/lib/client-ip';

// #158 — the audit IP must not be attacker-chosen.
//
// `packages/api/src/trpc.ts` has documented the rule in prose since the rate limiter was written:
// never trust the client-controlled LEFT-MOST `x-forwarded-for` value; prefer `x-real-ip` (written
// by the platform edge), otherwise take the LAST hop. Eight §21/audit writers did the exact
// opposite — they took the raw whole header first. So the single forensic field the Ley 1581
// obligation produces was spoofable, and it stored a comma-joined hop list verbatim rather than an
// address. #155 fixed the DSAR path and extracted `clientIpFrom`; this closes the other eight.
//
// Two halves, because either alone is insufficient:
//   1. the derivation is unit-tested here for the first time (it was only ever exercised
//      indirectly, through the DSAR caller), and
//   2. a repo-wide scan bans the raw form, so a NEW call site cannot reintroduce it.
//
// The scan deliberately walks only RUNTIME source (packages/apps/workers), which is also why this
// file cannot match itself: `tests/` is never a walk root. That is not incidental — a governance
// tripwire in this repo has previously matched its own title string, so the banned literal below
// is confined to the regex and never appears in an `it(...)` name.

describe('clientIpFrom — the derivation itself', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('prefers the platform-edge header over the client-settable one', () => {
    expect(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '10.0.0.9' }))).toBe('10.0.0.9');
  });

  it('takes the LAST hop, never the attacker-chosen first', () => {
    // The attack: a client sends `1.2.3.4` and the trusted proxy appends its observation.
    expect(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.9' }))).toBe('10.0.0.9');
    expect(clientIpFrom(h({ 'x-forwarded-for': 'evil, a, b, 10.0.0.9' }))).toBe('10.0.0.9');
  });

  it('returns a single address, never the comma-joined hop list', () => {
    const out = clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.9' }));
    expect(out).not.toContain(',');
  });

  it('handles a single-hop header', () => {
    expect(clientIpFrom(h({ 'x-forwarded-for': '10.0.0.9' }))).toBe('10.0.0.9');
  });

  it('trims whitespace around hops', () => {
    expect(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4,   10.0.0.9  ' }))).toBe('10.0.0.9');
  });

  it('falls through a blank edge header rather than returning an empty string', () => {
    // `x-real-ip: ''` must not win — an empty audit IP is worse than a derived one.
    expect(clientIpFrom(h({ 'x-real-ip': '   ', 'x-forwarded-for': '10.0.0.9' }))).toBe('10.0.0.9');
  });

  it('ignores empty hops produced by a trailing comma', () => {
    expect(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.9, ' }))).toBe('10.0.0.9');
  });

  it('returns null when nothing is present', () => {
    expect(clientIpFrom(new Headers())).toBeNull();
    expect(clientIpFrom(h({ 'x-forwarded-for': '' }))).toBeNull();
    expect(clientIpFrom(h({ 'x-forwarded-for': ' , ' }))).toBeNull();
  });
});

const ROOT = join(__dirname, '..', '..');
/** The one module allowed to read the raw headers — it IS the derivation. */
const HELPER = 'packages/api/src/lib/client-ip.ts';
const ROOTS = ['packages', 'apps', 'workers'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.claude',
  '.next',
  '.turbo',
  '.vercel',
  'dist',
  'build',
  'out',
  'coverage',
  'generated',
]);

function walk(rel: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, rel));
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = `${rel}/${name}`;
    let st;
    try {
      st = statSync(join(ROOT, childRel));
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(childRel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(childRel);
  }
}

const FILES: string[] = [];
for (const r of ROOTS) walk(r, FILES);
const SOURCES = FILES.map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));

describe('no runtime source may re-derive the client IP by hand', () => {
  it('the walker actually found the files it claims to guard', () => {
    // Sentinels, not a bare count: a broken walk root would otherwise pass vacuously.
    expect(FILES).toContain(HELPER);
    expect(FILES).toContain('packages/api/src/trpc.ts');
    expect(FILES).toContain('packages/api/src/access/security-audit.ts');
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('only the shared helper reads the forwarding headers directly', () => {
    const offenders = SOURCES.filter(
      ({ file, text }) => file !== HELPER && /headers\.get\(\s*['"]x-(forwarded-for|real-ip)['"]\s*\)/i.test(text),
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('every audit writer that records an IP goes through the helper', () => {
    // Positive counterpart: banning the raw form is satisfiable by recording no IP at all, which
    // would silently drop the forensic field instead of fixing it. Pin that the writers still set
    // ipAddress, and that they set it from the helper.
    const writers = SOURCES.filter(({ text }) => /ipAddress:/.test(text) && /clientIpFrom\(/.test(text));
    expect(writers.length).toBeGreaterThanOrEqual(5);
    for (const { file, text } of writers) {
      const bad = /ipAddress:\s*[^,\n]*headers\.get\(/.test(text);
      expect(bad, `${file} still builds ipAddress from a raw header read`).toBe(false);
    }
  });
});
