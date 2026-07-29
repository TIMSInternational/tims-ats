import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { assertSubjectInScope, requireOrgScope, suppressBelowMin5, logDataAccess, selectFor } from '../access';
import { getEmployeeCompForSubject } from '../services/compensation.service';
import { convertMoney, sumMoney } from '../lib/currency';
import {
  normalizeCurrencyCode,
  buildBandDistribution,
  buildCompPayEquity,
  buildTotalCompBreakdown,
  buildCompDashboardKpis,
  buildSimulateAdjustment,
  type BandDistributionRowInput,
} from '@tims/shared';

export const compensationRouter = router({
  // ── Band Distribution (employees plotted within their band) ────────
  // Org-scope gated; min-5 suppression applied to per-band dots below (defense-in-
  // depth on top of requireOrgScope, NOT a replacement — the gate stays).
  //
  // Implicit-bucket guard (slice 6 round 3): employees with bandId=null are excluded
  // from the visible bands but STILL counted in getTotalCompBreakdown.employeeCount /
  // getDashboardKpis.compensatedEmployees. Without this guard an attacker can recover
  // the unbanded headcount via `N − Σ(visible band dots.length)`. The unassigned count
  // participates in the anyBandSuppressed trigger but is NOT emitted as a visible band.
  //
  // Positive-salary alignment (slice 6 round 13-14): dots are plotted ONLY for banded rows
  // with currentSalary > 0, so Σ dots equals the canonical positive-salary population shared
  // by getDashboardKpis.compensatedEmployees / getTotalCompBreakdown.employeeCount. The
  // non-positive-salary banded complement is folded into the suppression trigger so it can
  // never be recovered by differencing Σ dots against the canonical positive-salary count.
  getBandDistribution: permissionProcedure('compensation', 'read').query(async ({ ctx }) => {
    requireOrgScope(ctx.access);
    const [comps, unassignedCount, positiveUnbanded] = await Promise.all([
      db.employeeCompensation.findMany({
        where: { organizationId: ctx.user.organizationId, bandId: { not: null } },
        select: { currentSalary: true, currency: true, band: { select: { id: true, level: true, title: true, minSalary: true, midSalary: true, maxSalary: true, currency: true } } },
      }),
      db.employeeCompensation.count({
        where: { organizationId: ctx.user.organizationId, bandId: null },
      }),
      // FIX 1 (Codex#1, k-anon differencing oracle): the POSITIVE-salary unbanded sub-bucket.
      // dashboard.compensatedEmployees = positiveBanded + positiveUnbanded and Σ dots = positiveBanded, so
      // `compensatedEmployees − Σ dots = positiveUnbanded` leaks a 1..4 positive-unbanded group unless that
      // sub-bucket is itself folded into the all-or-nothing trigger. Count it here; the kernel folds it.
      db.employeeCompensation.count({
        where: { organizationId: ctx.user.organizationId, bandId: null, currentSalary: { gt: 0 } },
      }),
    ]);

    // Impure pass: only positive-salary banded rows are plotted (so Σ dots = the canonical positive-salary
    // banded population getDashboardKpis.compensatedEmployees / getTotalCompBreakdown.employeeCount align to).
    // Convert each salary into its band currency (nested fallback: band → row currency → USD), then hand the
    // ALREADY-CONVERTED rows + the three complement counts to the pure buildBandDistribution kernel (golden both
    // stacks) — which owns the grouping, dot clamp/outlier, mid-desc sort, and the all-or-nothing min-5 trigger
    // (any sub-floor band / unbanded bucket / non-positive-banded complement / positive-unbanded sub-bucket ⇒
    // EMPTY bands, no per-band keys, closing the present-key cardinality + N−Σ oracles). Display currency =
    // normalizeCurrencyCode(band.currency) (USD fallback); the nested-fallback currency is used ONLY to convert.
    const rows: BandDistributionRowInput[] = [];
    let positiveBanded = 0;
    for (const c of comps) {
      if (!c.band) continue;
      const salary = Number(c.currentSalary);
      if (!(salary > 0)) continue;
      positiveBanded += 1;
      const bandCurrency = normalizeCurrencyCode(c.band.currency, normalizeCurrencyCode(c.currency));
      const salaryInBandCurrency = (await convertMoney(salary, c.currency, bandCurrency)).amount;
      rows.push({
        bandId: c.band.id,
        level: c.band.level ?? '',
        title: c.band.title ?? '',
        min: Number(c.band.minSalary),
        mid: Number(c.band.midSalary),
        max: Number(c.band.maxSalary),
        currency: normalizeCurrencyCode(c.band.currency),
        salaryInBandCurrency,
      });
    }
    const nonPositiveBanded = comps.length - positiveBanded;
    return buildBandDistribution(rows, unassignedCount, nonPositiveBanded, positiveUnbanded);
  }),

  // ── Pay Equity ─────────────────────────────────────────────────────
  // Org-scope gated; min-5 suppression applied to group counts/averages below
  // (defense-in-depth on top of requireOrgScope, NOT a replacement — the gate stays).
  getPayEquity: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        groupBy: z.enum(['gender', 'ethnicity']).default('gender'),
        jobLevel: z.string().max(100).optional(),
      }).optional(),
    )
    .query(async ({ ctx }) => {
      requireOrgScope(ctx.access);
      const [company, compensations] = await Promise.all([
        db.company.findFirst({
          where: { organizationId: ctx.user.organizationId },
          select: { currency: true },
          orderBy: { createdAt: 'asc' },
        }),
        db.employeeCompensation.findMany({
          where: {
            organizationId: ctx.user.organizationId,
          },
          select: { currentSalary: true, currency: true, userId: true },
        }),
      ]);
      const displayCurrency = normalizeCurrencyCode(company?.currency, 'USD');

      // Without a compensation-side demographic join, this endpoint remains a single
      // org-wide "all" group. Normalize all salaries before computing its stats.
      const salaries = await Promise.all(
        compensations
          .map((c) => ({ amount: Number(c.currentSalary) || 0, currency: c.currency }))
          .filter((c) => c.amount > 0)
          .map((c) => convertMoney(c.amount, c.currency, displayCurrency).then((m) => m.amount)),
      );

      // min-5 shaping is now the pure buildCompPayEquity kernel (@tims/shared, golden-fixtured both stacks): a
      // single org-wide 'all' group, avg = mean (JS round), median = sorted[floor(n/2)]; when the group is 1..4
      // people the count AND both salary stats are nulled so no per-person salary leaks (average/median ARE
      // individual salary data at that size). Defense-in-depth on top of requireOrgScope. The router does the
      // impure FX conversion above and returns the kernel verbatim — honest-fixture rule.
      return buildCompPayEquity(salaries, displayCurrency);
    }),

  simulateAdjustment: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        userId: z.string().uuid(),
        proposedSalary: z.number().positive(),
        currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Per-person read: caller must be authorized to view this employee's compensation.
      await assertSubjectInScope(
        ctx.access,
        ctx.user.id,
        input.userId,
        'No puedes simular ajustes para este usuario',
      );

      // §21 field-auth (round 6, MEDIUM 5): build the findFirst select from selectFor
      // BEFORE the query so compaRatio/bandId only LEAVE the DB for entitled roles
      // (super/hr/hrbp). A leader/employee select carries id + currentSalary only —
      // the restricted analytics fields are never read, not read-then-omitted.
      const compSel = selectFor(ctx.access.roles, 'employeeCompensation');
      const canSeeCompaRatio = compSel.compaRatio === true;

      const compensation = await db.employeeCompensation.findFirst({
        where: { userId: input.userId, organizationId: ctx.user.organizationId },
        select: {
          id: true,
          // currentSalary drives the %change every entitled scoped reader receives.
          ...(compSel.currentSalary ? { currentSalary: true } : {}),
          ...(compSel.currency ? { currency: true } : {}),
          ...(canSeeCompaRatio ? { compaRatio: true } : {}),
          ...(compSel.bandId ? { bandId: true } : {}),
        },
      });

      if (!compensation) throw new Error('Compensacion no encontrada');

      // §21 matrix: simulateAdjustment reads employeeCompensation (restricted, FULL+AUDIT).
      // Audit BEFORE returning so a fail-closed audit-write failure aborts pre-serialization.
      await logDataAccess({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
        entity: 'employeeCompensation',
        recordId: compensation.id,
        action: 'read',
        ipAddress: ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
        userAgent: ctx.headers.get('user-agent'),
      });

      // `compensation` may omit currentSalary/compaRatio/bandId entirely (dynamic select
      // built from selectFor), so read each via a typed lens that tolerates absence.
      const compRec = compensation as { currentSalary?: unknown; currency?: string | null; compaRatio?: unknown; bandId?: string | null };
      const currentSalary = Number(compRec.currentSalary) || 0;
      const currentCurrency = normalizeCurrencyCode(compRec.currency, 'USD');
      const proposedCurrency = normalizeCurrencyCode(input.currency, currentCurrency);
      const convertedProposed = await convertMoney(input.proposedSalary, proposedCurrency, currentCurrency);
      const proposedSalaryForComparison = convertedProposed.amount;

      // §21 field-auth (slice 6 round 5 + round 6): compaRatio + bandId are HR-analytics
      // fields (super/hr/hrbp only) and are ONLY selected from the DB for entitled roles
      // (selectFor, above). The compa-ratio internals and band bounds are returned ONLY
      // to a caller entitled to compaRatio. A leader/employee (entitled to
      // compensation:read for their subject set, but NOT to compaRatio) receives the
      // projected new salary + %change — never currentCompaRatio, newCompaRatio, or the
      // band bounds (which co-disclose band position).
      const bandId = canSeeCompaRatio ? compRec.bandId ?? null : null;
      const band =
        canSeeCompaRatio && bandId
          ? await db.salaryBand.findUnique({ where: { id: bandId } })
          : null;

      const bandCurrency = band ? normalizeCurrencyCode(band.currency, currentCurrency) : currentCurrency;
      const proposedSalaryForBand = band
        ? (await convertMoney(input.proposedSalary, proposedCurrency, bandCurrency)).amount
        : proposedSalaryForComparison;

      // The impure FX conversions (above) are done; the pure buildSimulateAdjustment kernel (@tims/shared, golden
      // both stacks) shapes the projection. The six compa/band fields are spread in ONLY when the caller is
      // entitled to compaRatio (`compa != null`) — absent, not nulled, otherwise. When entitled but band-less,
      // all six keys are present (bandCurrency falls back to the current currency, never null — FIX 3 parity).
      return buildSimulateAdjustment({
        currentSalary,
        currentCurrency,
        proposedSalary: input.proposedSalary,
        proposedCurrency,
        proposedSalaryForComparison,
        compa: canSeeCompaRatio
          ? {
              currentCompaRatio: Number(compRec.compaRatio) || 0,
              band: band
                ? { min: Number(band.minSalary), mid: Number(band.midSalary), max: Number(band.maxSalary), bandCurrency }
                : null,
              proposedSalaryForBand,
            }
          : null,
      });
    }),

  // ── Market Comparison ──────────────────────────────────────────────
  // Org-level catalog: reads only salaryBand definitions, no per-person data.
  // Scoping is unnecessary — org-level catalog data, no per-person salary (same
  // justification the deleted getSalaryBands procedure used to state here).
  getMarketComparison: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        jobLevel: z.string().max(100).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const bands = await db.salaryBand.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.jobLevel ? { level: input.jobLevel } : {}),
        },
        orderBy: [{ level: 'asc' }],
      });

      return bands.map((b) => ({
        level: b.level,
        title: b.title,
        internalMin: Number(b.minSalary),
        internalMid: Number(b.midSalary),
        internalMax: Number(b.maxSalary),
        currency: b.currency,
      }));
    }),

  // ── Total Comp Breakdown ───────────────────────────────────────────
  // Org-scope gate only.
  //
  // min-5 floor (round 6, HIGH 2): this returns org-wide salary SUMS tied to an exact
  // employeeCount. Over a 1..4-person population a sum + its headcount IS individual
  // salary data (N=1 → totalBase = that person's salary). Count the underlying
  // contributor populations (rows with a base salary; rows with nonzero variablePay)
  // and when EITHER — or the total comp-row count — is 1..4, null the corresponding
  // totals + employeeCount and mark suppressed. An EMPTY (0) population passes through
  // as real zeros (reveals no individual). A sub-floor variablePay-only population
  // still suppresses ONLY when total comp rows are >=5 but the variablePay contributor
  // set is 1..4 — but since totalVariable would then be a sub-floor sum, we suppress the
  // whole breakdown (all sums share the same employeeCount denominator and are
  // cross-differenceable), keeping the all-or-nothing rule.
  getTotalCompBreakdown: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx }) => {
      requireOrgScope(ctx.access);
      const [company, compensations] = await Promise.all([
        db.company.findFirst({
          where: { organizationId: ctx.user.organizationId },
          select: { currency: true },
          orderBy: { createdAt: 'asc' },
        }),
        db.employeeCompensation.findMany({
          where: {
            organizationId: ctx.user.organizationId,
          },
          select: {
            currentSalary: true,
            variablePay: true,
            currency: true,
          },
        }),
      ]);
      const displayCurrency = normalizeCurrencyCode(company?.currency, 'USD');

      let baseContributors = 0;
      let variableContributors = 0;

      for (const emp of compensations) {
        const base = Number(emp.currentSalary) || 0;
        const variable = Number(emp.variablePay) || 0;
        if (base > 0) baseContributors += 1;
        if (variable > 0) variableContributors += 1;
      }

      // Denominator alignment + complementary-bucket guard (slice 6 round 13):
      //
      // ROOT CAUSE: returning `compensations.length` (ALL rows) alongside
      // `getDashboardKpis.compensatedEmployees` (rows with currentSalary > 0) created
      // two operands over the SAME population with DIFFERENT definitions. A caller who
      // receives both endpoints can compute:
      //   allRows − positiveRows = nonPositiveRows
      // recovering the implicit non-positive-salary bucket even when it is 1..4.
      //
      // FIX — two-pronged:
      // 1. Align the denominator: `employeeCount` now reports `baseContributors`
      //    (rows with currentSalary > 0), the SAME population definition as
      //    `getDashboardKpis.compensatedEmployees`. With both operands equal,
      //    the subtraction collapses to 0 and reveals no bucket.
      // 2. Fold the complementary bucket into the suppression trigger: the non-positive
      //    bucket = `compensations.length − baseContributors`. When THAT count is 1..4,
      //    suppress the whole breakdown (a non-positive bucket of size 1..4 is itself
      //    sensitive — it identifies those employees). suppressBelowMin5(0) → not
      //    suppressed (empty reveals no one).
      //
      // All existing triggers are preserved:
      //   • total comp-row population (compensations.length)
      //   • positive-salary contributor set (baseContributors)
      //   • variable-pay contributor set (variableContributors)
      // Suppression is decided over the COUNTS (before any FX) so a sub-floor population never triggers a live
      // rate fetch — preserving the early skip-FX path. When suppressed, totals stay null (no FX). The pure
      // buildTotalCompBreakdown kernel (@tims/shared, golden both stacks) re-derives the same trigger over the
      // counts and owns the base/variable split + percentages + roundMoney(total). employeeCount = baseContributors
      // (aligned to getDashboardKpis.compensatedEmployees so the denominators cannot be differenced).
      const nonPositiveContributors = compensations.length - baseContributors;
      const suppressed =
        suppressBelowMin5(compensations.length).suppressed ||
        suppressBelowMin5(baseContributors).suppressed ||
        suppressBelowMin5(variableContributors).suppressed ||
        suppressBelowMin5(nonPositiveContributors).suppressed;

      const totals = suppressed
        ? null
        : await (async () => {
            const [baseTotal, variableTotal] = await Promise.all([
              sumMoney(
                compensations
                  .map((emp) => ({ amount: Number(emp.currentSalary) || 0, currency: emp.currency }))
                  .filter((emp) => emp.amount > 0),
                displayCurrency,
              ),
              sumMoney(
                compensations
                  .map((emp) => ({ amount: Number(emp.variablePay) || 0, currency: emp.currency }))
                  .filter((emp) => emp.amount > 0),
                displayCurrency,
              ),
            ]);
            return {
              baseAmount: baseTotal.amount,
              variableAmount: variableTotal.amount,
              converted: baseTotal.converted || variableTotal.converted,
              ratesAsOf: [baseTotal.ratesAsOf, variableTotal.ratesAsOf].filter(Boolean).sort()[0] ?? null,
            };
          })();

      return buildTotalCompBreakdown({
        rowCount: compensations.length,
        baseContributors,
        variableContributors,
        totals,
        displayCurrency,
      });
    }),

  // ── Employee Compensation Detail ───────────────────────────────────
  // Per-person read: caller must be authorized to view this employee's compensation.
  // Delegates to the shared service helper so the §21 field-auth (selectFor) and
  // FULL+AUDIT logging live in ONE place (this was also reused by compensation.myCompensation
  // until that procedure was deleted 2026-07-29 — the shared service helper itself is unchanged).
  getEmployeeComp: permissionProcedure('compensation', 'read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const dto = await getEmployeeCompForSubject(
        ctx.access,
        ctx.user.organizationId,
        ctx.user.id,
        input.userId,
        {
          actorId: ctx.user.impersonatorId ?? ctx.user.id,
          ipAddress: ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
          userAgent: ctx.headers.get('user-agent'),
        },
        'No puedes ver la compensacion de este usuario',
      );

      if (!dto) throw new Error('Compensacion no encontrada');
      return dto;
    }),

  // ── Dashboard KPIs ─────────────────────────────────────────────────
  // Org-scope gate only.
  //
  // min-5 floor (round 6, HIGH 3): totalMonthlyPayroll/avgSalary are a SUM/MEAN over
  // the compensated population, and compensatedEmployees IS that headcount — over 1..4
  // people they reconstruct individual salaries. avgCompaRatio is a MEAN over the
  // compaRatio population (a distinct, possibly smaller set). Fetch BOTH contributor
  // counts: when the compensated population is 1..4 null payroll/avgSalary/
  // compensatedEmployees; when the compaRatio population is <5 null avgCompaRatio.
  // Non-sensitive KPIs (activeEmployees org headcount, pendingAdjustments,
  // benefitsUtilizationPct) reveal no per-person salary and stay. Empty (0) populations
  // pass through as real zeros / null avg (reveal no individual).
  getDashboardKpis: permissionProcedure('compensation', 'read').query(async ({ ctx }) => {
    requireOrgScope(ctx.access);
    const orgId = ctx.user.organizationId;

    const [company, compensatedRows, compensatedCount, pendingAdjustments, compaRatioAgg, compaRatioCount, activeEmployees, benefitPlans] = await Promise.all([
      db.company.findFirst({
        where: { organizationId: orgId },
        select: { currency: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.employeeCompensation.findMany({
        where: { organizationId: orgId, currentSalary: { gt: 0 } },
        select: { currentSalary: true, currency: true },
      }),
      db.employeeCompensation.count({
        where: { organizationId: orgId, currentSalary: { gt: 0 } },
      }),
      db.salaryAdjustment.count({
        where: { organizationId: orgId, status: 'pending' },
      }),
      db.employeeCompensation.aggregate({
        where: { organizationId: orgId, compaRatio: { not: null } },
        _avg: { compaRatio: true },
      }),
      db.employeeCompensation.count({
        where: { organizationId: orgId, compaRatio: { not: null } },
      }),
      db.user.count({ where: { organizationId: orgId, isActive: true } }),
      db.benefitPlan.findMany({ where: { organizationId: orgId }, select: { _count: { select: { enrollments: true } } } }),
    ]);
    const displayCurrency = normalizeCurrencyCode(company?.currency, 'USD');

    // Suppress the compensated-population aggregates when that population is 1..4 → skip the payroll FX sum
    // entirely (no live rate fetch for a suppressed cohort); otherwise sum it. The pure buildCompDashboardKpis
    // kernel (@tims/shared, golden both stacks) owns benefitsUtilizationPct, the min-5 floors (compensated,
    // compaRatio incl. the 0-mean → null nit, pendingAdjustments), avgSalary, and the null-payroll fail-soft.
    const compensatedSuppressed = suppressBelowMin5(compensatedCount).suppressed;
    const payroll = compensatedSuppressed
      ? null
      : await sumMoney(
          compensatedRows.map((row) => ({ amount: Number(row.currentSalary) || 0, currency: row.currency })),
          displayCurrency,
        );

    return buildCompDashboardKpis({
      compensatedCount,
      compaRatioCount,
      pendingAdjustments,
      activeEmployees,
      benefitEnrollmentCounts: benefitPlans.map((p) => p._count.enrollments),
      compaRatioAvg: compaRatioAgg._avg.compaRatio == null ? null : Number(compaRatioAgg._avg.compaRatio),
      payroll: payroll ? { amount: payroll.amount, converted: payroll.converted, ratesAsOf: payroll.ratesAsOf } : null,
      displayCurrency,
    });
  }),
});
