import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// F13 — the assessment_types TS-writer tripwire.
//
// WHY THIS EXISTS. F13 made C# (AssessmentTypeWriteDbContext, PR #309) the writer of assessment_types
// and moved the table to efcoreStranglerWrite[] in docs/architecture/table-ownership.md. The ledger note
// records the premise that TypeScript has NO runtime writer ("TS only had the read-only
// assessment.listTypes"). Nothing enforced that premise: a `tenantDb.assessmentType.create(...)` added
// to any router would compile and silently create a second writer that bypasses the C# name/code rules
// and audit row. This test makes that premise checkable, in the shape of
// calibration-no-ts-writers.test.ts / surveys-no-ts-writers.test.ts.
//
// WHAT IS ALLOWED.
//   - READS (listTypes, the question repository's findFirst, relation `include`s, UI reads of
//     `x.assessmentType.name` off JSON). Only WRITE methods are matched.
//   - packages/db/prisma/seed-demo.ts — the demo seed creates the default catalog for a demo org
//     (find-or-create by code). It is seeding, not a runtime path. It is allow-listed BY FILE, and
//     pinned below so the allowance cannot silently widen to a second write in that file.
//   - tests/** and *.test.* — mocks spell `assessmentType: { create: vi.fn() }`, which is not a write.
//   - RAW SQL under scripts/ (and tools/, contracts/): scripts/parity/seed.ts INSERTs/DELETEs the
//     `assessment-types` write-surface fixture rows on a `pg` client against the parity database — a
//     harness fixture, not a runtime path (the calibration tripwire's precedent). Prisma delegate and
//     nested writes are still forbidden there; only raw DML is scoped to RUNTIME sources.
//
// KNOWN LIMIT. Unlike the calibration tripwire this one cannot flag a BARE delegate reference
// (`() => tenantDb.assessmentType`): `assessmentType` is also a relation/JSON field name read all over
// apps/web, so a receiver-agnostic bare match would be all false positives. Write METHODS, nested relation
// writes, bracket access and raw DML are covered.

const ROOT = join(__dirname, '..', '..');
const SELF = 'tests/governance/assessment-types-no-ts-writers.test.ts';
const SEED_ALLOWED = 'packages/db/prisma/seed-demo.ts';

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

function isTestFile(file: string): boolean {
  return file.startsWith('tests/') || /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(file);
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
      continue;
    }
    if (st.isDirectory()) walk(childRel, out);
    else if (/\.(ts|tsx|mts|cts|mjs|js)$/.test(name) && childRel !== SELF) out.push(childRel);
  }
}

const ALL_FILES: string[] = [];
walk('', ALL_FILES);
type Source = { file: string; text: string };
const SCANNED: Source[] = ALL_FILES.filter((f) => !isTestFile(f)).map((file) => ({
  file,
  text: readFileSync(join(ROOT, file), 'utf8'),
}));

const WRITE_METHODS =
  'create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany';
