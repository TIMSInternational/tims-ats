/**
 * packages/db/prisma/backfill-assessment-norms.ts
 *
 * One-time, idempotent catch-up for Assessment Player Slice 5 (local norm
 * scoring, docs/superpowers/specs/2026-08-01-assessment-player-norm-scoring-design.md).
 * Computes band/percentile for every already-completed, non-partial
 * AssessmentResult using TODAY's full population per org + assessment type —
 * a one-off catch-up, not a re-run of point-in-time history (see spec's
 * "Backfill" section).
 *
 * Safe to re-run — but NOT by re-computing/overwriting: `--apply` only ever
 * writes a row whose `band` is still NULL (issue #17). A stable snapshot
 * (band/percentile/normSampleSize) is an invariant of the design spec once
 * live scoring has set it — an unconditional overwrite here would silently
 * reshuffle already-live-scored bands (population membership shifts every
 * time someone else completes the same assessment type) if this script were
 * ever re-run after live scoring started. An already-scored row is left
 * untouched, loudly, in both dry-run and apply output.
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

/**
 * Mirrors the live-scoring query's "non-partial" semantics EXACTLY
 * (`listOtherNormalizedScoresInTx`'s `breakdown: { path: ['pendingManual'],
 * equals: [] }` predicate): a row is non-partial ONLY when `breakdown` is a
 * plain object with a `pendingManual` key that is present, an array, AND
 * empty.
 *
 * A `null` breakdown, a breakdown with no `pendingManual` key at all (e.g.
 * externally-ingested rows, or seed-demo.ts's DISC-shaped `{D,I,S,C}`
 * breakdowns), and a non-empty `pendingManual` array are ALL partial
 * (excluded from scoring and from the eligible population). Previously this
 * helper miscounted `null`/missing-key breakdowns as non-partial, which
 * disagreed with the live path — two candidates with identical scores could
 * get different bands depending on which path scored them. Fixed
 * 2026-08-01 per whole-branch review finding.
 */
export function isNonPartial(breakdown: Prisma.JsonValue | null): boolean {
  if (breakdown === null || typeof breakdown !== 'object' || Array.isArray(breakdown)) return false;
  const pendingManual = (breakdown as Record<string, unknown>).pendingManual;
  return Array.isArray(pendingManual) && pendingManual.length === 0;
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

    let totalConsidered = 0;
    let totalWritten = 0;
    let totalSkippedAlreadyScored = 0;

    for (const org of orgs) {
      const results = await db.assessmentResult.findMany({
        where: { organizationId: org.id, normalizedScore: { not: null } },
        select: {
          assignmentId: true,
          normalizedScore: true,
          breakdown: true,
          band: true,
          assignment: { select: { assessmentTypeId: true, status: true } },
        },
      });

      // Snapshot of each result's CURRENT band as of this read — the guard's
      // preview. The authoritative guard is the DB-level `band: null` filter
      // on the write itself (below), which stays correct even if a live
      // scoring write lands between this read and the apply loop; this map
      // only drives the loud dry-run/apply reporting.
      const currentBandByAssignment = new Map(results.map((r) => [r.assignmentId, r.band]));

      const rows: ResultRow[] = results
        .filter((r) => r.assignment.status === 'completed')
        .map((r) => ({
          assignmentId: r.assignmentId,
          assessmentTypeId: r.assignment.assessmentTypeId,
          normalizedScore: r.normalizedScore!,
          hasPending: !isNonPartial(r.breakdown),
        }));

      const plan = computeBackfillPlan(rows);
      // NOTE: this counts every non-partial result CONSIDERED on this run, not
      // a diff against previously-stored values — a second run against
      // already-backfilled data will log the same "considered" count again
      // since planning always recomputes deterministically (see file header).
      // What changes on a re-run is the eligible/skipped split below.
      const eligibleToWrite = plan.filter((row) => currentBandByAssignment.get(row.assignmentId) == null);
      const alreadyScored = plan.length - eligibleToWrite.length;

      console.log(
        `  [${org.slug}] ${plan.length} non-partial result(s) considered — ` +
          `${eligibleToWrite.length} eligible to write (band IS NULL), ` +
          `${alreadyScored} already scored`,
      );
      if (alreadyScored > 0) {
        console.log(
          `  [${org.slug}] *** SKIPPING ${alreadyScored} row(s) that already have a non-null band — ` +
            `re-running this script NEVER overwrites an already-scored result (issue #17). ` +
            `If you expected a full recompute, this is NOT that script. ***`,
        );
      }

      totalConsidered += plan.length;
      totalSkippedAlreadyScored += alreadyScored;

      if (!APPLY) continue;

      for (const row of plan) {
        // The real guard: only write a row that is STILL unscored (band IS
        // NULL) at write time. `updateMany`'s WHERE clause is the atomic
        // boundary — matches 0 rows for an already-scored assignment (whether
        // it was already scored before this script ran, or was scored by a
        // concurrent live submission after the read above), so `count` tells
        // us the truth even under a race the in-memory snapshot could miss.
        const result = await db.assessmentResult.updateMany({
          where: { assignmentId: row.assignmentId, band: null },
          data: { percentile: row.percentile, band: row.band, normSampleSize: row.normSampleSize },
        });
        totalWritten += result.count;
      }
    }

    console.log(
      `\nmode=${APPLY ? 'APPLY' : 'DRY-RUN'} orgs=${orgs.length} considered=${totalConsidered} ` +
        `${APPLY ? `written=${totalWritten}` : `would-write=${totalConsidered - totalSkippedAlreadyScored}`} ` +
        `skipped-already-scored=${totalSkippedAlreadyScored}`,
    );
  };

  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
