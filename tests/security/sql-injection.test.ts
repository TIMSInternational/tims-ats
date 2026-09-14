import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// #189 — SQL-injection prevention, repo-wide.
//
// WHY THE SCOPE CHANGED. This file used to scan `packages/api/src` and nothing else. The
// ownership-flip runbook's §0 P1 actively DIRECTS people to write raw SQL outside that directory:
// a seed writer must be "ported to raw SQL, ported to a C# seeder (none exists today), or the flip
// is blocked". Two flips have already taken that route, both landing in
// `packages/db/prisma/seed-demo.ts` — `critical_roles`/`successors` (#69, :1795-1822) and
// `surveys`/`survey_responses` (#188, :2228-2266). Every future flip adds more.
//
// So the one directory the process pushes hand-written SQL into was the one directory no injection
// control could see. The statements there are clean — they are genuine Prisma tagged templates whose
// interpolations become bound parameters — but nothing stopped the NEXT edit reaching for
// `$executeRawUnsafe`.
//
// SCANNING STRATEGY: DENY-LIST, NOT ALLOW-LIST. Walk the whole repository and prune what cannot hold
// first-party source. This is the shape the governance tripwires settled on
// (tests/governance/calibration-no-ts-writers.test.ts), whose docblock records that an allow-list of
// roots was demonstrably unsound — `packages/ai/src` was never scanned yet calls Prisma delegates. A
// package added tomorrow is covered automatically rather than by someone remembering to list it.
//
// WHAT IS DELIBERATELY NOT SCANNED: `*.test.ts` / `*.spec.ts`. A test that asserts about
// `$queryRawUnsafe` has to be able to NAME it — `tests/perf/s2-no-loop.test.ts:33` does exactly that,
// and so does this file. Tests do not run against production. This is the only exclusion, and the
// floors below prove it does not swallow the real source tree.

const ROOT = join(__dirname, '..', '..');

/**
 * Pruned anywhere in the tree. `.claude` is load-bearing: workflow worktrees are checked out under
 * `.claude/worktrees/`, so without it this scans several complete copies of the repo and reports
 * their hits as this branch's.
 */
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
  'bin',
  'obj',
]);

/** This file quotes every forbidden pattern, so it must never scan itself. */
const SELF = 'tests/security/sql-injection.test.ts';

function walk(rel: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, rel) || ROOT);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    let st;
    try {
      st = statSync(join(ROOT, childRel));
    } catch {
      continue; // broken symlink
    }
    if (st.isDirectory()) {
      walk(childRel, out);
    } else if (/\.(ts|tsx|mts|cts)$/.test(name) && childRel !== SELF) {
      out.push(childRel);
    }
  }
}

const ALL_FILES: string[] = [];
walk('', ALL_FILES);

/** Tests may name the forbidden patterns; nothing else may. See the docblock. */
const SCANNED = ALL_FILES.filter((f) => !/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f)).map((file) => ({
  file,
  text: readFileSync(join(ROOT, file), 'utf8'),
}));

/**
 * `$queryRaw(` / `$executeRaw(` CALLED as a function with a template literal containing `${}`.
 * The safe form is a TAGGED template — `` $queryRaw`… ${x} …` `` with no parentheses — where Prisma
 * receives the interpolations as a values array and emits positional placeholders. Adding parens
 * evaluates the template to a plain string FIRST, so the value is spliced into the SQL text.
 */
