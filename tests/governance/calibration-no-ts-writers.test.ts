import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// #57 / #70 — the calibration_* TS-writer tripwire.
//
// WHY THIS EXISTS. Ownership flip #70 moved calibration_sessions / calibration_members /
// calibration_votes from `efcoreStranglerWrite` to `efcore` in docs/architecture/table-ownership.md
// and deleted their three Prisma models (EXECUTED 2026-08-06 — runbook §7d). Its precondition was
// that NOTHING in TypeScript reaches those tables through Prisma. #57 established that (the ninebox
// router was the last one and is deleted); this test PINNED it until the flip landed.
//
// It pins an INVARIANT (zero Prisma reach into these three models), not an era, so it survives the
// flip with its job changed rather than finished. POST-FLIP it guards the other direction: a
// reintroduced delegate reference no longer compiles (the models are gone), but this test fails
// FIRST and with a message that names the flip — and, crucially, it is the thing that catches the
// re-addition of a Prisma MODEL, which on its own compiles fine. The ledger assertion at the bottom
// of this file was inverted at flip time for the same reason; see its docblock.
//
// ── SCANNING STRATEGY: DENY-LIST, NOT ALLOW-LIST ────────────────────────────────────────────────
// An earlier version of this file listed seven source roots explicitly. That is the wrong shape for
// a governance tripwire and it was demonstrably unsound: `packages/ai/src` was never scanned, yet it
// calls Prisma delegates today (registry.ts `db.aiAgent.upsert`, logger.ts `db.aiAgentUsageLog.create`)
// and is compiled into the API runtime. A calibration write added there would have left every
// assertion green while the flip's precondition was false.
//
// So: walk the WHOLE repository and prune what cannot contain first-party source. A package added
// tomorrow is scanned automatically. The failure mode of a deny-list (scanning something harmless)
// is a false positive you notice; the failure mode of an allow-list is a false negative you do not.
//
// WHAT IT DELIBERATELY DOES NOT FORBID. scripts/parity/seed.ts writes all three tables with RAW SQL
// (`db.query('INSERT INTO calibration_sessions …')`) on a `pg` client, and scripts/parity/write-surfaces.ts
// SELECTs them for read-back assertions. That is the parity-fixture harness running against the
// parity/staging database — not a runtime application path, and not a Prisma delegate, so it
// survives model deletion and does not block #70. Raw SQL in the RUNTIME packages is a different
// matter and IS forbidden below.

const ROOT = join(__dirname, '..', '..');

/**
 * Directory names pruned anywhere in the tree. `.claude` matters more than it looks: workflow
 * worktrees are checked out under `.claude/worktrees/`, so without it this test would scan several
 * complete copies of the repo (including branches mid-flip) and report their hits as this branch's.
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

/** This file itself quotes the forbidden patterns, so it must never scan itself. */
const SELF = 'tests/governance/calibration-no-ts-writers.test.ts';

/**
 * Paths that are NOT compiled into anything that runs against a real database. Everything else the
 * walker finds is treated as runtime — derived, so a new package is runtime by default rather than
 * by remembering to list it.
 */
const NON_RUNTIME_PREFIXES = ['tests/', 'scripts/', 'tools/', 'contracts/'];

function isRuntime(file: string): boolean {
  if (NON_RUNTIME_PREFIXES.some((p) => file.startsWith(p))) return false;
  return !/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(file);
}

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
const SOURCES = ALL_FILES.map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));
const RUNTIME_SOURCES = SOURCES.filter((s) => isRuntime(s.file));

const MODELS = 'calibrationSession|calibrationMember|calibrationVote';

