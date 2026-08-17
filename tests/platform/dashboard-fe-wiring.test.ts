import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// #81 step 4 — the platform-dashboard FE consumer tripwire, adapted from
// tests/monitoring/monitoring-fe-wiring.test.ts (#100 / PR #140).
//
// WHY THIS EXISTS. The monitoring C# surface once shipped six wrapper hooks with ZERO consumers:
// every live call site still went straight to tRPC, so the cutover flag was INERT and nothing in
// the suite noticed — a hook with no callers still compiles, still type-checks, and still has
// passing unit tests. This file pins the same invariants for the dashboard cluster: not "does the
// wrapper work" but "is the wrapper WIRED".
//
// TWO dashboard-specific differences from the monitoring original:
//
//   1. The read set spans FOUR router files (dashboard.ts + its churn/forecast/upsell siblings),
//      all merged FLAT into `platformRouter` — consumers call `trpc.platform.<proc>`, with no
//      `.dashboard.` segment. The derivation walks all four, and is from the ROUTERS, not the
//      wrapper: a wrapper-derived set can only see already-ported reads (the tier-3 finding on the
//      first monitoring version).
//
//   2. THIRTEEN router reads, TWELVE hooks, deliberately. `getUserGrowth` has zero consumers
//      anywhere in apps/web (no user-growth chart exists), so a hook for it would itself be the
//      orphan this file exists to catch. The exception is pinned BY NAME below; the raw-tRPC scan
//      still quantifies over all thirteen, so the day a user-growth consumer appears it must come
//      through a new wrapper hook — adding it then is the wired path, not an exemption.
//
// EXTRA PIN this surface needs and monitoring did not: the wrapper calls `platformGetRaw`, whose
// path argument is UNTYPED (every dashboard endpoint declares `.Produces(200)` without `<T>`, so
// the OpenAPI 200 carries no body type and the typed `platformGet` cannot accept these paths).
// A typo'd path compiles clean and 404s at runtime — so every path literal in the wrapper is
// cross-checked against contracts/openapi/Tims.Api.json, the same contract CI keeps in sync with
// the C# routes.

const ROOT = join(__dirname, '..', '..');
const WEB = 'apps/web';
const WRAPPER = `${WEB}/lib/platform-api/dashboard.ts`;
const ROUTER_FILES = [
  'packages/api/src/routers/platform/dashboard.ts',
  'packages/api/src/routers/platform/dashboard-churn.ts',
  'packages/api/src/routers/platform/dashboard-forecast.ts',
  'packages/api/src/routers/platform/dashboard-upsell.ts',
];
const CONTRACT = 'contracts/openapi/Tims.Api.json';
/** The one router read with no apps/web consumer and therefore, deliberately, no hook. */
const UNPORTED = ['getUserGrowth'];
/** A file that must exist under the walk root — a sentinel floor guard, not a bare count. */
const SENTINEL = `${WEB}/app/(admin)/dashboard/platform-dashboard.tsx`;

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
      continue; // broken symlink
    }
    if (st.isDirectory()) walk(childRel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(childRel);
  }
}

const FILES: string[] = [];
walk(WEB, FILES);
const SOURCES = FILES.map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));
const wrapperSrc = readFileSync(join(ROOT, WRAPPER), 'utf8');

/**
 * Every READ across the four dashboard routers — a `platformProcedure` whose builder chain ends in
 * `.query(`. Split on the procedure-name boundary rather than brace-matching, for the same reason
 * the monitoring original does: `search` has an `.input(...)` link so the procedures do not share
 * a closing indent, and a brace-matching regex silently swallowed the next procedure there.
 */
