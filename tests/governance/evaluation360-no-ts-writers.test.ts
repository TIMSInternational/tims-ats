import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// #54 / #67 — the evaluation360 TS-writer tripwire.
//
// WHY THIS EXISTS. The TS evaluation360 ROUTER was deleted during the S5 item-4 sequence
// (2026-07-28), and the record then claimed the sequence left "ZERO live surfaces with undeleted
// TS fallback code". For this domain that was false: the deletion stopped at the router and left
// `packages/api/src/services/evaluation360.service.ts` (199 LOC) and
// `packages/api/src/repositories/evaluation360.repository.ts` (314 LOC) behind, orphaned, with zero
// importers outside the test suite — and the repository still held EVERY TS Prisma writer of
// review_cycles / rater_assignments / rater_responses. #54 deleted both. This test pins that.
//
// It is the PRECONDITION for ownership flip #67, and a precondition nobody can see is a
// precondition nobody defends. Modelled deliberately on tests/governance/calibration-no-ts-writers.test.ts
// (flips #57/#70), whose scanning strategy and drive-tests are the reviewed shape for this class of
// tripwire — this is not a fresh design and should not diverge from it without a reason.
//
// ── HOW THIS DIFFERS FROM THE CALIBRATION TRIPWIRE, AND IT MATTERS ──────────────────────────────
// Flip #70 had already EXECUTED when its tripwire was written, so the Prisma models were gone and a
// re-added delegate did not compile. Flip #67 has NOT executed. The three Prisma models are still in
// packages/db/prisma/schema/evaluation360.prisma and MUST stay there — deleting them IS the flip, and
// the flip is a separate, deliberate, runbook-governed act (docs/architecture/csharp-migration/
// ownership-flip-runbook.md), not this issue. So:
//   - there is NO "no .prisma file re-declares the models" assertion here; the opposite is true, and
//     the models' continued presence is asserted below so #54 cannot be mistaken for #67, and
//   - `tenantDb.reviewCycle` still COMPILES today. Nothing but this test stands between a re-added
//     TS writer and a silently false precondition under workflow B.
//
// ── SCANNING STRATEGY: DENY-LIST, NOT ALLOW-LIST ────────────────────────────────────────────────
// Walk the WHOLE repository and prune what cannot contain first-party source, per the calibration
// tripwire's docblock: an allow-list of roots there was demonstrably unsound (packages/ai/src was
// never scanned yet calls Prisma delegates). A package added tomorrow is scanned automatically.
//
// WHAT IT DELIBERATELY DOES NOT FORBID. scripts/parity/seed.ts INSERTs into and DELETEs from all
// three tables (:798, :815, :838, :1237, :1387, :1414-1418, :2451-2453) and scripts/parity/write-surfaces.ts
// SELECTs them for read-back assertions. That is the write-verification fixture harness running on a
// `pg` client against the parity project's own DATABASE_URL and its own privileged login role — not
// a Prisma delegate, not a runtime application path, and unaffected by an app_tenant GRANT change.
// It survives model deletion mechanically and does not block #67. This is the SAME exemption the
// calibration tripwire grants for the same files and the same reason. Raw DML in a RUNTIME package
// is a different matter and IS forbidden below.

const ROOT = join(__dirname, '..', '..');

/**
 * Directory names pruned anywhere in the tree. `.claude` is load-bearing: workflow worktrees are
 * checked out under `.claude/worktrees/`, so without it this test scans several complete copies of
 * the repo — including branches mid-flip — and reports their hits as this branch's.
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
const SELF = 'tests/governance/evaluation360-no-ts-writers.test.ts';

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

const MODELS = 'reviewCycle|raterAssignment|raterResponse';

/**
 * Any receiver, not a fixed list. `prismaClient.raterResponse` and `_db.reviewCycle` both reach the
 * model and neither matches a `\b(?:db|tenantDb|prisma|tx)\.` form.
 *
 * No method call is required after the model name, deliberately — and #54's acceptance criteria
 * called this out specifically. `packages/api/src/access/scoped-probe.ts` registers Prisma delegates
 * as BARE thunks (`employeeCompensation: () => tenantDb.employeeCompensation` :76). There is no
 * evaluation360 entry there today — tests/evaluation360/evaluation360-router-self-service.test.ts
 * asserts raterAssignment is deliberately NOT a ScopedEntity, because identity-anchoring is its only
 * guard by design — but a `.model.method(` grep cannot see that form at all, and it is exactly the
 * form that was missed when the blocker sets for flips #66 and #68 were first assembled.
 *
 * SINGULAR ONLY, and that is load-bearing (the calibration tripwire regressed on precisely this): a
 * Prisma delegate is always the singular camelCase model name, while the plural spellings are User
 * back-relation fields or C# response-DTO fields read off JSON. Nested relation WRITES are covered by
 * RELATION_WRITE below, which is the precise construct that actually reaches the tables.
 *
 * NO WHITESPACE AFTER THE DOT, and this is a fix rather than a preference. The calibration tripwire
 * spells this `\\.\\s*`, which also matches ENGLISH PROSE: a comment ending a sentence with "…not an
 * RBAC grant. raterAssignment must stay…" parses as receiver `grant`, dot, model. That is a real line
 * (tests/evaluation360/evaluation360-router-self-service.test.ts:77) and it failed this test on
 * correct code. Whitespace BEFORE the dot is still tolerated, because `db\n  .reviewCycle` is a real
 * formatting of a real delegate chain; whitespace AFTER it never is.
 */