const CALLED_WITH_TEMPLATE = /\$(?:query|execute)Raw\s*\(\s*`[^`]*\$\{/;

describe('SQL Injection Prevention', () => {
  // Every assertion below is a `.toEqual([])`. An empty or partial scan satisfies all of them —
  // the exact failure mode that let /gate checks 14 and 17 tick against a database with no rows.
  describe('the scan is not vacuous', () => {
    // Per-directory floors, NOT an aggregate: apps/web alone contributes ~448 files, so an aggregate
    // floor lets the whole of packages/api/src go blind while still passing. Floors are measured
    // AFTER the test-file exclusion, which is not the same number as the raw file count — `scripts/`
    // holds 35 `.ts` files but 16 of them are tests, so its scanned count is 19, not 35. Measured
    // 2026-08-10 (scanned → floor): api/src 183→170, apps/web 448→400, db/prisma 8→5,
    // shared/src 24→20, ai/src 21→15, workers 1→1, scripts 19→15.
    const MUST_SCAN: [string, number][] = [
      ['packages/api/src', 170],
      ['apps/web', 400],
      ['packages/db/prisma', 5],
      ['packages/shared/src', 20],
      ['packages/ai/src', 15],
      ['workers', 1],
      ['scripts', 15],
    ];

    it.each(MUST_SCAN)('scanned %s (at least %i files)', (dir, floor) => {
      expect(
        existsSync(join(ROOT, dir)),
        `${dir} does not exist — it was renamed or moved. Update MUST_SCAN; do NOT delete the entry, or this scan goes blind to it.`,
      ).toBe(true);
      const n = SCANNED.filter((s) => s.file.startsWith(`${dir}/`)).length;
      expect(n, `${dir} contributed ${n} files, expected >= ${floor}`).toBeGreaterThanOrEqual(floor);
    });

    // The whole point of #189. If the walker stops reaching the seed, every assertion still passes.
    it('reaches packages/db/prisma/seed-demo.ts, the file #189 was filed for', () => {
      expect(SCANNED.map((s) => s.file)).toContain('packages/db/prisma/seed-demo.ts');
    });

    it('excludes only test files, and not much else', () => {
      const excluded = ALL_FILES.length - SCANNED.length;
      expect(excluded).toBeGreaterThan(100); // there really are that many test files
      expect(SCANNED.length).toBeGreaterThan(650);
    });
  });

  describe('the matchers are not broken', () => {
    it('CALLED_WITH_TEMPLATE matches the unsafe called form', () => {
      expect(CALLED_WITH_TEMPLATE.test('await db.$queryRaw(`SELECT * FROM t WHERE id = ${id}`)')).toBe(true);
      expect(CALLED_WITH_TEMPLATE.test('await db.$executeRaw(`DELETE FROM t WHERE id = ${id}`)')).toBe(true);
    });

    it('CALLED_WITH_TEMPLATE does NOT match the safe tagged-template form', () => {
      // This is the form seed-demo.ts and every repository in packages/api use.
      expect(CALLED_WITH_TEMPLATE.test('await db.$queryRaw`SELECT id FROM surveys WHERE id = ${id}`')).toBe(false);
      expect(CALLED_WITH_TEMPLATE.test('await db.$executeRaw`INSERT INTO t (id) VALUES (${id})`')).toBe(false);
    });
  });

  it('should NOT use $executeRawUnsafe anywhere', () => {
    const violations = SCANNED.filter((s) => s.text.includes('$executeRawUnsafe')).map((s) => s.file);
    expect(
      violations,
      `$executeRawUnsafe interpolates its argument into the SQL text. Use $executeRaw as a TAGGED\n` +
        `template so the values are bound. CLAUDE.md lists this as an auto-reject:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('should NOT use $queryRawUnsafe anywhere', () => {
    const violations = SCANNED.filter((s) => s.text.includes('$queryRawUnsafe')).map((s) => s.file);
    expect(
      violations,
      `$queryRawUnsafe interpolates its argument into the SQL text. Use $queryRaw as a TAGGED\n` +
        `template so the values are bound:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('should NOT use string interpolation in raw SQL', () => {
    const violations = SCANNED.filter((s) => CALLED_WITH_TEMPLATE.test(s.text)).map((s) => s.file);
    expect(
      violations,
      `$queryRaw/$executeRaw CALLED with parentheses around a template literal evaluates the template\n` +
        `to a string first, so \${…} is spliced into the SQL. Drop the parentheses — the tagged form\n` +
        `binds them as parameters:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
