import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// #64 — the surveys / survey_responses TS-WRITER tripwire.
//
// WHY THIS EXISTS. Issue #64 claimed "Grep-verified on 2026-08-01: zero TS writers", and the
// ownership-flip runbook headed the same paragraph "Zero TS writers — confirmed 2026-08-02" while its
// own evidence sentence listed two seed writes. Both were FALSE: `packages/db/prisma/seed-demo.ts`
// held `db.survey.create` and `db.surveyResponse.create` continuously from `3ce2ce1b` (2026-06-02)
// until they were ported to raw SQL on 2026-08-10. §0 P1 of the runbook makes a seed write a BLOCKING
// writer, so #64 was not startable for that whole period and nobody knew.
//
// The claim survived three separate verifying greps across ten weeks for one reason: NOTHING
// EXECUTABLE PINNED IT. This file is that thing. Modelled deliberately on
// tests/governance/evaluation360-no-ts-writers.test.ts (#54/#67) and
// tests/governance/calibration-no-ts-writers.test.ts (#57/#70) — the reviewed shape for this class of
// tripwire. Do not diverge from it without a reason.
//
// ── HOW THIS ONE DIFFERS FROM ITS TWO TEMPLATES, AND WHY ────────────────────────────────────────
// Both templates forbid ANY delegate access to their models, because their flips had already executed
// and the Prisma models were gone. #64 has NOT executed: `Survey`/`SurveyResponse` still exist in
// packages/db/prisma/schema/engagement.prisma and are still legitimately READ by
// packages/api/src/routers/engagement.ts (:80, :97, :118, :167), monitoring.ts (:25, :217) and
// repositories/alert-evaluation.repository.ts (:223). Those reads are runbook §7b edits 1b/3/4 — they
// belong to the flip PR itself, not here.
//
// So this tripwire is WRITER-SCOPED, not access-scoped. Copying the templates verbatim would fail on
// correct code, and the natural "fix" — deleting the offending assertion — is how a tripwire becomes
// decorative. When flip #64 executes, TIGHTEN this file to the templates' access-scoped form rather
// than deleting it; the models being gone is what makes that possible.

const ROOT = join(__dirname, '..', '..');

/**
 * Pruned anywhere in the tree. `.claude` is load-bearing: workflow worktrees are checked out under
 * `.claude/worktrees/`, so without it this test scans several complete copies of the repo — including
 * branches mid-flip — and reports their hits as this branch's.
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

/** This file itself quotes every forbidden pattern, so it must never scan itself. */
const SELF = 'tests/governance/surveys-no-ts-writers.test.ts';

/**
 * Paths not compiled into anything that runs against a real database. Derived, so a package added
 * tomorrow is RUNTIME by default rather than by someone remembering to list it.
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

const MODELS = 'survey|surveyResponse';
const WRITE_OPS = 'create|createMany|update|updateMany|upsert|delete|deleteMany';

/**
 * A Prisma WRITE through any receiver — `db.survey.create(`, `prismaClient.surveyResponse.upsert(`,
 * `_db\n  .survey\n  .delete(`. Any receiver, not a fixed `db|tenantDb|prisma|tx` list.
 *
 * NO WHITESPACE AFTER EITHER DOT, and that is a fix rather than a preference: the calibration
 * tripwire spelled this `\.\s*` and matched ENGLISH PROSE — a comment ending a sentence with
 * "…not a grant. survey rows must…" parses as receiver `grant`, dot, model. Whitespace BEFORE a dot
 * is still tolerated, because `db\n  .survey\n  .create(` is real Prettier output.
 *
 * SINGULAR ONLY. A Prisma delegate is always the singular camelCase model name; the plural spellings
 * are User back-relation fields, covered by RELATION_WRITE below.
 */
const PRISMA_WRITE = new RegExp(`[A-Za-z_$][\\w$]*\\s*\\.(?:${MODELS})\\s*\\.(?:${WRITE_OPS})\\s*\\(`);