const PRISMA_DELEGATE = new RegExp(`[A-Za-z_$][\\w$]*\\s*\\.(?:${MODELS})\\b`);
/** `db['raterResponse']` — the same reach, spelled to defeat a dotted-access grep. */
const BRACKET_DELEGATE = new RegExp(`\\[\\s*['"\`](?:${MODELS})['"\`]\\s*\\]`);

/**
 * Nested relation writes through the User back-relations. The ownership-flip runbook is explicit
 * that a `.model.method` grep cannot see these: `db.user.update({ data: { reviewCyclesCreated:
 * { create: … } } })` is a compile-valid write to review_cycles containing no `db.reviewCycle` token.
 *
 * Names taken from packages/db/prisma/schema/user.prisma:129-131. UNLIKE the calibration tripwire,
 * these back-relations still EXIST — flip #67 has not run — so this list matches the live schema and
 * must be kept in step with it until the flip deletes them.
 */
const RELATION_FIELDS = ['reviewCyclesCreated', 'raterAssignmentsAsSubject', 'raterAssignmentsAsRater'];
const NESTED_WRITE_OPS =
  'create|createMany|connectOrCreate|update|updateMany|upsert|delete|deleteMany|set|disconnect|connect';
const RELATION_WRITE = new RegExp(`(?:${RELATION_FIELDS.join('|')})\\s*:\\s*\\{\\s*(?:${NESTED_WRITE_OPS})\\b`);

/**
 * Raw DML against the three tables. Matched against WHITESPACE-NORMALISED file text, not per line:
 * a template literal that wraps after `INSERT INTO` is invisible to a line-by-line scan, and quoted
 * identifiers (`INSERT INTO "rater_responses"`) are the more idiomatic Prisma `$executeRaw` form.
 */
