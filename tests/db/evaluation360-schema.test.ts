import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@tims/db';

/**
 * INVERTED 2026-08-06 by ownership flip #67 (runbook §7e) — NOT deleted.
 *
 * This file used to assert the shape of three Prisma models — `ReviewCycle`, `RaterAssignment`,
 * `RaterResponse` — against `Prisma.dmmf`. The flip deleted those models and gave `review_cycles`,
 * `rater_assignments` and `rater_responses` to EF Core, so every one of those assertions became
 * false. Deleting the file was the obvious move and the wrong one: a test that pins an era starts
 * DEFENDING that era, and the guarantees it carried are still worth having — they just have a new
 * home. So:
 *
 *   - the model-shape cases are inverted into "the models are ABSENT from the generated client";
 *   - the COLUMN/constraint guarantees they encoded are re-pointed at
 *     `services/Tims.Platform/db/flip-ddl/evaluation360.sql`, which is now the repo's bootstrap
 *     definition of these tables and is extracted from the committed production baseline. That is a
 *     strictly better oracle than the Prisma model ever was: the model described what Prisma
 *     intended, the artifact describes what production actually has;
 *   - the ENUM case survives UNCHANGED, because flip #67 deliberately kept the three enums (see the
 *     block in `evaluation360.prisma`). It is now the guard on that decision.
 *
 * The tables are pinned BY NAME below, never discovered, so dropping one from the artifact is a red
 * build rather than a quietly smaller assertion.
 */

const FLIP_DDL = readFileSync(
  join(__dirname, '..', '..', 'services/Tims.Platform/db/flip-ddl/evaluation360.sql'),
  'utf8',
);

