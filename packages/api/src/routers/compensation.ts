import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';

export const compensationRouter = router({
  // ── Salary Bands ───────────────────────────────────────────────────
  getSalaryBands: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      return db.salaryBand.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        orderBy: [{ level: 'asc' }],
      });
    }),

  // ── Band Distribution (employees plotted within their band) ────────
  getBandDistribution: permissionProcedure('compensation', 'read').query(async ({ ctx }) => {
    const comps = await db.employeeCompensation.findMany({
      where: { organizationId: ctx.user.organizationId, bandId: { not: null } },
      select: { currentSalary: true, band: { select: { id: true, level: true, title: true, minSalary: true, midSalary: true, maxSalary: true } } },
    });

    const byBand = new Map<string, { level: string; title: string; min: number; mid: number; max: number; dots: { pos: number; outlier: boolean }[] }>();
    for (const c of comps) {
      if (!c.band) continue;
      const min = Number(c.band.minSalary);
      const max = Number(c.band.maxSalary);
      const salary = Number(c.currentSalary);
      if (!byBand.has(c.band.id)) {
        byBand.set(c.band.id, { level: c.band.level ?? '', title: c.band.title ?? '', min, mid: Number(c.band.midSalary), max, dots: [] });
      }
      const span = max - min;
      const rawPos = span > 0 ? ((salary - min) / span) * 100 : 50;
      byBand.get(c.band.id)!.dots.push({ pos: Math.min(100, Math.max(0, rawPos)), outlier: rawPos < 0 || rawPos > 100 });
    }

    return [...byBand.values()].sort((a, b) => b.mid - a.mid);
  }),

  // ── Compa-Ratio Distribution ───────────────────────────────────────
  getCompaRatioDistribution: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const compensations = await db.employeeCompensation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        select: {
          id: true,
          currentSalary: true,
          compaRatio: true,
          userId: true,
        },
      });

      const buckets: Record<string, number> = {
        '<0.80': 0,
        '0.80-0.90': 0,
        '0.90-1.00': 0,
        '1.00-1.10': 0,
        '1.10-1.20': 0,
        '>1.20': 0,
      };

      for (const emp of compensations) {
        const cr = Number(emp.compaRatio) || 0;
        if (cr < 0.8) buckets['<0.80']++;
        else if (cr < 0.9) buckets['0.80-0.90']++;
        else if (cr < 1.0) buckets['0.90-1.00']++;
        else if (cr < 1.1) buckets['1.00-1.10']++;
        else if (cr < 1.2) buckets['1.10-1.20']++;
        else buckets['>1.20']++;
      }

      const ratios = compensations.map((e) => Number(e.compaRatio) || 0).filter(Boolean);
      const avgCompaRatio = ratios.length
        ? Math.round((ratios.reduce((a: number, b: number) => a + b, 0) / ratios.length) * 100) / 100
        : 0;

      return { distribution: buckets, avgCompaRatio, totalEmployees: compensations.length };
    }),

  // ── Pay Equity ─────────────────────────────────────────────────────
  getPayEquity: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        groupBy: z.enum(['gender', 'ethnicity']).default('gender'),
        jobLevel: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx }) => {
      const compensations = await db.employeeCompensation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        select: { currentSalary: true, userId: true },
      });

      // Without an Employee model with gender/ethnicity, return raw salary data
      const salaries = compensations.map((c) => Number(c.currentSalary)).filter(Boolean);
      const avg = salaries.length ? salaries.reduce((a, b) => a + b, 0) / salaries.length : 0;
      const sorted = [...salaries].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

      return {
        groupBy: 'all',
        results: [{ group: 'all', count: salaries.length, averageSalary: Math.round(avg), medianSalary: median }],
      };
    }),

  // ── Benefits Utilization ───────────────────────────────────────────
  getBenefitsUtilization: permissionProcedure('compensation', 'read')
    .input(
      z.object({ companyId: z.string().uuid().optional() }).optional(),
    )
    .query(async ({ ctx }) => {
      const benefits = await db.benefitPlan.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        include: {
          _count: { select: { enrollments: true } },
        },
        orderBy: { name: 'asc' },
      });

      const totalUsers = await db.user.count({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
        },
      });

      return benefits.map((b) => ({
        id: b.id,
        name: b.name,
        category: b.type,
        enrolled: b._count.enrollments,
        utilization: totalUsers
          ? Math.round((b._count.enrollments / totalUsers) * 10000) / 100
          : 0,
      }));
    }),

  // ── Adjustments ────────────────────────────────────────────────────
  listPendingAdjustments: permissionProcedure('compensation', 'read').query(async ({ ctx }) => {
    return db.salaryAdjustment.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        status: 'pending',
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
        requester: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  createAdjustment: permissionProcedure('compensation', 'create')
    .input(
      z.object({
        userId: z.string().uuid(),
        type: z.enum(['merit', 'promotion', 'market', 'equity', 'other']),
        previousSalary: z.number().positive(),
        newSalary: z.number().positive(),
        reason: z.string().max(1000).optional(),
        effectiveDate: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.salaryAdjustment.create({
        data: {
          userId: input.userId,
          type: input.type,
          previousSalary: input.previousSalary,
          newSalary: input.newSalary,
          reason: input.reason,
          effectiveDate: new Date(input.effectiveDate),
          organizationId: ctx.user.organizationId,
          requestedById: ctx.user.id,
          status: 'pending',
        },
      });
    }),

  approveAdjustment: permissionProcedure('compensation', 'approve')
    .input(
      z.object({
        id: z.string().uuid(),
        approved: z.boolean(),
        comment: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const adjustment = await db.salaryAdjustment.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, status: 'pending' },
      });

      if (!adjustment) throw new Error('Ajuste no encontrado o ya procesado');

      const updated = await db.salaryAdjustment.update({
        where: { id: input.id },
        data: {
          status: input.approved ? 'approved' : 'rejected',
          approvedById: ctx.user.id,
        },
      });

      // If approved, update employee compensation
      if (input.approved) {
        await db.employeeCompensation.updateMany({
          where: { userId: adjustment.userId, organizationId: ctx.user.organizationId },
          data: { currentSalary: adjustment.newSalary },
        });
      }

      return updated;
    }),

  simulateAdjustment: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        userId: z.string().uuid(),
        proposedSalary: z.number().positive(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const compensation = await db.employeeCompensation.findFirst({
        where: { userId: input.userId, organizationId: ctx.user.organizationId },
        select: { currentSalary: true, compaRatio: true, bandId: true },
      });

      if (!compensation) throw new Error('Compensacion no encontrada');

      const currentSalary = Number(compensation.currentSalary) || 0;
      const percentageChange = currentSalary
        ? Math.round(((input.proposedSalary - currentSalary) / currentSalary) * 10000) / 100
        : 0;

      // Find salary band for new compa-ratio
      const band = compensation.bandId
        ? await db.salaryBand.findUnique({ where: { id: compensation.bandId } })
        : null;

      const midpoint = band ? Number(band.midSalary) : 0;
      const newCompaRatio = midpoint ? Math.round((input.proposedSalary / midpoint) * 100) / 100 : null;

      return {
        currentSalary,
        proposedSalary: input.proposedSalary,
        percentageChange,
        currentCompaRatio: Number(compensation.compaRatio) || null,
        newCompaRatio,
        bandMin: band ? Number(band.minSalary) : null,
        bandMax: band ? Number(band.maxSalary) : null,
        withinBand: band
          ? input.proposedSalary >= Number(band.minSalary) && input.proposedSalary <= Number(band.maxSalary)
          : null,
      };
    }),

  // ── Market Comparison ──────────────────────────────────────────────
  getMarketComparison: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        jobLevel: z.string().optional(),
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
      }));
    }),

  // ── Total Comp Breakdown ───────────────────────────────────────────
  getTotalCompBreakdown: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx }) => {
      const compensations = await db.employeeCompensation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
        },
        select: {
          currentSalary: true,
          variablePay: true,
        },
      });

      let totalBase = 0;
      let totalVariable = 0;

      for (const emp of compensations) {
        totalBase += Number(emp.currentSalary) || 0;
        totalVariable += Number(emp.variablePay) || 0;
      }

      const totalComp = totalBase + totalVariable;

      return {
        totalComp,
        breakdown: {
          baseSalary: { total: totalBase, percentage: totalComp ? Math.round((totalBase / totalComp) * 10000) / 100 : 0 },
          variablePay: { total: totalVariable, percentage: totalComp ? Math.round((totalVariable / totalComp) * 10000) / 100 : 0 },
        },
        employeeCount: compensations.length,
      };
    }),

  // ── Employee Compensation Detail ───────────────────────────────────
  getEmployeeComp: permissionProcedure('compensation', 'read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const compensation = await db.employeeCompensation.findFirst({
        where: { userId: input.userId, organizationId: ctx.user.organizationId },
        include: {
          band: true,
        },
      });

      if (!compensation) throw new Error('Compensacion no encontrada');

      return {
        userId: compensation.userId,
        currentSalary: Number(compensation.currentSalary),
        variablePay: Number(compensation.variablePay) || 0,
        compaRatio: Number(compensation.compaRatio) || null,
        band: compensation.band ? {
          level: compensation.band.level,
          title: compensation.band.title,
          min: Number(compensation.band.minSalary),
          mid: Number(compensation.band.midSalary),
          max: Number(compensation.band.maxSalary),
        } : null,
      };
    }),

  // ── Dashboard KPIs ─────────────────────────────────────────────────
  getDashboardKpis: permissionProcedure('compensation', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [payrollAgg, pendingAdjustments, avgCompaRatio, activeEmployees, benefitPlans] = await Promise.all([
      db.employeeCompensation.aggregate({
        where: { organizationId: orgId },
        _sum: { currentSalary: true },
        _avg: { currentSalary: true },
        _count: { _all: true },
      }),
      db.salaryAdjustment.count({
        where: { organizationId: orgId, status: 'pending' },
      }),
      db.employeeCompensation.aggregate({
        where: { organizationId: orgId, compaRatio: { not: null } },
        _avg: { compaRatio: true },
      }),
      db.user.count({ where: { organizationId: orgId, isActive: true } }),
      db.benefitPlan.findMany({ where: { organizationId: orgId }, select: { _count: { select: { enrollments: true } } } }),
    ]);

    // Average benefit utilization = mean over plans of (enrollments / active employees).
    const benefitsUtilizationPct =
      benefitPlans.length && activeEmployees
        ? Math.round(
            (benefitPlans.reduce((sum, p) => sum + p._count.enrollments / activeEmployees, 0) / benefitPlans.length) * 1000,
          ) / 10
        : 0;

    return {
      totalMonthlyPayroll: Number(payrollAgg._sum.currentSalary) || 0,
      avgSalary: Math.round(Number(payrollAgg._avg.currentSalary) || 0),
      compensatedEmployees: payrollAgg._count._all,
      activeEmployees,
      pendingAdjustments,
      benefitsUtilizationPct,
      avgCompaRatio: avgCompaRatio._avg.compaRatio
        ? Math.round(Number(avgCompaRatio._avg.compaRatio) * 100) / 100
        : null,
    };
  }),
});