const RAW_DML = new RegExp(
  `\\b(?:insert\\s+into|update|delete\\s+from)\\s+(?:["'\`]?public["'\`]?\\s*\\.\\s*)?["'\`]?(review_cycles|rater_assignments|rater_responses)\\b`,
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
 * Whole-file scan on collapsed whitespace — catches constructs split across lines. This is the
 * DEFAULT for any pattern spanning more than one token, because Prettier (printWidth 120) breaks
 * nested object literals across lines: every nested relation write in this repo is formatted
 * `<relation>: {` on one line and `create:` on the next, with zero single-line instances.
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

describe('evaluation360 tables have zero TypeScript writers (ownership flip #67 precondition)', () => {
  // An empty or partial scan would make every assertion below pass vacuously — the exact failure
  // mode that made /gate checks 14 and 17 tick against a database with no rows.
  describe('the scan is not vacuous', () => {
    // Per-directory existence + floors, NOT an aggregate count: apps/web alone contributes ~447
    // files, so an aggregate floor lets the whole of packages/api/src go blind while still passing.
    // Floors sit just under the real count. Measured on this branch 2026-08-06, after #54's four
    // deletions (actual → floor): api/src 182→170, api/src/routers 84→75, apps/web 447→400,
    // workers 1→1, db/prisma 8→5, shared/src 24→20, ai/src 21→15, tests 276→250, scripts 35→30.
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
    // would reproduce exactly the defect the per-directory floors above exist to fix.
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
    // this, a typo'd regex is indistinguishable from a clean repo. Every literal below is copied
    // from the shape the DELETED repository actually used (see git history for
    // packages/api/src/repositories/evaluation360.repository.ts at HEAD~1).
    it('the patterns match the constructs they claim to', () => {
      expect(PRISMA_DELEGATE.test('    return db.reviewCycle.create({')).toBe(true);
      expect(PRISMA_DELEGATE.test('    return db.reviewCycle.updateMany({')).toBe(true);
      expect(PRISMA_DELEGATE.test('      const result = await tx.raterAssignment.createMany({')).toBe(true);
      expect(PRISMA_DELEGATE.test('      await tx.raterResponse.createMany({')).toBe(true);
      // Receivers a fixed five-name alternation would miss:
      expect(PRISMA_DELEGATE.test('await prismaClient.raterResponse.create({')).toBe(true);
      expect(PRISMA_DELEGATE.test('await _db.reviewCycle.delete({')).toBe(true);
      // The BARE delegate reference — no method call. The scoped-probe.ts DELEGATES form, and the
      // one a `.model.method(` grep cannot see. #54's acceptance criteria demanded this case.
      expect(PRISMA_DELEGATE.test('  raterAssignment: () => tenantDb.raterAssignment,')).toBe(true);
      expect(BRACKET_DELEGATE.test("await db['raterResponse'].createMany({")).toBe(true);
      // Nested relation write — no `db.reviewCycle` token anywhere in it:
      expect(RELATION_WRITE.test('data: { reviewCyclesCreated: { create: { organizationId, name } } }')).toBe(true);
      expect(RELATION_WRITE.test('raterAssignmentsAsRater: { createMany: { data } }')).toBe(true);
      // Raw DML, including the quoted, schema-qualified and line-wrapped forms:
      expect(RAW_DML.test("await db.query('INSERT INTO rater_responses (id) VALUES ($1)')")).toBe(true);
      expect(RAW_DML.test('UPDATE public.review_cycles SET status =')).toBe(true);
      expect(RAW_DML.test('INSERT INTO "rater_assignments" (id) VALUES ($1)')).toBe(true);
      expect(RAW_DML.test('INSERT INTO "public"."rater_responses" (id) VALUES ($1)')).toBe(true);
      expect(RAW_DML.test('INSERT INTO\n  "rater_assignments" (id)')).toBe(true);
    });

    // The regex controls above prove the PATTERNS work. They say nothing about the SCANNERS: with
    // `hits()` and `hitsAcrossLines()` both stubbed to `return []`, every assertion in this file
    // still passes. So drive each scanner over synthetic sources that must be found, and one that
    // must not — otherwise the whole tripwire is one `return []` away from certifying nothing.
    it('the scanners actually scan (a stubbed hits()/hitsAcrossLines() must not pass)', () => {
      const planted: Source[] = [
        { file: 'synthetic/writer.ts', text: 'const x = 1;\nawait db.raterResponse.createMany({ data });\n' },
        {
          file: 'synthetic/relation.ts',
          // Formatted the way Prettier formats it — across lines — deliberately.
          text: 'await db.user.update({\n  data: {\n    reviewCyclesCreated: {\n      create: { name },\n    },\n  },\n});\n',
        },
        {
          file: 'synthetic/raw.ts',
          text: 'await db.$executeRaw`INSERT INTO\n  "public"."rater_assignments" (id)\n  VALUES ($1)`;\n',
        },
        {
          // A delegate chain broken across lines the way Prettier breaks it. This is the case the
          // old line-anchored scan could NOT see, and whose "proof" tested the regex directly on a
          // JS string with an embedded \n instead of driving the scanner.
          file: 'synthetic/wrapped.ts',
          text: 'const rows = await tenantDb\n  .reviewCycle.findMany({ where: { organizationId } });\n',
        },
        { file: 'synthetic/clean.ts', text: 'const total = counts.raterAssignments ?? 0;\n' },
        {
          // Prose that parses as receiver-dot-model if whitespace AFTER the dot is tolerated. Live at
          // tests/evaluation360/evaluation360-router-self-service.test.ts:77.
          file: 'synthetic/prose.ts',
          text: '// not an RBAC grant. raterAssignment must stay OUT of scope\n',
        },
      ];

      expect(hitsAcrossLines(planted, PRISMA_DELEGATE).map((h) => h.split(':')[0])).toContain('synthetic/writer.ts');
      expect(
        hitsAcrossLines(planted, PRISMA_DELEGATE).map((h) => h.split(':')[0]),
        'a Prettier-wrapped delegate chain must be caught by the SCAN PATH, not merely by the regex',
      ).toContain('synthetic/wrapped.ts');
      expect(hitsAcrossLines(planted, RELATION_WRITE).map((h) => h.split(':')[0])).toContain('synthetic/relation.ts');
      expect(hitsAcrossLines(planted, RAW_DML).map((h) => h.split(':')[0])).toContain('synthetic/raw.ts');

      // ...and the clean file is in none of them (the scanners discriminate, they do not just return
      // everything, which would be the other way to fake a pass).
      for (const h of [
        ...hitsAcrossLines(planted, PRISMA_DELEGATE),
        ...hitsAcrossLines(planted, RELATION_WRITE),
        ...hitsAcrossLines(planted, RAW_DML),
      ]) {
        expect(h).not.toContain('synthetic/clean.ts');
        // Prose must not trip it even under whitespace collapsing — that is what the
        // no-whitespace-after-the-dot rule in PRISMA_DELEGATE buys, and it is why moving to a
        // whole-file scan is safe here.
        expect(h).not.toContain('synthetic/prose.ts');
      }
    });

    it('the patterns do NOT match legitimate neighbouring constructs', () => {
      expect(PRISMA_DELEGATE.test('db.nineBoxEvaluation.findMany({')).toBe(false);
      expect(RAW_DML.test('SELECT status FROM review_cycles WHERE id = $1')).toBe(false);
      // A PLURAL field read off a C# JSON response is not a Prisma delegate — the exact false
      // positive that broke the calibration tripwire against correct code.
      expect(PRISMA_DELEGATE.test('    raterAssignments: num(raw.raterAssignments),')).toBe(false);
      // English prose is not a delegate. This exact line is live at
      // tests/evaluation360/evaluation360-router-self-service.test.ts:77 and the `\.\s*` spelling
      // inherited from the calibration tripwire failed on it — receiver `grant`, dot, model.
      expect(PRISMA_DELEGATE.test('  // not an RBAC grant. raterAssignment must stay OUT of scope')).toBe(false);
      // ...but a genuine chain broken across lines by Prettier still matches (whitespace BEFORE the
      // dot is tolerated, only whitespace AFTER it is not).
      expect(PRISMA_DELEGATE.test('  const rows = await tenantDb\n    .raterResponse.findMany({')).toBe(true);
      // A read-shaped relation include is not a write:
      expect(RELATION_WRITE.test('include: { reviewCyclesCreated: true }')).toBe(false);
      expect(RELATION_WRITE.test('select: { raterAssignmentsAsRater: { select: { id: true } } }')).toBe(false);
    });
  });

  it('no TypeScript file reaches the three evaluation360 models through a Prisma delegate', () => {
    // hitsAcrossLines, NOT hits. The docblock on PRISMA_DELEGATE says a chain broken across lines
    // (`tenantDb\n  .reviewCycle`) is a real formatting of a real delegate and must be caught — but
    // `hits()` splits the file into lines BEFORE matching, so that form can never reach the regex
    // intact. The control assertion "proving" it worked fed the regex a single JS string containing
    // an embedded \n, which the scan path never produces: it certified a capability the tripwire did
    // not have. Same defect, same week, as the calibration tripwire's relation-write scan.
    //
    // Safe under whitespace collapsing precisely because of this regex's design: it tolerates
    // whitespace BEFORE the dot and never after, so collapsing `tenantDb\n  .reviewCycle` to
    // `tenantDb .reviewCycle` still matches, while prose ("…RBAC grant. raterAssignment must…")
    // still does not.
    const found = [...hitsAcrossLines(SOURCES, PRISMA_DELEGATE), ...hitsAcrossLines(SOURCES, BRACKET_DELEGATE)];
    expect(
      found,
      `A TypeScript Prisma delegate touches an evaluation360 model. #54 deleted the orphaned TS\n` +
        `service + repository that held every such writer, and ownership flip #67 depends on that\n` +
        `staying true. Unlike the calibration tripwire, the Prisma models still EXIST here, so this\n` +
        `reference compiles — this test is the only thing that catches it. Port the caller to the C#\n` +
        `endpoints in services/Tims.Platform/src/Tims.Api/Evaluation360/ instead:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('no TypeScript file writes the evaluation360 tables through a User back-relation', () => {
    // hitsAcrossLines, NOT hits: Prettier splits every nested relation write in this repo across
    // lines, so a line-anchored scan is blind to the only spelling the codebase actually produces.
    const found = hitsAcrossLines(SOURCES, RELATION_WRITE);
    expect(
      found,
      `A nested Prisma relation write reaches an evaluation360 table without naming its delegate.\n` +
        `\`db.user.update({ data: { reviewCyclesCreated: { create: … } } })\` is a compile-valid write\n` +
        `to review_cycles that a \`.model.method\` grep cannot see — the ownership-flip runbook calls\n` +
        `this out explicitly:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('no RUNTIME package issues raw DML against the three evaluation360 tables', () => {
    const found = hitsAcrossLines(RUNTIME_SOURCES, RAW_DML);
    expect(
      found,
      `A runtime source issues raw INSERT/UPDATE/DELETE against an evaluation360 table. C# is the\n` +
        `sole application writer of these tables; a second writer breaks the one-active-writer\n` +
        `guarantee the ownership ledger records. (scripts/parity/* is deliberately exempt — fixture\n` +
        `SQL against the parity database, not a runtime path.):\n${found.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * #54 IS NOT #67, and this assertion is what keeps the two from being confused.
   *
   * Deleting the orphaned TS service/repository clears the flip's PRECONDITION; it does not perform
   * the flip. The flip is moving these three tables from `efcoreStranglerWrite` to `efcore` AND
   * deleting their Prisma models in the SAME commit (scripts/table-ownership.mjs:113-117 makes either
   * half alone a red build), under the ownership-flip runbook, with the prod-credentialed checks that
   * runbook requires. Doing it as a side effect of a code-deletion PR would skip all of that.
   *
   * WHEN FLIP #67 EXECUTES, INVERT THIS TEST — do not delete it. It pins an ERA on purpose and will
   * start defending that era the moment the flip lands; the calibration tripwire's ledger assertion
   * hit exactly this and was inverted rather than removed (see its docblock). Inverted, it becomes
   * the guard that the flip STAYS flipped, which `scripts/table-ownership.mjs` cannot check on its
   * own — `efcoreStranglerWrite` merely requires the table be `@@map`'d, which is the state a
   * re-added Prisma model would restore.
   */
  it('the ledger still classifies all three tables as efcoreStranglerWrite — moving them is flip #67, not #54', () => {
    const doc = readFileSync(join(ROOT, 'docs/architecture/table-ownership.md'), 'utf8');
    const ledger = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)![1]) as Record<string, string[]>;
    for (const t of ['review_cycles', 'rater_assignments', 'rater_responses']) {
      expect(
        ledger['efcoreStranglerWrite'],
        `${t} left efcoreStranglerWrite[]. If ownership flip #67 has executed, INVERT this test to\n` +
          `assert efcore[] (see the docblock) — do not delete it. If it has not, this is an\n` +
          `accidental ledger edit: the flip also requires deleting the Prisma model in the same\n` +
          `commit and running the runbook's prod-credentialed checks.`,
      ).toContain(t);
      expect(ledger['efcore'], t).not.toContain(t);
    }
  });

  /**
   * The mirror of the calibration tripwire's "no .prisma file re-declares the models" assertion,
   * pointing the OTHER way. There, the models had been deleted by the flip and must not come back.
   * Here they must not LEAVE: deleting them is flip #67, and a deletion that landed on a #54-shaped
   * PR would take the ledger and the schema out of step (a red `table-ownership.mjs` build at best,
   * a table with no executable definition in the repo at worst — runbook §0 P8).
   */
  it('the three Prisma models still exist — #54 deletes TS app code, never a Prisma model', () => {
    const schema = readFileSync(join(ROOT, 'packages/db/prisma/schema/evaluation360.prisma'), 'utf8');
    for (const model of ['ReviewCycle', 'RaterAssignment', 'RaterResponse']) {
      expect(schema, `model ${model} is gone from evaluation360.prisma`).toMatch(
        new RegExp(`^\\s*model\\s+${model}\\s*\\{`, 'm'),
      );
    }
    for (const table of ['review_cycles', 'rater_assignments', 'rater_responses']) {
      expect(schema).toContain(`@@map("${table}")`);
    }
  });

  /**
   * The pure min-3 anonymity kernel is KEPT, pinned BY NAME. Auto-discovery alone would make its
   * deletion a GREEN change — the scans above would simply find one fewer file. It follows the
   * access-review-kernel precedent: when that domain was fully deleted, the pure kernel and its
   * pinned-fixture suites were retained as the contract spec the C# port is golden-tested against.
   */
  it('the pure min-3 anonymity kernel and its cross-stack fixture are KEPT', () => {
    expect(existsSync(join(ROOT, 'packages/api/src/services/evaluation360-aggregate.ts'))).toBe(true);
    expect(existsSync(join(ROOT, 'contracts/access-fixtures/eval360-min3.json'))).toBe(true);
    expect(
      existsSync(join(ROOT, 'services/Tims.Platform/src/Tims.Domain/Access/Eval360Aggregate.cs')),
      'the C# side of the golden fixture is gone — the TS kernel is a contract spec for nothing',
    ).toBe(true);
  });

  it('the orphaned TS service and repository stay deleted', () => {
    expect(existsSync(join(ROOT, 'packages/api/src/services/evaluation360.service.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'packages/api/src/repositories/evaluation360.repository.ts'))).toBe(false);
  });
});