/** `db['surveyResponse'].create(` — the same reach, spelled to defeat a dotted-access grep. */
const BRACKET_WRITE = new RegExp(`\\[\\s*['"\`](?:${MODELS})['"\`]\\s*\\]\\s*\\.(?:${WRITE_OPS})\\s*\\(`);

/**
 * Nested relation writes through the User back-relations
 * (packages/db/prisma/schema/user.prisma:106-107). The runbook is explicit that a `.model.method`
 * grep cannot see these: `db.user.update({ data: { createdSurveys: { create: … } } })` is a
 * compile-valid write to `surveys` containing no `db.survey` token. This is the construct the blocker
 * sets for flips #66 and #68 both missed on first assembly.
 */
const RELATION_FIELDS = ['createdSurveys', 'surveyResponses'];
const NESTED_WRITE_OPS =
  'create|createMany|connectOrCreate|update|updateMany|upsert|delete|deleteMany|set|disconnect|connect';
const RELATION_WRITE = new RegExp(`(?:${RELATION_FIELDS.join('|')})\\s*:\\s*\\{\\s*(?:${NESTED_WRITE_OPS})\\b`);

/**
 * Raw DML against the two tables. Matched on WHITESPACE-NORMALISED text, not per line: a template
 * literal that wraps after `INSERT INTO` is invisible to a line-by-line scan, and quoted identifiers
 * (`INSERT INTO "survey_responses"`) are the idiomatic `$executeRaw` form.
 */
const RAW_DML = new RegExp(
  `\\b(?:insert\\s+into|update|delete\\s+from)\\s+(?:["'\`]?public["'\`]?\\s*\\.\\s*)?["'\`]?(surveys|survey_responses)\\b`,
  'i',
);

/**
 * The ONE runtime file allowed to issue raw DML against these tables, and the reason is the runbook's
 * own §0 P1: a seed write must be "ported to raw SQL, ported to a C# seeder (none exists today), or
 * the flip is blocked". Porting to raw SQL is the sanctioned disposition and it necessarily lands
 * here. #69 did exactly the same for critical_roles/successors (seed-demo.ts:1802, :1815).
 *
 * This exemption is DELIBERATELY A CLOSED LIST, asserted below to contain exactly this one file, and
 * is NOT a prefix or directory carve-out. Bounding a negative assertion by directory is how coverage
 * gets dropped silently — this repo has burned itself on that twice. A second seed wanting raw DML
 * must be added here by hand, in a diff a reviewer can see.
 */
const RAW_DML_EXEMPT = ['packages/db/prisma/seed-demo.ts'];

/**
 * The roots §0 P1's own delegate grep scans:
 *   grep -rnE '\.(<model>)\.(create|…)\(' packages/ apps/web/ workers/ scripts/
 * Using the rule's own scope rather than inventing one — a writer is a thing that runs against the
 * database, and `tests/` is both outside P1 and backstopped by `tsc` the moment the model is deleted.
 * This is a CITED boundary, not a convenience: the two hits it drops are a comment
 * (apps/web/lib/platform-api/engagement.ts:433) and a synthetic fixture STRING inside a test
 * (tests/db/pre-flip-repo-scan.test.ts:170), neither of which can write to anything.
 */
const P1_ROOTS = ['packages/', 'apps/web/', 'workers/', 'scripts/'];

/**
 * A comment cannot write to a table. `apps/web/lib/platform-api/engagement.ts:433` documents the
 * pre-cutover shape by quoting `db.survey.create({ data: … })` verbatim — deliberately, as the record
 * of what the C# port replaced. Matching it would force deleting a useful comment to make a tripwire
 * pass, which is how tripwires teach people to lie to them.
 *
 * Only comment TEXT is removed; code keeping a trailing comment is still scanned in full, proved
 * below. Block comments are collapsed to a space so a `/* … *​/` spanning lines cannot glue two
 * statements into one match.
 */
