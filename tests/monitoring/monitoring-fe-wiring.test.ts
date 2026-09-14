import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// #100 / PR #140 — the monitoring FE consumer tripwire (major findings 4 + 5).
//
// WHY THIS EXISTS. The C# monitoring read surface shipped with six FE wrapper hooks in
// apps/web/lib/platform-api/monitoring.ts and **zero consumers**: every live call site still went
// straight to `trpc.monitoring.*`. NEXT_PUBLIC_MONITORING_READ_VIA_CSHARP was therefore INERT —
// flipping it at cutover would have changed nothing, and the entire C# surface was unreachable
// from the product. Nothing in the suite noticed, because a hook with no callers still compiles,
// still type-checks, and still has passing unit tests.
//
// That is the defect class this file pins: not "does the wrapper work" but "is the wrapper WIRED".
//
// ── DERIVED FROM THE ROUTER, NOT FROM THE WRAPPER ───────────────────────────────────────────────
// The read set is derived from `packages/api/src/routers/monitoring.ts` — every `.query(`
// procedure — NOT from the wrapper's own fallback lines. Deriving it from the wrapper looks
// equivalent and is not: it can only ever see reads that were ALREADY ported, so a seventh read
// added to the router and consumed raw from apps/web would be absent from the derived set, never
// scanned for, and the suite would stay green. That is a false pass in the exact direction of the
// defect this file exists to catch. (Caught by the tier-3 panel, 2026-08-09 — the first version
// of this file derived from the wrapper.)
//
// The hook set still comes from the wrapper's `export function useMonitoring…` declarations,
// which is correct: it is the wrapper that must not grow an orphan.
//
// The counts below are pinned EXACTLY (6/6), not floored. That is a deliberate change-detector,
// not an oversight: porting a seventh read should require a human to come here and state that the
// new read is wired. An earlier comment claimed the derivation removed that obligation — it does
// not, and saying so was overstated.
//
// The scan walks apps/web as a DENY-LIST (prune what cannot hold first-party source) for the same
// reason tests/governance/calibration-no-ts-writers.test.ts does: an allow-list of directories
// fails by not looking, which is invisible. NOTE on `.claude` in SKIP_DIRS: it is defence in depth
// only. The walk is rooted at `apps/web`, and the stale workflow worktrees live at
// `.claude/worktrees/` in the REPO ROOT, so they are never a walk candidate today. Keeping the
// entry means that if WEB is ever widened to `.`, this file does not silently start asserting
// other branches' call sites. An earlier comment claimed the entry was load-bearing today; it is
// not, and that overstatement is corrected here rather than deleted.

const ROOT = join(__dirname, '..', '..');
const WEB = 'apps/web';
const WRAPPER = `${WEB}/lib/platform-api/monitoring.ts`;
const ROUTER = 'packages/api/src/routers/monitoring.ts';
/** A file that must exist under the walk root — a floor guard that actually bites (see below). */
const SENTINEL = `${WEB}/app/(admin)/monitoring/page.tsx`;

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
const routerSrc = readFileSync(join(ROOT, ROUTER), 'utf8');

/**
 * Every READ on the monitoring router — a procedure whose builder chain ends in `.query(`.
 * Writes (`.mutation(`) are excluded: `configureAlertRules` and `dismissAlert` were not ported and
 * legitimately stay on tRPC. Derived from the ROUTER so a newly-added read is in scope on the day
 * it is written, not the day it is ported.
 */