/**
 * Any receiver, not a fixed list of five. `prismaClient.calibrationVote` and `_db.calibrationSession`
 * both reach the model and neither matched the previous `\b(?:db|tenantDb|prisma|tx|client)\.` form.
 *
 * No method call is required after the model name, deliberately. `packages/api/src/access/scoped-probe.ts`
 * registers Prisma delegates as BARE thunks — `employeeCompensation: () => tenantDb.employeeCompensation`
 * (:76), `salaryAdjustment` (:77), `actionPlan` (:79). There is no calibration entry there today, and
 * there cannot be one while this test passes — but that is the point: a `.model.method(` grep does not
 * see that form at all, and it is exactly the form that was missed when the blocker sets for flips #66
 * and #68 were first assembled. If a calibration delegate is ever registered the same way, this catches
 * it; a method-call-anchored pattern would not.
 *
 * SINGULAR ONLY, and that is load-bearing. A Prisma delegate is always the singular camelCase model
 * name; the plural spellings are either User back-relation fields or, more commonly here, fields on a
 * C# response DTO — `apps/web/lib/platform-api/ninebox.ts` reads `raw.calibrationSessions`, a KPI
 * count off the JSON, which has nothing to do with Prisma. A trailing `s?` matched it and made this
 * test fail against correct code. Nested relation WRITES are covered by RELATION_WRITE below, which
 * is the precise construct that actually reaches the tables.
 */
const PRISMA_DELEGATE = new RegExp(`[A-Za-z_$][\\w$]*\\s*\\.\\s*(?:${MODELS})\\b`);
/** `db['calibrationVote']` — the same reach, spelled to defeat a dotted-access grep. */
const BRACKET_DELEGATE = new RegExp(`\\[\\s*['"\`](?:${MODELS})['"\`]\\s*\\]`);

/**
 * Nested relation writes through User's four calibration back-relations. The ownership-flip runbook
 * is explicit that a `.model.method` grep cannot see these: `db.user.update({ data: { calibrationVotes:
 * { create: … } } })` is a compile-valid write to calibration_votes containing no `db.calibrationVote`
 * token.
 *
 * The four names came from packages/db/prisma/schema/user.prisma:118-121, which flip #70 DELETED. They
 * are kept verbatim on purpose: this list is now the record of the exact spellings that must never
 * come back, and a re-added back-relation would use them. Do not "clean up" a list that no longer
 * matches the schema — the mismatch IS the guard.
 */
const RELATION_FIELDS = [
  'calibrationSessionsCreated',
  'calibrationMemberships',
  'calibrationEvaluated',
  'calibrationVotes',
];
const NESTED_WRITE_OPS =
  'create|createMany|connectOrCreate|update|updateMany|upsert|delete|deleteMany|set|disconnect|connect';
const RELATION_WRITE = new RegExp(`(?:${RELATION_FIELDS.join('|')})\\s*:\\s*\\{\\s*(?:${NESTED_WRITE_OPS})\\b`);

/**
 * Raw DML against the three tables. Matched against WHITESPACE-NORMALISED file text, not per line:
 * a template literal that wraps after `INSERT INTO` is invisible to a line-by-line scan, and quoted
 * identifiers (`INSERT INTO "calibration_votes"`) are the more idiomatic Prisma `$executeRaw` form.
 */
const RAW_DML = new RegExp(
  // Optional quoting on BOTH the schema and the table, independently: Prisma's own `$executeRaw`
  // tagged templates and anything derived from pg_dump emit `INSERT INTO "public"."calibration_votes"`,
  // which a single optional quote on each side of an unquoted `public.` cannot match.
  `\\b(?:insert\\s+into|update|delete\\s+from)\\s+(?:["'\`]?public["'\`]?\\s*\\.\\s*)?["'\`]?(calibration_sessions|calibration_members|calibration_votes)\\b`,
  'i',
);

type Source = { file: string; text: string };

