import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// #174 — the C# half of the audit-IP fix, guarded the same way the TS half is.
//
// This lives in the vitest suite rather than in xUnit deliberately. The equivalent C# check would
// have to walk its own source tree from inside a test assembly, which is awkward and — more to the
// point — it would be a NEW piece of machinery, whereas the TS suite already owns a proven
// source-scanning idiom (tests/governance/*). The invariant is about source text, not runtime
// behaviour, so the language it is written in does not matter. What matters is that it runs on
// every push, which it does here.
//
// Behavioural parity between the two stacks is pinned separately, and properly, by the shared
// goldens: contracts/client-ip-fixtures/cases.json, asserted by BOTH
// tests/governance/audit-ip-derivation.test.ts and Tims.UnitTests/Http/ClientIpFixtureTests.cs.

const ROOT = join(__dirname, '..', '..');
const SRC = 'services/Tims.Platform/src';

/**
 * The two files allowed to read the forwarding headers directly:
 *   - the Domain primitive's own doc comment quotes the header names in prose, and
 *   - the API adapter is the single place a request becomes those two strings.
 * `RateLimitMiddleware` also reads them, but it hands both raw values straight to
 * `RateLimitIdentity`, which delegates to the same primitive — so it re-derives nothing.
 */
const ALLOWED = new Set([
  `${SRC}/Tims.Domain/Http/ClientIp.cs`,
  `${SRC}/Tims.Api/Http/HttpContextClientIp.cs`,
  `${SRC}/Tims.Api/RateLimiting/RateLimitMiddleware.cs`,
  `${SRC}/Tims.Domain/RateLimiting/RateLimitIdentity.cs`,
]);

const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git']);

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
    else if (name.endsWith('.cs')) out.push(childRel);
  }
}

const FILES: string[] = [];
walk(SRC, FILES);
const SOURCES = FILES.map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));

describe('C# audit writers must not re-derive the client IP by hand', () => {
  it('the walker found the C# source it claims to guard', () => {
    // Sentinels rather than a bare count — a broken walk root would otherwise pass vacuously.
    expect(FILES).toContain(`${SRC}/Tims.Domain/Http/ClientIp.cs`);
    expect(FILES).toContain(`${SRC}/Tims.Api/Http/HttpContextClientIp.cs`);
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('only the shared primitive and its adapter touch the forwarding headers', () => {
    const offenders = SOURCES.filter(
      ({ file, text }) => !ALLOWED.has(file) && /Headers\[\s*"x-(forwarded-for|real-ip)"\s*\]/i.test(text),
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('no endpoint reintroduces the private ClientIp helper that #174 deleted', () => {
    // The exact shape that existed in three endpoint files, each an independent copy of the rule.
    const offenders = SOURCES.filter(({ text }) => /private\s+static\s+string\?\s+ClientIp\s*\(/.test(text)).map(
      ({ file }) => file,
    );
    expect(offenders).toEqual([]);
  });

  it('the audit writers actually still record an IP', () => {
    // Positive counterpart. Banning the raw read is satisfiable by recording nothing at all, which
    // would drop the forensic field rather than fix it — the same gap the TS tripwire closes.
    const users = SOURCES.filter(({ text }) => /ClientIpFor\(\)/.test(text));
    expect(users.length).toBeGreaterThanOrEqual(7);
  });
});