describe('360 Evaluation schema — post-flip #67 (tables owned by EF Core)', () => {
  it('the flip-DDL artifact is non-empty and covers all three tables (else everything below is vacuous)', () => {
    expect(FLIP_DDL.length).toBeGreaterThan(2000);
    for (const t of ['review_cycles', 'rater_assignments', 'rater_responses']) {
      expect(FLIP_DDL, `${t} is missing from evaluation360.sql`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`),
      );
    }
  });

  it('no evaluation360 model remains in the generated Prisma client', () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
    for (const model of ['ReviewCycle', 'RaterAssignment', 'RaterResponse']) {
      expect(
        models,
        `model ${model} is back in the generated client. Ownership flip #67 gave its table to EF Core;\n` +
          `restoring the model re-creates a second writer (runbook §6 — reverting a flip is a reviewed act).`,
      ).not.toContain(model);
    }
    // ...and the mapped tables are gone from the Prisma side entirely, not merely renamed.
    const dbNames = Prisma.dmmf.datamodel.models.map((m) => m.dbName);
    for (const t of ['review_cycles', 'rater_assignments', 'rater_responses']) {
      expect(dbNames, `some Prisma model still @@maps ${t}`).not.toContain(t);
    }
  });

  /**
   * Slice ONE table's `CREATE TABLE` block out of the artifact.
   *
   * Load-bearing. An earlier revision matched each column with `new RegExp('^\\s+' + col + '\\s','m')`
   * against the WHOLE 287-line file, which contains three CREATE TABLE blocks. `id`,
   * `organization_id`, `status`, `created_at` and `updated_at` are declared on the sibling tables
   * too, so five of the ten pinned columns were satisfied no matter what happened to `review_cycles`
   * — the assertion read far stronger than it was. Scope the match to the block or it proves little.
   */
  function tableBlock(ddl: string, table: string): string {
    const m = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'm').exec(ddl);
    if (!m) throw new Error(`no CREATE TABLE block for ${table} in the flip DDL — the artifact changed shape`);
    return m[1];
  }

  it('review_cycles keeps its lifecycle + FK columns in the EF-owned definition', () => {
    const block = tableBlock(FLIP_DDL, 'review_cycles');
    // Non-vacuity: prove the slice is a real, plausible block before asserting absence-shaped things
    // against it, and prove it is NOT the whole file.
    expect(block.length, 'review_cycles block looks empty').toBeGreaterThan(100);
    expect(block.length, 'the slice returned the whole artifact — the regex is not scoping').toBeLessThan(
      FLIP_DDL.length / 2,
    );
    // ...and prove the scoping actually discriminates: a column unique to a SIBLING table must not
    // appear in this block. Without this, a broken slicer that returned everything still passes.
    expect(block, 'sibling column leaked into the review_cycles block').not.toMatch(/^\s+competency_key\s/m);

    for (const col of [
      'id',
      'organization_id',
      'name',
      'status',
      'opens_at',
      'closes_at',
      'published_at',
      'created_by_id',
      'created_at',
      'updated_at',
    ]) {
      expect(block, `review_cycles.${col}`).toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
    }
    expect(block).toMatch(/status public\."ReviewCycleStatus"/);
  });

  it('rater_assignments keeps its relationship + status columns and the 3-column uniqueness', () => {
    expect(FLIP_DDL).toMatch(/relationship public\."RaterRelationship"/);
    expect(FLIP_DDL).toMatch(/status public\."RaterAssignmentStatus"/);
    // @@unique([cycleId, subjectUserId, raterUserId]) — now a UNIQUE INDEX in the artifact.
    expect(FLIP_DDL).toMatch(
      /CREATE UNIQUE INDEX[^;]*rater_assignments_cycle_id_subject_user_id_rater_user_id_key ON public\.rater_assignments USING btree \(cycle_id, subject_user_id, rater_user_id\)/,
    );
  });

  it('rater_responses keeps rating/comment and the (assignment_id, competency_key) uniqueness', () => {
    expect(FLIP_DDL).toMatch(/^\s+rating integer NOT NULL/m);
    // `comment` stays NULLABLE — it was `String?` on the Prisma model and the anonymity report
    // depends on being able to distinguish "no comment" from "empty comment".
    expect(FLIP_DDL).toMatch(/^\s+comment character varying\(5000\)(?!.*NOT NULL)/m);
    expect(FLIP_DDL).toMatch(
      /CREATE UNIQUE INDEX[^;]*rater_responses_assignment_id_competency_key_key ON public\.rater_responses USING btree \(assignment_id, competency_key\)/,
    );
  });

  it('all three tables keep fail-closed tenant RLS in the EF-owned definition', () => {
    for (const t of ['review_cycles', 'rater_assignments', 'rater_responses']) {
      expect(FLIP_DDL, `${t} ENABLE RLS`).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      expect(FLIP_DDL, `${t} FORCE RLS`).toMatch(new RegExp(`ALTER TABLE ONLY public\\.${t} FORCE ROW LEVEL SECURITY`));
      // A COLUMN PREDICATE on both USING and WITH CHECK — unlike the calibration_* tables, these
      // three have an organization_id, so §0 P9's subquery carve-out does not apply to them.
      const policy = new RegExp(
        `CREATE POLICY tenant_isolation ON public\\.${t} USING \\(\\(organization_id = .*WITH CHECK \\(\\(organization_id = `,
      );
      expect(FLIP_DDL, `${t} tenant_isolation policy shape`).toMatch(policy);
    }
    // Fail-CLOSED: an unset GUC must not match every row (#111). NULLIF(...)::uuid yields NULL, and
    // `organization_id = NULL` is never true. The absence of an `OR ... IS NULL` disjunct is the
    // property being pinned.
    expect(FLIP_DDL).not.toMatch(/OR .*current_org_id\(\) IS NULL/);
  });

  it('defines the 3 evaluation360 enums with the exact values (KEPT by flip #67 — see evaluation360.prisma)', () => {
    const enums = Prisma.dmmf.datamodel.enums;
    const reviewCycleStatus = enums.find((e) => e.name === 'ReviewCycleStatus');
    const raterRelationship = enums.find((e) => e.name === 'RaterRelationship');
    const raterAssignmentStatus = enums.find((e) => e.name === 'RaterAssignmentStatus');
    expect(reviewCycleStatus!.values.map((v) => v.name)).toEqual(['draft', 'open', 'closed', 'published']);
    expect(raterRelationship!.values.map((v) => v.name)).toEqual(['self', 'manager', 'peer', 'direct_report']);
    expect(raterAssignmentStatus!.values.map((v) => v.name)).toEqual(['pending', 'submitted']);
  });

  it('the Prisma enum values match the Postgres types the EF-owned tables actually use', () => {
    // The cross-stack half of the case above: `packages/db/src/index.ts` re-exports these three, and
    // scripts/parity/seed.ts casts to the Postgres types by name. If the two ever diverge, the seed
    // fails at runtime against prod-shaped data and nothing else notices.
    expect(FLIP_DDL).toMatch(
      /CREATE TYPE public\."ReviewCycleStatus" AS ENUM \(\s*'draft',\s*'open',\s*'closed',\s*'published'\s*\)/,
    );
    expect(FLIP_DDL).toMatch(
      /CREATE TYPE public\."RaterRelationship" AS ENUM \(\s*'self',\s*'manager',\s*'peer',\s*'direct_report'\s*\)/,
    );
    expect(FLIP_DDL).toMatch(/CREATE TYPE public\."RaterAssignmentStatus" AS ENUM \(\s*'pending',\s*'submitted'\s*\)/);
  });
});