/** `db.assessmentType.create(` — any receiver; whitespace before the dots tolerated (Prettier wraps chains). */
const DELEGATE_WRITE = new RegExp(`\\.\\s*assessmentType\\s*\\.\\s*(?:${WRITE_METHODS})\\s*\\(`);
/** `db['assessmentType'].create(` */
const BRACKET_WRITE = new RegExp(`\\[\\s*['"\`]assessmentType['"\`]\\s*\\]\\s*\\.\\s*(?:${WRITE_METHODS})\\b`);
/** `assessmentType: { create: … }` inside an assignment/question write — no delegate token at all. */
const NESTED_WRITE = /\bassessmentType\s*:\s*\{\s*(?:create|connectOrCreate|update|upsert|delete)\b/;
/** Raw DML, quoted/schema-qualified or not. */
const RAW_DML = /\b(?:insert\s+into|update|delete\s+from)\s+(?:["'`]?public["'`]?\s*\.\s*)?["'`]?assessment_types\b/i;

function hitsAcrossLines(sources: Source[], re: RegExp): string[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const found: string[] = [];
  for (const { file, text } of sources) {
    for (const m of text.replace(/\s+/g, ' ').matchAll(g)) found.push(`${file}: …${m[0]}…`);
  }
  return found;
}

const NON_RUNTIME_PREFIXES = ['scripts/', 'tools/', 'contracts/'];
const RUNTIME: Source[] = SCANNED.filter((s) => !NON_RUNTIME_PREFIXES.some((p) => s.file.startsWith(p)));

/** [label, pattern, runtime-only?] */
const PATTERNS: [string, RegExp, boolean][] = [
  ['delegate write', DELEGATE_WRITE, false],
  ['bracket write', BRACKET_WRITE, false],
  ['nested relation write', NESTED_WRITE, false],
  ['raw DML', RAW_DML, true],
];

describe('assessment_types has no TypeScript writer outside the demo seed (F13 premise)', () => {
  it.each([
    ['packages/api/src', 150],
    ['apps/web', 400],
    ['packages/db/prisma', 5],
    ['scripts', 20],
  ])('the scan is not vacuous: %s contributes >= %i files', (dir, floor) => {
    expect(existsSync(join(ROOT, dir)), `${dir} moved — update this list, do not delete it`).toBe(true);
    const n = SCANNED.filter((s) => s.file.startsWith(`${dir}/`)).length;
    expect(n).toBeGreaterThanOrEqual(floor);
  });

  it('the patterns match the constructs they claim to, and not reads', () => {
    expect(DELEGATE_WRITE.test('await tenantDb.assessmentType.create({ data })')).toBe(true);
    expect(DELEGATE_WRITE.test('await tx .assessmentType .updateMany({')).toBe(true);
    expect(BRACKET_WRITE.test("db['assessmentType'].upsert({")).toBe(true);
    expect(NESTED_WRITE.test('data: { assessmentType: { connectOrCreate: {')).toBe(true);
    expect(RAW_DML.test('INSERT INTO "public"."assessment_types" (id)')).toBe(true);
    expect(RAW_DML.test('UPDATE assessment_types SET is_active = false')).toBe(true);
    // Reads stay allowed:
    expect(DELEGATE_WRITE.test('return db.assessmentType.findMany({ where })')).toBe(false);
    expect(DELEGATE_WRITE.test('{test.assessmentType.name}')).toBe(false);
    expect(NESTED_WRITE.test('include: { assessmentType: { select: { id: true } } }')).toBe(false);
    expect(RAW_DML.test('SELECT id FROM assessment_types WHERE organization_id = $1')).toBe(false);
  });

  it('the scanner actually scans (a stubbed hitsAcrossLines must not pass)', () => {
    const planted: Source[] = [
      { file: 'synthetic/w.ts', text: 'await tenantDb\n  .assessmentType.create({ data });\n' },
      { file: 'synthetic/clean.ts', text: 'return db.assessmentType.findMany({ where });\n' },
    ];
    const files = hitsAcrossLines(planted, DELEGATE_WRITE).map((h) => h.split(':')[0]);
    expect(files).toEqual(['synthetic/w.ts']);
  });

  it.each(PATTERNS)('no %s reaches assessment_types outside the allow-listed seed', (_label, re, runtimeOnly) => {
    const found = hitsAcrossLines(
      (runtimeOnly ? RUNTIME : SCANNED).filter((s) => s.file !== SEED_ALLOWED),
      re,
    );
    expect(
      found,
      `A TypeScript writer reaches assessment_types. F13 made C# the writer (AssessmentTypeWriteEndpoints,\n` +
        `Platform:AssessmentTypeWriteEnabled) — add behaviour there, not here:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('the runtime set still includes the packages that matter (raw-DML scope is not vacuous)', () => {
    for (const [dir, floor] of [
      ['packages/api/src', 150],
      ['apps/web', 400],
    ] as const) {
      expect(RUNTIME.filter((s) => s.file.startsWith(`${dir}/`)).length, dir).toBeGreaterThanOrEqual(floor);
    }
  });

  it('the seed allowance is exactly one create (find-or-create of the demo catalog)', () => {
    const seed = SCANNED.find((s) => s.file === SEED_ALLOWED);
    expect(seed, `${SEED_ALLOWED} moved — update SEED_ALLOWED`).toBeDefined();
    const writes = PATTERNS.flatMap(([, re]) => hitsAcrossLines([seed!], re));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('.assessmentType.create(');
  });
});
