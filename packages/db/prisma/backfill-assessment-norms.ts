/**
 * packages/db/prisma/backfill-assessment-norms.ts
 *
 * One-time, idempotent catch-up for Assessment Player Slice 5 (local norm
 * scoring, docs/superpowers/specs/2026-08-01-assessment-player-norm-scoring-design.md).
 * Computes band/percentile for every already-completed, non-partial
 * AssessmentResult using TODAY's full population per org + assessment type —
 * a one-off catch-up, not a re-run of point-in-time history (see spec's
 * "Backfill" section). Safe to re-run: deterministically overwrites.
 *
 * Usage:
 *   pnpm --filter @tims/db exec tsx prisma/backfill-assessment-norms.ts           # DRY-RUN (default)
 *   pnpm --filter @tims/db exec tsx prisma/backfill-assessment-norms.ts --apply   # write to DB
 */

import { fileURLToPath } from 'node:url';
import { PrismaClient, type Prisma } from '@prisma/client';
import { computeNormBand, type ScoreBand } from '@tims/shared';

interface ResultRow {
  assignmentId: string;
  assessmentTypeId: string;
  normalizedScore: number;
  hasPending: boolean;
}

interface BackfillPlanRow {
  assignmentId: string;
  percentile: number | null;
  band: ScoreBand | null;
  normSampleSize: number;
}

function hasPendingManual(breakdown: Prisma.JsonValue | null): boolean {
  if (breakdown === null || typeof breakdown !== 'object' || Array.isArray(breakdown)) return false;
  const pendingManual = (breakdown as Record<string, unknown>).pendingManual;
  return Array.isArray(pendingManual) && pendingManual.length > 0;
}

/**
 * Pure planning function (no DB/network) — given every completed result
 * across every org, groups by (organizationId is implicit in caller's query
 * scoping — see main() below) + assessmentTypeId, and computes each
 * non-partial result's band against every OTHER non-partial result in the
 * SAME assessmentTypeId. Exported for the unit test above.
 */
export function computeBackfillPlan(results: ResultRow[]): BackfillPlanRow[] {
  const nonPartial = results.filter((r) => !r.hasPending);
  const byType = new Map<string, ResultRow[]>();
  for (const r of nonPartial) {
    const list = byType.get(r.assessmentTypeId) ?? [];
    list.push(r);
    byType.set(r.assessmentTypeId, list);
  }

  const plan: BackfillPlanRow[] = [];
  for (const r of nonPartial) {
    const sameType = byType.get(r.assessmentTypeId) ?? [];
    const population = sameType.filter((other) => other.assignmentId !== r.assignmentId).map((o) => o.normalizedScore);
    const normResult = computeNormBand(r.normalizedScore, population);
    plan.push({
      assignmentId: r.assignmentId,
      percentile: normResult?.percentile ?? null,
      band: normResult?.band ?? null,
      normSampleSize: population.length,
    });
  }
  return plan;
}

// Everything below — including PrismaClient construction — is confined to
// this entrypoint guard so that `tsx prisma/backfill-assessment-norms.ts`
// runs the script, but the unit test's `import { computeBackfillPlan } from
// '.../backfill-assessment-norms'` never constructs a PrismaClient or fires
// a DB call as an import side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = new PrismaClient();
  const APPLY = process.argv.includes('--apply');

  const main = async () => {
    console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

    const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
    console.log(`Found ${orgs.length} organization(s)\n`);

    let totalUpdated = 0;

    for (const org of orgs) {
      const results = await db.assessmentResult.findMany({
        where: { organizationId: org.id, normalizedScore: { not: null } },
        select: {
          assignmentId: true,
          normalizedScore: true,
          breakdown: true,
          assignment: { select: { assessmentTypeId: true, status: true } },
        },
      });

      const rows: ResultRow[] = results
        .filter((r) => r.assignment.status === 'completed')
        .map((r) => ({
          assignmentId: r.assignmentId,
          assessmentTypeId: r.assignment.assessmentTypeId,
          normalizedScore: r.normalizedScore!,
          hasPending: hasPendingManual(r.breakdown),
        }));

      const plan = computeBackfillPlan(rows);
      console.log(`  [${org.slug}] ${plan.length} non-partial result(s) to update`);
      totalUpdated += plan.length;

      if (!APPLY) continue;

      for (const row of plan) {
        await db.assessmentResult.update({
          where: { assignmentId: row.assignmentId },
          data: { percentile: row.percentile, band: row.band, normSampleSize: row.normSampleSize },
        });
      }
    }

    console.log(`\nmode=${APPLY ? 'APPLY' : 'DRY-RUN'} orgs=${orgs.length} total-rows=${totalUpdated}`);
  };

  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
