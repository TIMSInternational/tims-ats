import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Phase-5 Slice 16 → #56. This file used to hold four SOURCE-GREP tripwires over
// `packages/api/src/routers/engagement.ts`, pinning the guards inside the TS `createActionPlan` /
// `updateActionPlan` mutations (assertSubjectInScope, assertScoped('actionPlan'), the atomic
// scopeWhereFor-guarded updateMany, and the H1 in-org `responsibleId` backstop).
//
// UPDATE 2026-08-05 (#56): both mutations were DELETED. C# is now the sole application writer of
// `action_plans` — POST /engagement/action-plans and PATCH /engagement/action-plans/{id}
// (services/Tims.Platform/src/Tims.Api/Engagement/EngagementWriteEndpoints.cs:171,:221), with the
// H1 cross-tenant `responsibleId` backstop in EngagementWriteRepository.cs:175 (create), :230-231
// (reassign) and the shared membership check at :291-293, plus a FOR UPDATE scope re-check that
// the TS updateMany only approximated. The behavioural equivalents of the four retired tripwires
// now live in
// services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementWriteTests.cs and
// .../EngagementWriteEndpointAuthTests.cs, and are exercised end-to-end against the live API by
// scripts/parity/write-surfaces.ts:1039-1120 (raw-SQL read-backs — that harness never had a
// `tsProcedure` field, see write-surfaces.ts:642, so it never depended on the TS side).
//
// What replaces them here is the INVARIANT that flip #68 actually needs, rather than a snapshot of
// the era in which TS still wrote the table: **no TypeScript code writes `action_plans`.** A grep
// for the old guards would have started DEFENDING the TS writers the moment they came back; this
// one goes red if any writer returns, by any route (Prisma delegate or raw SQL).

const ROOT = join(__dirname, '..', '..');

/** Source trees that ship application code. Tests, fixtures and the parity harness are excluded
 *  deliberately: `scripts/parity/seed.ts` legitimately INSERTs action_plans rows to build the
 *  fixture the C# write endpoints are then driven against, and it does so with raw `pg`, never
 *  through Prisma or a tRPC procedure. */
const SCANNED_TREES = ['packages/api/src', 'packages/db/src', 'packages/shared/src', 'apps/web', 'workers'];

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', 'coverage', '__tests__']);

function collectSources(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) collectSources(full, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

/** Every way TypeScript could write the table: the Prisma `actionPlan` delegate's mutating
 *  methods, and raw SQL against `action_plans`. Comments are stripped first so a PROSE mention of
 *  a deleted writer (this repo's routers are heavily commented) is not reported as a live writer. */
const WRITE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: 'prisma actionPlan mutation',
    re: /\bactionPlan\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  },
  { label: 'raw SQL write to action_plans', re: /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?action_plans"?/i },
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function findWriters(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const { label, re } of WRITE_PATTERNS) {
      const line = code.split('\n').findIndex((l) => re.test(l));
      if (line >= 0) hits.push(`${relative(ROOT, file)}:${line + 1} (${label})`);
    }
  }
  return hits;
}

describe('action_plans has ZERO TypeScript writers (#56, unblocks flip #68)', () => {
  const files = SCANNED_TREES.flatMap((t) => collectSources(join(ROOT, t)));

  // ── The empty-corpus guard. A scanner that walked nothing, or a regex that matched nothing,
  //    would print a tick for exactly the same reason a real all-clear does. Prove the corpus is
  //    populated AND that the detector actually detects, before trusting the all-clear below. ──
  it('the scanner has a real corpus and provably detects a writer', () => {
    expect(files.length).toBeGreaterThan(200);
    // The engagement router must be in scope — it is the file the deleted writers lived in.
    expect(files.map((f) => relative(ROOT, f))).toContain('packages/api/src/routers/engagement.ts');

    // Positive control: each pattern must fire on a synthetic writer.
    const synthetic = [
      'await db.actionPlan.create({ data: {} });',
      'await db.actionPlan.updateMany({ where: {}, data: {} });',
      "await client.query('INSERT INTO action_plans (id) VALUES ($1)', [id]);",
    ];
    for (const sample of synthetic) {
      expect(
        WRITE_PATTERNS.some((p) => p.re.test(sample)),
        `detector missed a synthetic writer: ${sample}`,
      ).toBe(true);
    }
    // Negative control: a comment ABOUT a writer must not be reported as one.
    expect(findWriters([]).length).toBe(0);
    expect(WRITE_PATTERNS.some((p) => p.re.test(stripComments('// db.actionPlan.create({})')))).toBe(false);
  });

  it('no application source writes action_plans (Prisma delegate or raw SQL)', () => {
    const writers = findWriters(files);
    expect(writers, `TS writers of action_plans found:\n${writers.join('\n')}`).toEqual([]);
  });

  it('the engagement router no longer declares the two action-plan mutations', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');
    // Declaration form only (`createActionPlan: permissionProcedure(`) — the file still MENTIONS
    // both names in its disposition header, and that prose must stay legal.
    expect(src).not.toMatch(/^\s*createActionPlan\s*:\s*permissionProcedure\(/m);
    expect(src).not.toMatch(/^\s*updateActionPlan\s*:\s*permissionProcedure\(/m);
  });
});
