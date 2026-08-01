import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { assertSubjectInScope, requireOrgScope, logDataAccess, selectFor } from '../access';
import { getEmployeeCompForSubject } from '../services/compensation.service';
import { convertMoney } from '../lib/currency';
import { normalizeCurrencyCode, buildCompPayEquity, buildSimulateAdjustment } from '@tims/shared';

export const compensationRouter = router({
  // ── Pay Equity ─────────────────────────────────────────────────────
  // Org-scope gated; min-5 suppression applied to group counts/averages below
  // (defense-in-depth on top of requireOrgScope, NOT a replacement — the gate stays).
  getPayEquity: permissionProcedure('compensation', 'read')
    .input(
      z
        .object({
          groupBy: z.enum(['gender', 'ethnicity']).default('gender'),
          jobLevel: z.string().max(100).optional(),
        })
        .optional(),
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
        currency: z
          .string()
          .trim()
          .length(3)
          .transform((v) => v.toUpperCase())
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Per-person read: caller must be authorized to view this employee's compensation.
      await assertSubjectInScope(ctx.access, ctx.user.id, input.userId, 'No puedes simular ajustes para este usuario');

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
      const compRec = compensation as {
        currentSalary?: unknown;
        currency?: string | null;
        compaRatio?: unknown;
        bandId?: string | null;
      };
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
      const bandId = canSeeCompaRatio ? (compRec.bandId ?? null) : null;
      const band = canSeeCompaRatio && bandId ? await db.salaryBand.findUnique({ where: { id: bandId } }) : null;

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
                ? {
                    min: Number(band.minSalary),
                    mid: Number(band.midSalary),
                    max: Number(band.maxSalary),
                    bandCurrency,
                  }
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
      z
        .object({
          jobLevel: z.string().max(100).optional(),
        })
        .optional(),
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
});