const ROUTER_READS = ROUTER_FILES.flatMap((rel) => {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const starts = [...src.matchAll(/^ {2}(\w+): platformProcedure/gm)];
  return starts
    .filter((m, i) => /\.query\(/.test(src.slice(m.index!, starts[i + 1]?.index ?? src.length)))
    .map((m) => m[1]);
});

/** The reads the wrapper offers a C# path for — off its own tRPC-fallback branch. */
const PORTED_READS = [...wrapperSrc.matchAll(/trpc\.platform\.(\w+)\.useQuery/g)].map((m) => m[1]);

/** The hooks the wrapper exposes. */
const HOOKS = [...wrapperSrc.matchAll(/export function (useDashboard\w+)/g)].map((m) => m[1]);

/** The C# routes for this cluster, straight from the committed OpenAPI contract. */
const CONTRACT_PATHS = Object.keys(
  (JSON.parse(readFileSync(join(ROOT, CONTRACT), 'utf8')) as { paths: Record<string, unknown> }).paths,
).filter((p) => p.startsWith('/platform/dashboard/'));

describe('dashboard FE wiring — the C# surface must be REACHABLE', () => {
  // Floor guards. Every assertion below quantifies over these sets; a derivation that silently
  // returned nothing would make the whole file pass vacuously. Counts are pinned EXACTLY as a
  // change-detector: porting a fourteenth read (or wiring getUserGrowth) must bring a human here.
  it('the walker and every derivation found what they should have', () => {
    expect(FILES).toContain(SENTINEL);
    expect(FILES.length).toBeGreaterThan(100);
    expect(ROUTER_READS).toHaveLength(13);
    expect(PORTED_READS).toHaveLength(12);
    expect(HOOKS).toHaveLength(12);
    expect(CONTRACT_PATHS).toHaveLength(13);
    // No duplicates: two hooks falling back to the same read would keep the length at 12 while
    // leaving one real read uncovered by the offenders scan below.
    expect(new Set(PORTED_READS).size).toBe(PORTED_READS.length);
    expect(new Set(ROUTER_READS).size).toBe(ROUTER_READS.length);
  });

  it('the wrapper covers every router read EXCEPT the pinned no-consumer exception', () => {
    const uncovered = ROUTER_READS.filter((r) => !PORTED_READS.includes(r)).sort();
    // getUserGrowth: zero consumers in apps/web, so a hook would be an orphan (the defect class
    // this file catches). The C# endpoint exists and stays parity-covered; only the FE hook is
    // deliberately absent. If this assertion fails with an EMPTY array, someone wired user-growth
    // — delete the exception. If it fails with MORE names, reads were added without hooks.
    expect(uncovered).toEqual([...UNPORTED].sort());
    expect(PORTED_READS.filter((r) => UNPORTED.includes(r))).toEqual([]);
  });

  it('every router read is consumed ONLY through the wrapper, never raw tRPC', () => {
    // Quantified over ALL THIRTEEN router reads, not the twelve ported ones: an unported read
    // consumed raw (the future user-growth chart) is precisely the regression this must catch.
    const offenders: string[] = [];
    for (const { file, text } of SOURCES) {
      if (file === WRAPPER) continue;
      for (const read of ROUTER_READS) {
        // Both spellings — the direct hook call and the `trpc.useUtils()` cache methods
        // (`.fetch()` / `.ensureData()` / `.prefetch()` re-orphan the wrapper just as effectively).
        // `.invalidate()` alone is exempt, on the METHOD not the file, matching the monitoring
        // precedent: a future write's onSuccess may legitimately invalidate the tRPC family.
        if (new RegExp(`trpc\\.platform\\.${read}\\b`).test(text)) offenders.push(`${file} → trpc.${read}`);
        const utilsMisuse = new RegExp(`utils\\.platform\\.${read}\\.(?!invalidate\\b)(\\w+)`).exec(text);
        if (utilsMisuse) offenders.push(`${file} → utils.${read}.${utilsMisuse[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every platformGetRaw path literal exists in the OpenAPI contract', () => {
    // THE pin for the untyped-path hazard: platformGetRaw paths are not compile-checked, so a
    // typo'd literal compiles clean and 404s at runtime. The contract is regenerated from the C#
    // routes by CI ("OpenAPI contract is up to date"), so agreement here means agreement with the
    // deployed route table.
    const used = [...wrapperSrc.matchAll(/platformGetRaw\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(used).toHaveLength(12);
    expect(new Set(used).size).toBe(used.length);
    const unknown = used.filter((p) => !CONTRACT_PATHS.includes(p));
    expect(unknown).toEqual([]);
    // And the inverse: the only contract route the wrapper does not call is the pinned exception.
    const uncalled = CONTRACT_PATHS.filter((p) => !used.includes(p));
    expect(uncalled).toEqual(['/platform/dashboard/user-growth']);
  });

  it('the C# branch is reachable at all — the flag must keep its NEXT_PUBLIC_ prefix', () => {
    // Proven by mutation on the monitoring twin (2026-08-09): dropping the prefix makes Next.js
    // stop inlining the value into the client bundle, `viaCSharp()` is permanently false, and the
    // cutover flag flip changes nothing — while every other assertion here stays green.
    expect(wrapperSrc).toMatch(/process\.env\.NEXT_PUBLIC_DASHBOARD_READ_VIA_CSHARP === 'true'/);
    // The gate is BOTH conditions: a base URL and the per-surface flag.
    expect(wrapperSrc).toMatch(/isPlatformApiEnabled\(\)\s*&&\s*DASHBOARD_READ_VIA_CSHARP/);
    // Any client-read env var here must carry the prefix, or it silently reads `undefined` in the
    // browser. Derived over every `process.env.X` in the file rather than pinning the one name.
    const envReads = [...wrapperSrc.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]);
    expect(envReads.length).toBeGreaterThan(0);
    expect(envReads.filter((v) => !v.startsWith('NEXT_PUBLIC_'))).toEqual([]);
  });

  it('the three inverted-at-zero fields route through the null-preserving mappers', () => {
    // `number` widens silently into `number | null`, so tsc does NOT catch a bare Number() on
    // these — unlike the two Date fields, where Date vs string makes the compiler the enforcer.
    // (Mutation-proved on the monitoring twin, 2026-08-09; same widening, same silence.)
    expect(wrapperSrc).toMatch(/monthlyBudget: numberOrNull\(/);
    expect(wrapperSrc).not.toMatch(/monthlyBudget: Number\(/);
    expect(wrapperSrc).toMatch(/trialDaysLeft: numberOrNull\(/);
    expect(wrapperSrc).not.toMatch(/trialDaysLeft: Number\(/);
    // daysSinceLastLogin appears on TWO wires with DIFFERENT rules, so neither a bare positive
    // nor a bare negative assertion can pin it. churn-risk null-preserves (null = no login ever);
    // customer-health keeps the raw 999 sentinel (the TS procedure does). Exactly one of each —
    // a count of one apiece means neither mapper absorbed the other's rule.
    expect(wrapperSrc.match(/daysSinceLastLogin: numberOrNull\(/g)).toHaveLength(1);
    expect(wrapperSrc.match(/daysSinceLastLogin: Number\(/g)).toHaveLength(1);
    // The optional-key numerics must not collapse null/absent to NaN-vs-0 asymmetry either.
    expect(wrapperSrc).toMatch(/amount: numberOrUndefined\(/);
    expect(wrapperSrc).toMatch(/daysUntil: numberOrUndefined\(/);
    expect(wrapperSrc).not.toMatch(/amount: Number\(/);
    expect(wrapperSrc).not.toMatch(/daysUntil: Number\(/);
  });

  it('every wrapper hook has at least one real consumer', () => {
    // The direct anti-"zero consumers" assertion. A hook nobody calls means that slice of the C#
    // surface is unreachable no matter what the env flag says.
    const unconsumed = HOOKS.filter(
      (hook) => !SOURCES.some(({ file, text }) => file !== WRAPPER && new RegExp(`\\b${hook}\\s*\\(`).test(text)),
    );
    expect(unconsumed).toEqual([]);
  });

  it('every hook is still dual-path — the flag must remain a reversible switch', () => {
    // The cutover contract: each hook calls BOTH paths and returns the selected one, so the flag
    // can be flipped back without a code change. A hook rewritten to call only the C# path would
    // make NEXT_PUBLIC_DASHBOARD_READ_VIA_CSHARP one-way.
    expect(PORTED_READS).toHaveLength(HOOKS.length);
    const returns = wrapperSrc.match(/return enabled \? csharpQuery : trpcQuery;/g) ?? [];
    expect(returns).toHaveLength(HOOKS.length);
  });

  it('no invalidation helper, deliberately — and nothing needs one', () => {
    // The dashboard cluster is read-only: no write was ported and no tRPC mutation's onSuccess
    // touches these reads. If either side of that changes, this pin forces the monitoring
    // treatment (dual-family invalidation) instead of a silent stale-cache-after-cutover.
    expect(wrapperSrc).not.toMatch(/invalidateQueries/);
    const invalidators: string[] = [];
    for (const { file, text } of SOURCES) {
      for (const read of ROUTER_READS) {
        if (new RegExp(`utils\\.platform\\.${read}\\.invalidate\\(`).test(text)) {
          invalidators.push(`${file} → utils.${read}.invalidate`);
        }
      }
    }
    expect(invalidators).toEqual([]);
  });
});