// Split on the procedure-name boundary rather than trying to match a closing brace: the
// procedures in this router do NOT share a closing indent (`getExecutiveKpis` closes at 2 spaces,
// `getActiveAlerts` at 4, because the latter has an `.input(...)` link in the chain). A
// brace-matching regex silently swallowed the next procedure; a boundary split cannot.
const PROC_STARTS = [...routerSrc.matchAll(/^ {2}(\w+): permissionProcedure\(/gm)];
const ROUTER_READS = PROC_STARTS.filter((m, i) => {
  const body = routerSrc.slice(m.index!, PROC_STARTS[i + 1]?.index ?? routerSrc.length);
  return /\.query\(/.test(body);
}).map((m) => m[1]);

/** The reads the wrapper actually offers a C# path for — off its own tRPC-fallback branch. */
const PORTED_READS = [...wrapperSrc.matchAll(/trpc\.monitoring\.(\w+)\.useQuery/g)].map((m) => m[1]);

/** The hooks the wrapper exposes. */
const HOOKS = [...wrapperSrc.matchAll(/export function (useMonitoring\w+)/g)].map((m) => m[1]);

describe('monitoring FE wiring — the C# surface must be REACHABLE', () => {
  // Floor guards. Every assertion below is a quantifier over these two sets; if a refactor made
  // either derivation return nothing, the whole file would pass vacuously and go on reporting
  // green while asserting nothing at all. Pin the counts so that failure is loud.
  it('the walker and every derivation found what they should have', () => {
    // A SENTINEL, not a bare count. `FILES.length > 100` was the previous floor and it did not
    // bite: apps/web has far more than 100 files, so the walker could lose the entire
    // app/(admin) subtree — the exact subtree every consumer lives in — and still clear it.
    expect(FILES).toContain(SENTINEL);
    expect(FILES.length).toBeGreaterThan(100);
    expect(ROUTER_READS).toHaveLength(6);
    expect(PORTED_READS).toHaveLength(6);
    expect(HOOKS).toHaveLength(6);
    // No duplicates: two hooks falling back to the same read would keep the length at 6 while
    // leaving one real read uncovered by the offenders scan below.
    expect(new Set(PORTED_READS).size).toBe(PORTED_READS.length);
  });

  it('the wrapper covers EVERY read the router exposes', () => {
    // Closes the false-pass hole: a read added to the router and consumed raw from apps/web is
    // invisible to a wrapper-derived set. Derived from the router, so it is in scope immediately.
    expect([...PORTED_READS].sort()).toEqual([...ROUTER_READS].sort());
  });

  it('every router read is consumed ONLY through the wrapper, never raw tRPC', () => {
    // The finding, stated as an executable invariant. The wrapper itself is the one legitimate
    // holder of these references — it is where the tRPC fallback path lives.
    //
    // Quantified over ROUTER_READS, not PORTED_READS: an unported read consumed raw is precisely
    // the regression this must catch, and it would not be in the ported set.
    const offenders: string[] = [];
    for (const { file, text } of SOURCES) {
      if (file === WRAPPER) continue;
      for (const read of ROUTER_READS) {
        // Both spellings. `trpc.monitoring.X` is the direct call; `utils.monitoring.X.<method>`
        // reaches the SAME tRPC cache through `trpc.useUtils()` — `.fetch()` / `.ensureData()` /
        // `.prefetch()` would re-orphan the wrapper just as effectively as a raw useQuery, and
        // the first version of this file matched only the former. `.invalidate()` is the one
        // legitimate utils method here (alert-rules-modal keeps it deliberately), so it alone is
        // exempt — the exemption is on the METHOD, not on the file, so a new file cannot smuggle
        // a fetch past it.
        if (new RegExp(`trpc\\.monitoring\\.${read}\\b`).test(text)) offenders.push(`${file} → trpc.${read}`);
        const utilsMisuse = new RegExp(`utils\\.monitoring\\.${read}\\.(?!invalidate\\b)(\\w+)`).exec(text);
        if (utilsMisuse) offenders.push(`${file} → utils.${read}.${utilsMisuse[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the C# branch is reachable at all — the flag must keep its NEXT_PUBLIC_ prefix', () => {
    // The tripwire could not see the flag. Proven by mutation 2026-08-09: dropping the
    // `NEXT_PUBLIC_` prefix makes Next.js stop inlining the value into the client bundle
    // (.claude/rules/frontend.md), so `viaCSharp()` is permanently false, the C# surface is
    // unreachable from the product, and the cutover flag flip changes nothing — the original
    // finding verbatim — while all six assertions in the previous version of this file passed.
    expect(wrapperSrc).toMatch(/process\.env\.NEXT_PUBLIC_MONITORING_READ_VIA_CSHARP === 'true'/);
    // The gate is BOTH conditions: a base URL and the per-surface flag.
    expect(wrapperSrc).toMatch(/isPlatformApiEnabled\(\)\s*&&\s*MONITORING_READ_VIA_CSHARP/);
    // Any client-read env var here must carry the prefix, or it silently reads `undefined` in the
    // browser. Derived over every `process.env.X` in the file rather than pinning the one name.
    const envReads = [...wrapperSrc.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]);
    expect(envReads.length).toBeGreaterThan(0);
    expect(envReads.filter((v) => !v.startsWith('NEXT_PUBLIC_'))).toEqual([]);
  });

  it('the suppression-bearing fields route through the null-preserving mappers', () => {
    // `number` widens silently into `number | null`, so tsc does NOT catch a bare Number() on
    // these two fields — unlike the Date fields, where Date vs string makes the compiler the
    // enforcer. Mutation-proved 2026-08-09: both swaps left tsc at exit 0 and 85 tests green.
    expect(wrapperSrc).toMatch(/return mapExecutiveKpis\(raw\)/);
    expect(wrapperSrc).toMatch(/raw\.data\.map\(mapTrendPoint\)/);
    // And the mappers themselves must preserve null. Wide region on purpose: a negative assertion
    // narrowed to one block silently drops coverage of everything outside it.
    expect(wrapperSrc).toMatch(/pendingAdjustments: numberOrNull\(/);
    expect(wrapperSrc).not.toMatch(/pendingAdjustments: Number\(/);
    expect(wrapperSrc).not.toMatch(/value: Number\(/);
  });

  it('every wrapper hook has at least one real consumer', () => {
    // The direct anti-"zero consumers" assertion. A hook nobody calls means that slice of the C#
    // surface is unreachable no matter what the env flag says.
    const unconsumed = HOOKS.filter(
      (hook) => !SOURCES.some(({ file, text }) => file !== WRAPPER && new RegExp(`\\b${hook}\\s*\\(`).test(text)),
    );
    expect(unconsumed).toEqual([]);
  });

  it('the alert-rule write invalidates BOTH cache families', () => {
    // Major finding 5. configureAlertRules is a WRITE and was not ported, so it stays a tRPC
    // mutation whose onSuccess invalidates tRPC cache keys. Those keys are a DIFFERENT cache from
    // the ['platform-api','monitoring'] keys the six hooks use once the flag is on — so with only
    // the tRPC invalidates, a rule save after cutover would refresh nothing and the dashboard
    // would serve stale rules, alerts, KPIs and module health indefinitely.
    const modal = SOURCES.find((s) => s.file.endsWith('monitoring/alert-rules-modal.tsx'));
    expect(modal).toBeDefined();
    const text = modal!.text;

    // The tRPC half — still the live path while the flag is off. Asserted per key rather than as
    // one block: a single regex over the onSuccess body would pass if any ONE of the four survived.
    for (const key of ['getAlertRules', 'getActiveAlerts', 'getExecutiveKpis', 'getModuleHealth']) {
      expect(text).toMatch(new RegExp(`utils\\.monitoring\\.${key}\\.invalidate\\(`));
    }
    // The platform-api half — the live path after cutover.
    expect(text).toMatch(/invalidateMonitoringPlatformReads\(\s*queryClient\s*\)/);
  });

  it('the invalidation helper covers the whole platform-api monitoring key prefix', () => {
    // A helper that invalidated one leaf key would satisfy the call-site assertion above while
    // leaving the other five reads stale — so pin the PREFIX, which is what makes it cover all six.
    expect(wrapperSrc).toMatch(/export function invalidateMonitoringPlatformReads/);
    expect(wrapperSrc).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['platform-api',\s*'monitoring'\]\s*\}\)/);
  });

  it('every hook is still dual-path — the flag must remain a reversible switch', () => {
    // The cutover contract: each hook calls BOTH paths and returns the selected one, so the flag
    // can be flipped back without a code change. A hook rewritten to call only the C# path would
    // make NEXT_PUBLIC_MONITORING_READ_VIA_CSHARP one-way.
    expect(PORTED_READS).toHaveLength(HOOKS.length);
    const returns = wrapperSrc.match(/return enabled \? csharpQuery : trpcQuery;/g) ?? [];
    expect(returns).toHaveLength(HOOKS.length);
  });
});
