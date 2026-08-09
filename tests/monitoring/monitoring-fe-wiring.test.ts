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
// ── DERIVED, NOT LISTED ─────────────────────────────────────────────────────────────────────────
// Both halves of the invariant are derived from the wrapper source, never hardcoded here:
//   • the set of PORTED READS comes from the wrapper's own tRPC-fallback lines, and
//   • the set of HOOKS comes from its `export function useMonitoring…` declarations.
// So a seventh read ported tomorrow is covered the day it is added, rather than the day someone
// remembers to extend a literal array in this file. A hardcoded list is the same shape of bug as
// the one above — silently correct until the thing it enumerates changes.
//
// The scan walks apps/web as a DENY-LIST (prune what cannot hold first-party source) for the same
// reason tests/governance/calibration-no-ts-writers.test.ts does: an allow-list of directories
// fails by not looking, which is invisible. `.claude` matters more than it looks — workflow
// worktrees are checked out under `.claude/worktrees/`, so without pruning it this test would scan
// several complete copies of the repo and report their call sites as this branch's.

const ROOT = join(__dirname, '..', '..');
const WEB = 'apps/web';
const WRAPPER = `${WEB}/lib/platform-api/monitoring.ts`;

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

/** The reads this slice ported — read off the wrapper's own tRPC-fallback branch. */
const PORTED_READS = [...wrapperSrc.matchAll(/trpc\.monitoring\.(\w+)\.useQuery/g)].map((m) => m[1]);

/** The hooks the wrapper exposes. */
const HOOKS = [...wrapperSrc.matchAll(/export function (useMonitoring\w+)/g)].map((m) => m[1]);

describe('monitoring FE wiring — the C# surface must be REACHABLE', () => {
  // Floor guards. Every assertion below is a quantifier over these two sets; if a refactor made
  // either derivation return nothing, the whole file would pass vacuously and go on reporting
  // green while asserting nothing at all. Pin the counts so that failure is loud.
  it('the walker and both derivations found something', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(PORTED_READS).toHaveLength(6);
    expect(HOOKS).toHaveLength(6);
  });

  it('every ported read is consumed ONLY through the wrapper, never raw tRPC', () => {
    // The finding, stated as an executable invariant. The wrapper itself is the one legitimate
    // holder of these references — it is where the tRPC fallback path lives.
    const offenders: string[] = [];
    for (const { file, text } of SOURCES) {
      if (file === WRAPPER) continue;
      for (const read of PORTED_READS) {
        const re = new RegExp(`trpc\\.monitoring\\.${read}\\b`);
        if (re.test(text)) offenders.push(`${file} → ${read}`);
      }
    }
    expect(offenders).toEqual([]);
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