function stripComments(text: string): string {
  return (
    text
      // Block comments keep their newlines, or every `file:line` in the failure report below would be
      // wrong for the rest of the file — a report that misdirects is worse than no report.
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      // `[^:]` keeps `https://…` intact; `[^\n]*` never eats the newline, so line numbers hold.
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  );
}

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
 * Whole-file scan on collapsed whitespace — catches constructs split across lines. The DEFAULT for any
 * pattern spanning more than one token: Prettier (printWidth 120) breaks nested object literals, so
 * every nested relation write in this repo is `<relation>: {` on one line and `create:` on the next,
 * with zero single-line instances.
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

/** §0 P1's own scan scope, with comment text removed. See P1_ROOTS and stripComments above. */
const P1_SOURCES: Source[] = SOURCES.filter((s) => P1_ROOTS.some((r) => s.file.startsWith(r))).map((s) => ({
  file: s.file,
  text: stripComments(s.text),
}));

describe('surveys + survey_responses have zero TypeScript WRITERS (ownership flip #64, §0 P1)', () => {
  // An empty or partial scan makes every assertion below pass vacuously — the exact failure mode that
  // made /gate checks 14 and 17 tick against a database with no rows.
  describe('the scan is not vacuous', () => {
    // Per-directory floors, NOT an aggregate: apps/web alone contributes ~448 files, so an aggregate
    // floor lets the whole of packages/api/src go blind while still passing. Measured on this branch
    // 2026-08-10 (actual → floor): api/src 183→170, api/src/routers 83→75, apps/web 448→400,
    // workers 1→1, db/prisma 8→5, shared/src 24→20, ai/src 21→15, tests 297→270, scripts 35→30.
    const MUST_SCAN: [string, number][] = [
      ['packages/api/src', 170],
      ['packages/api/src/routers', 75],
      ['apps/web', 400],
      ['workers', 1],
      ['packages/db/prisma', 5],
      ['packages/shared/src', 20],
      ['packages/ai/src', 15],
      ['tests', 270],
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

    // RAW_DML runs over the RUNTIME set specifically, so an aggregate floor here would reproduce the
    // very defect the per-directory floors above exist to fix.
    it.each([
      ['packages/api/src', 170],
      ['apps/web', 400],
      ['workers', 1],
      ['packages/db/prisma', 5],
    ])('classifies %s as RUNTIME (at least %i files)', (dir, floor) => {
      const n = RUNTIME_SOURCES.filter((s) => s.file.startsWith(`${dir}/`)).length;
      expect(n, `${dir} contributed ${n} files to the RUNTIME set, expected >= ${floor}`).toBeGreaterThanOrEqual(floor);
    });

    it('classifies runtime vs non-runtime without emptying either side', () => {
      expect(RUNTIME_SOURCES.length).toBeGreaterThan(600);
      expect(SOURCES.length - RUNTIME_SOURCES.length).toBeGreaterThan(250);
    });

    // The seed is the whole point of this tripwire. If the walker ever stops reaching it, every
    // assertion below still passes — and passes for the worst possible reason.
    it('reaches packages/db/prisma/seed-demo.ts, the file this tripwire exists for', () => {
      expect(ALL_FILES).toContain('packages/db/prisma/seed-demo.ts');
      expect(RUNTIME_SOURCES.map((s) => s.file)).toContain('packages/db/prisma/seed-demo.ts');
      // …and it must survive the P1 scope filter, which is the set the delegate assertion uses.
      expect(P1_SOURCES.map((s) => s.file)).toContain('packages/db/prisma/seed-demo.ts');
    });

    // P1_SOURCES is a NARROWING of SOURCES. Floor each root separately: an aggregate floor would let
    // any single root fall out of scope while the total still looked healthy.
    it.each([
      ['packages/', 250],
      ['apps/web/', 400],
      ['workers/', 1],
      ['scripts/', 30],
    ])('P1 scope still covers %s (at least %i files)', (root, floor) => {
      const n = P1_SOURCES.filter((s) => s.file.startsWith(root)).length;
      expect(n, `${root} contributed ${n} files to the P1 scope, expected >= ${floor}`).toBeGreaterThanOrEqual(floor);
    });
  });

  // Prove every pattern matches what it is supposed to match. Without this, a typo'd regex is
  // indistinguishable from a clean repo. The delegate literals are copied from the shape
  // seed-demo.ts ACTUALLY used before the 2026-08-10 port (see git show main:…:2212,2231).
  describe('the matchers are not broken', () => {
    it('PRISMA_WRITE matches the real pre-port shapes', () => {
      expect(PRISMA_WRITE.test('const survey = await db.survey.create({')).toBe(true);
      expect(PRISMA_WRITE.test('await db.surveyResponse.create({')).toBe(true);
      expect(PRISMA_WRITE.test('await tenantDb.survey.updateMany({')).toBe(true);
      expect(PRISMA_WRITE.test('await prismaClient.surveyResponse.deleteMany({')).toBe(true);
      expect(PRISMA_WRITE.test('  .survey.upsert(')).toBe(false); // no receiver
    });

    it('PRISMA_WRITE does NOT match reads, which are legitimate until flip #64 executes', () => {
      expect(PRISMA_WRITE.test('db.survey.count({ where: { organizationId: orgId } })')).toBe(false);
      expect(PRISMA_WRITE.test('db.survey.findMany({')).toBe(false);
      expect(PRISMA_WRITE.test('db.surveyResponse.count({')).toBe(false);
    });

    it('PRISMA_WRITE does not match English prose ending a sentence', () => {
      // The defect the calibration tripwire actually regressed on.
      expect(PRISMA_WRITE.test('// …this is not an RBAC grant. survey.create is forbidden here')).toBe(false);
    });

    it('BRACKET_WRITE matches the dotted-access evasion', () => {
      expect(BRACKET_WRITE.test("await db['surveyResponse'].create({")).toBe(true);
      expect(BRACKET_WRITE.test('await db["survey"].delete({')).toBe(true);
    });

    it('RELATION_WRITE matches Prettier-formatted nested writes', () => {
      const formatted = 'data: {\n  createdSurveys: {\n    create: { title: "x" },\n  },\n}';
      expect(hitsAcrossLines([{ file: 'synthetic/rel.ts', text: formatted }], RELATION_WRITE)).toHaveLength(1);
      const responses = 'data: {\n  surveyResponses: {\n    createMany: { data: [] },\n  },\n}';
      expect(hitsAcrossLines([{ file: 'synthetic/rel2.ts', text: responses }], RELATION_WRITE)).toHaveLength(1);
    });

    it('RAW_DML matches wrapped, quoted and schema-qualified DML', () => {
      expect(RAW_DML.test("db.query('INSERT INTO surveys (id) VALUES ($1)')")).toBe(true);
      expect(RAW_DML.test('UPDATE public.survey_responses SET answers =')).toBe(true);
      expect(RAW_DML.test('INSERT INTO "survey_responses" (id) VALUES ($1)')).toBe(true);
      expect(RAW_DML.test('DELETE FROM surveys WHERE id = $1')).toBe(true);
      const wrapped = 'INSERT INTO\n  "surveys" (id)';
      expect(hitsAcrossLines([{ file: 'synthetic/raw.ts', text: wrapped }], RAW_DML)).toHaveLength(1);
    });

    it('RAW_DML does not match a SELECT', () => {
      expect(RAW_DML.test('SELECT id FROM surveys WHERE organization_id = $1')).toBe(false);
    });

    // stripComments and P1_ROOTS are the two narrowings in this file. Both are exactly the kind of
    // bounded region that silently drops coverage, so both are proved to still catch real code.
    it('stripComments removes comment text but never real code', () => {
      expect(PRISMA_WRITE.test(stripComments('// await db.survey.create({})'))).toBe(false);
      expect(PRISMA_WRITE.test(stripComments('/* await db.survey.create({}) */'))).toBe(false);
      // Code with a trailing comment is still fully scanned.
      expect(PRISMA_WRITE.test(stripComments('await db.survey.create({}); // seed the demo org'))).toBe(true);
      // A block comment on one line must not blind the next.
      expect(PRISMA_WRITE.test(stripComments('/* note */\nawait db.surveyResponse.create({});'))).toBe(true);
    });

    it('stripComments preserves line numbering, so the failure report stays accurate', () => {
      const text = '/* a\nb\nc */\nawait db.survey.create({});';
      const stripped = stripComments(text);
      expect(stripped.split('\n')).toHaveLength(text.split('\n').length);
      expect(hits([{ file: 'synthetic/lines.ts', text: stripped }], PRISMA_WRITE)[0]).toMatch(
        /^synthetic\/lines\.ts:4:/,
      );
    });

    it('stripComments does not mangle a URL', () => {
      expect(stripComments('const u = "https://example.test/x"; // note')).toContain('https://example.test/x');
    });
  });

  it('no TypeScript source issues a Prisma WRITE to survey / surveyResponse', () => {
    const found = [...hits(P1_SOURCES, PRISMA_WRITE), ...hits(P1_SOURCES, BRACKET_WRITE)];
    expect(
      found,
      `A Prisma delegate WRITE to surveys/survey_responses is back. C# EngagementWriteRepository is the\n` +
        `sole writer of these tables; §0 P1 of the ownership-flip runbook makes any TS writer — SEEDS\n` +
        `INCLUDED — a hard blocker on flip #64. If this is a seed, port it to raw SQL as\n` +
        `packages/db/prisma/seed-demo.ts:2226-2270 does. This exact defect hid for ten weeks:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('no nested Prisma relation write reaches surveys / survey_responses via a User back-relation', () => {
    const found = hitsAcrossLines(SOURCES, RELATION_WRITE);
    expect(
      found,
      `A nested relation write reaches surveys/survey_responses without naming its delegate.\n` +
        `\`db.user.update({ data: { createdSurveys: { create: … } } })\` is a compile-valid write that a\n` +
        `\`.model.method\` grep cannot see — the runbook calls this out, and the blocker sets for flips\n` +
        `#66 and #68 both missed it on first assembly:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  describe('raw DML is confined to the one sanctioned seed', () => {
    it('no RUNTIME source outside the exemption issues raw DML against the two tables', () => {
      const scanned = RUNTIME_SOURCES.filter((s) => !RAW_DML_EXEMPT.includes(s.file));
      const found = hitsAcrossLines(scanned, RAW_DML);
      expect(
        found,
        `A runtime source issues raw INSERT/UPDATE/DELETE against surveys/survey_responses. Porting a\n` +
          `Prisma writer to raw SQL is sanctioned ONLY for the seed (§0 P1); anywhere else it converts a\n` +
          `compiler-visible writer into an invisible one, which §0 P2 forbids outright:\n${found.join('\n')}`,
      ).toEqual([]);
    });

    // The exemption is the weakest point in this file: widen it and the assertion above quietly stops
    // meaning anything. Pin its exact contents so widening requires an explicit, reviewable diff.
    it('the exemption is exactly one file and has not been widened', () => {
      expect(RAW_DML_EXEMPT).toEqual(['packages/db/prisma/seed-demo.ts']);
    });

    it('the exemption is not vacuous — the exempt file really does contain raw DML', () => {
      const seed = SOURCES.find((s) => s.file === 'packages/db/prisma/seed-demo.ts');
      expect(seed, 'seed-demo.ts was not scanned at all').toBeDefined();
      expect(hitsAcrossLines([seed!], RAW_DML).length).toBeGreaterThan(0);
    });

    // Prove the exemption is NARROW: the same raw DML in an ordinary runtime path is still caught.
    // Without this, exempting the whole of packages/db — or the whole repo — would look identical.
    it('still catches raw DML planted in a non-exempt runtime path', () => {
      const planted = [{ file: 'packages/api/src/repositories/evil.repository.ts', text: 'INSERT INTO surveys (id)' }];
      const scanned = planted.filter((s) => !RAW_DML_EXEMPT.includes(s.file));
      expect(hitsAcrossLines(scanned, RAW_DML)).toHaveLength(1);
    });
  });
});