/** Line-anchored scan — keeps a precise file:line for the report. */
function hits(sources: Source[], re: RegExp): string[] {
  const found: string[] = [];
  for (const { file, text } of sources) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

/**
 * Whole-file scan on collapsed whitespace — catches constructs split across lines.
 *
 * This is the DEFAULT for any pattern spanning more than one token, because Prettier (printWidth 120)
 * breaks nested object literals across lines: every nested relation write in this repo is formatted
 * `<relation>: {` on one line and `create:` on the next (learning.ts:266, invoices.ts:133,
 * okrs.ts:129, entitlement.repository.ts:157 — there are zero single-line instances). A line-anchored
 * scan for such a pattern matches only a spelling the codebase never produces.
 */
function hitsAcrossLines(sources: Source[], re: RegExp): string[] {
  const found: string[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const { file, text } of sources) {
    const flat = text.replace(/\s+/g, ' ');
    for (const m of flat.matchAll(g)) found.push(`${file}: …${m[0]}…`);
  }
  return found;
}

describe('calibration_* have zero TypeScript writers (ownership flip #70 precondition)', () => {
  // An empty or partial scan would make every assertion below pass vacuously — the exact failure
  // mode that made /gate checks 14 and 17 tick against a database with no rows.
  //
  // The previous version guarded this with an AGGREGATE file-count floor, which cannot detect a
  // single root going blind: apps/web alone contributes ~447 files, so losing packages/api/src
  // entirely still cleared a >300 floor. These are PER-DIRECTORY existence + floor assertions, so a
  // renamed or moved package fails loudly, by name.
  describe('the scan is not vacuous', () => {
    // Floors sit just under the real count, not at a round number far below it. A floor of 100
    // against 187 real files lets the whole packages/api/src/routers subtree — where Prisma delegate
    // calls are densest — go blind while the assertion still passes. `workers` is listed because it
    // was a declared runtime root in the previous revision and nothing otherwise pins it.
    // Measured 2026-08-05 (actual → floor): api/src 184→170, api/src/routers 84→75, apps/web 447→400,
    // workers 1→1, db/prisma 8→5, shared/src 24→20, ai/src 21→15, tests 277→250, scripts 35→30.
    const MUST_SCAN: [string, number][] = [
      ['packages/api/src', 170],
      ['packages/api/src/routers', 75],
      ['apps/web', 400],
      ['workers', 1],
      ['packages/db/prisma', 5],
      ['packages/shared/src', 20],
      ['packages/ai/src', 15],
      ['tests', 250],
      ['scripts', 30],
    ];

    it.each(MUST_SCAN)('scanned %s (at least %i files)', (dir, floor) => {
      expect(
        existsSync(join(ROOT, dir)),
        `${dir} does not exist — it was renamed or moved. Update MUST_SCAN; do NOT delete the entry, or this tripwire goes blind to it.`,
      ).toBe(true);
      const n = ALL_FILES.filter((f) => f.startsWith(`${dir}/`)).length;
      expect(n, `${dir} contributed ${n} files to the scan, expected >= ${floor}`).toBeGreaterThanOrEqual(floor);
    });

    // The RAW_DML check runs over RUNTIME_SOURCES specifically, so an AGGREGATE floor on that set
    // reproduces exactly the defect the per-directory floors above exist to fix: apps/web alone
    // clears any round number, so packages/api/src could fall out of the runtime classification
    // entirely and the raw-DML tripwire would still report green.
    it.each([
      ['packages/api/src', 170],
      ['apps/web', 400],
      ['workers', 1],
    ])('classifies %s as RUNTIME (at least %i files)', (dir, floor) => {
      const n = RUNTIME_SOURCES.filter((s) => s.file.startsWith(`${dir}/`)).length;
      expect(n, `${dir} contributed ${n} files to the RUNTIME set, expected >= ${floor}`).toBeGreaterThanOrEqual(floor);
    });

    it('classifies runtime vs non-runtime without emptying either side', () => {
      expect(RUNTIME_SOURCES.length).toBeGreaterThan(300);
      expect(SOURCES.length - RUNTIME_SOURCES.length).toBeGreaterThan(100);
    });

    // Prove every pattern still matches what it is supposed to match, on synthetic input. Without
    // this, a typo'd regex is indistinguishable from a clean repo.
    it('the patterns match the constructs they claim to', () => {
      expect(PRISMA_DELEGATE.test('  return db.calibrationVote.upsert({')).toBe(true);
      expect(PRISMA_DELEGATE.test('await tenantDb.calibrationSession.update({ where }')).toBe(true);
      expect(PRISMA_DELEGATE.test('const m = await tx.calibrationMember.findFirst({')).toBe(true);
      // Receivers the old five-name alternation missed:
      expect(PRISMA_DELEGATE.test('await prismaClient.calibrationVote.create({')).toBe(true);
      expect(PRISMA_DELEGATE.test('await _db.calibrationSession.delete({')).toBe(true);
      // The BARE delegate reference — no method call. This is the scoped-probe.ts DELEGATES form,
      // and the one a `.model.method(` grep cannot see.
      expect(PRISMA_DELEGATE.test('  calibrationSession: () => tenantDb.calibrationSession,')).toBe(true);
      expect(BRACKET_DELEGATE.test("await db['calibrationVote'].create({")).toBe(true);
      // Nested relation write — no `db.calibrationVote` token anywhere in it:
      expect(RELATION_WRITE.test('data: { calibrationVotes: { create: { sessionId } } }')).toBe(true);
      expect(RELATION_WRITE.test('calibrationMemberships: { createMany: { data } }')).toBe(true);
      // Raw DML, including the quoted and line-wrapped forms:
      expect(RAW_DML.test("await db.query('INSERT INTO calibration_votes (id) VALUES ($1)')")).toBe(true);
      expect(RAW_DML.test('UPDATE public.calibration_sessions SET status =')).toBe(true);
      expect(RAW_DML.test('INSERT INTO "calibration_votes" (id) VALUES ($1)')).toBe(true);
      // Fully schema-qualified AND quoted — what Prisma's $executeRaw and pg_dump emit. An earlier
      // revision allowed one quote on each side of an unquoted `public.` and missed this.
      expect(RAW_DML.test('INSERT INTO "public"."calibration_votes" (id) VALUES ($1)')).toBe(true);
      // Genuinely line-wrapped. (A previous version of this assertion applied .replace(/\s+/g,' ') to
      // a string with no whitespace run longer than one space — an identity transform, and therefore
      // a duplicate of the line above rather than coverage of anything.)
      //
      // Note WHERE the wrap is actually handled: `\s+`/`\s*` already span newlines, so the pattern
      // itself is fine on wrapped input. What defeats it is `hits()` splitting the file into lines
      // BEFORE matching. That is why the scan function, not the regex, is what had to change — and
      // why the scanner drive-test above is the assertion that really covers this.
      expect(RAW_DML.test('INSERT INTO\n  "calibration_votes" (id)')).toBe(true);
    });

    // The regex controls above prove the PATTERNS work. They say nothing about the SCANNERS: with
    // `hits()` and `hitsAcrossLines()` both stubbed to `return []`, every assertion in this file still
    // passes. So drive each scanner over a synthetic in-memory source that must be found, and over one
    // that must not — otherwise the whole tripwire is one `return []` away from certifying nothing.
    it('the scanners actually scan (a stubbed hits()/hitsAcrossLines() must not pass)', () => {
      const planted: Source[] = [
        { file: 'synthetic/writer.ts', text: 'const x = 1;\nawait db.calibrationVote.create({ data });\n' },
        {
          file: 'synthetic/relation.ts',
          // Formatted the way Prettier formats it — across lines — deliberately.
          text: 'await db.user.update({\n  data: {\n    calibrationVotes: {\n      create: { sessionId },\n    },\n  },\n});\n',
        },
        {
          file: 'synthetic/raw.ts',
          text: 'await db.$executeRaw`INSERT INTO\n  "public"."calibration_votes" (id)\n  VALUES ($1)`;\n',
        },
        { file: 'synthetic/clean.ts', text: 'const total = counts.calibrationSessions ?? 0;\n' },
      ];

      expect(hits(planted, PRISMA_DELEGATE).map((h) => h.split(':')[0])).toContain('synthetic/writer.ts');
      expect(hitsAcrossLines(planted, RELATION_WRITE).map((h) => h.split(':')[0])).toContain('synthetic/relation.ts');
      expect(hitsAcrossLines(planted, RAW_DML).map((h) => h.split(':')[0])).toContain('synthetic/raw.ts');

      // ...and the clean file is in none of them (the scanners discriminate, they do not just return
      // everything, which would be the other way to fake a pass).
      for (const h of [
        ...hits(planted, PRISMA_DELEGATE),
        ...hitsAcrossLines(planted, RELATION_WRITE),
        ...hitsAcrossLines(planted, RAW_DML),
      ]) {
        expect(h).not.toContain('synthetic/clean.ts');
      }
    });

    it('the patterns do NOT match legitimate neighbouring constructs', () => {
      expect(PRISMA_DELEGATE.test('db.nineBoxEvaluation.findMany({')).toBe(false);
      expect(RAW_DML.test('SELECT id FROM calibration_sessions WHERE organization_id = $1')).toBe(false);
      // A PLURAL field read off a C# JSON response is not a Prisma delegate. This exact line is live
      // at apps/web/lib/platform-api/ninebox.ts:336 and an earlier draft of this regex failed on it.
      expect(PRISMA_DELEGATE.test('    calibrationSessions: num(raw.calibrationSessions),')).toBe(false);
      // A read-shaped relation include is not a write:
      expect(RELATION_WRITE.test('include: { calibrationVotes: true }')).toBe(false);
      expect(RELATION_WRITE.test('select: { calibrationVotes: { select: { id: true } } }')).toBe(false);
    });
  });

  it('no TypeScript file reaches the three calibration models through a Prisma delegate', () => {
    const found = [...hits(SOURCES, PRISMA_DELEGATE), ...hits(SOURCES, BRACKET_DELEGATE)];
    expect(
      found,
      `A TypeScript Prisma delegate touches a calibration_* model. Ownership flip #70 moves these\n` +
        `three tables to EF Core and deletes their Prisma models — a delegate reference here blocks it\n` +
        `(and will not compile once the flip lands). Port the caller to the C# endpoints in\n` +
        `services/Tims.Platform/src/Tims.Api/NineBox/NineBoxWriteEndpoints.cs instead:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('no TypeScript file writes the calibration tables through a User back-relation', () => {
    // hitsAcrossLines, NOT hits. An earlier revision of this file used the line-anchored scan here
    // and was therefore blind to the ONLY spelling this repo actually produces — see the docblock on
    // hitsAcrossLines. The mutation that "proved" the line-anchored version was a hand-written
    // single-line literal, which is the shape the regex wanted rather than the shape Prettier emits.
    const found = hitsAcrossLines(SOURCES, RELATION_WRITE);
    expect(
      found,
      `A nested Prisma relation write reaches a calibration_* table without naming its delegate.\n` +
        `\`db.user.update({ data: { calibrationVotes: { create: … } } })\` is a compile-valid write to\n` +
        `calibration_votes that a \`.model.method\` grep cannot see — the ownership-flip runbook calls\n` +
        `this out explicitly. It blocks flip #70 exactly as a direct delegate write does:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('no RUNTIME package issues raw DML against the three calibration tables', () => {
    const found = hitsAcrossLines(RUNTIME_SOURCES, RAW_DML);
    expect(
      found,
      `A runtime source issues raw INSERT/UPDATE/DELETE against a calibration_* table. C# is the sole\n` +
        `writer of these tables (#57); a second writer breaks the one-active-writer guarantee the\n` +
        `ownership ledger records. (scripts/parity/* is deliberately exempt — fixture SQL against the\n` +
        `parity database, not a runtime path.):\n${found.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * INVERTED 2026-08-06 when flip #70 executed. It previously asserted the three tables were still
   * `efcoreStranglerWrite`, with the rider "(moving them is flip #70, not this issue)". That was
   * correct while it was written and the flip makes it false — the classic case of a test that pinned
   * an ERA starting to defend it.
   *
   * It is inverted rather than deleted, and the direction it now points is the one that matters: the
   * ledger is the only place recording that C# is sole owner, and `scripts/table-ownership.mjs` cannot
   * catch a move BACK on its own (`efcoreStranglerWrite` merely requires the table be `@@map`'d, which
   * is exactly the state a re-added Prisma model would restore). Together with the delegate/raw-DML
   * assertions above, this is what makes "the flip stays flipped" checkable.
   *
   * `not.toContain('efcoreStranglerWrite')` is asserted explicitly, not implied: a table listed in BOTH
   * lists is a `cross-owner collision` in the ledger script only while the Prisma model exists, so the
   * two halves genuinely check different things.
   */
  it('the ledger classifies all three tables as efcore — flip #70 executed, and must stay executed', () => {
    const doc = readFileSync(join(ROOT, 'docs/architecture/table-ownership.md'), 'utf8');
    const ledger = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)![1]) as Record<string, string[]>;
    for (const t of ['calibration_sessions', 'calibration_members', 'calibration_votes']) {
      expect(
        ledger['efcore'],
        `${t} is not in efcore[]. Ownership flip #70 moved all three calibration_* tables to EF Core on\n` +
          `2026-08-06 (runbook §7d). Moving one back means restoring its Prisma model, which re-creates a\n` +
          `second writer of a table C# solely owns — and reverting a flip is a deliberate, reviewed act\n` +
          `(runbook §6), never a side effect of editing this ledger.`,
      ).toContain(t);
      expect(ledger['efcoreStranglerWrite'], t).not.toContain(t);
    }
  });
});
