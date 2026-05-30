import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

export const compensationRouter = router({
  // ── Salary Bands ───────────────────────────────────────────────────
  getSalaryBands: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
        jobFamily: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      return db.salaryBand.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
          ...(input?.jobFamily ? { jobFamily: input.jobFamily } : {}),
        },
        orderBy: [{ jobFamily: 'asc' }, { level: 'asc' }],
      });
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
      const employees = await db.employee.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
          ...(input?.businessUnitId ? { businessUnitId: input.businessUnitId } : {}),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          baseSalary: true,
          compaRatio: true,
          jobLevel: true,
          jobTitle: true,
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

      for (const emp of employees) {
        const cr = Number(emp.compaRatio) || 0;
        if (cr < 0.8) buckets['<0.80']++;
        else if (cr < 0.9) buckets['0.80-0.90']++;
        else if (cr < 1.0) buckets['0.90-1.00']++;
        else if (cr < 1.1) buckets['1.00-1.10']++;
        else if (cr < 1.2) buckets['1.10-1.20']++;
        else buckets['>1.20']++;
      }

      const ratios = employees.map((e: any) => Number(e.compaRatio) || 0).filter(Boolean);
      const avgCompaRatio = ratios.length
        ? Math.round((ratios.reduce((a: number, b: number) => a + b, 0) / ratios.length) * 100) / 100
        : 0;

      return { distribution: buckets, avgCompaRatio, totalEmployees: employees.length };
    }),

  // ── Pay Equity ─────────────────────────────────────────────────────
  getPayEquity: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        groupBy: z.enum(['gender', 'ethnicity']).default('gender'),
        jobLevel: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const { groupBy = 'gender', jobLevel } = input ?? {};

      const employees = await db.employee.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(jobLevel ? { jobLevel } : {}),
        },
        select: { gender: true, ethnicity: true, baseSalary: true, jobLevel: true },
      });

      const groups: Record<string, number[]> = {};
      for (const emp of employees) {
        const key = groupBy === 'gender' ? (emp.gender ?? 'unknown') : ((emp as any).ethnicity ?? 'unknown');
        if (!groups[key]) groups[key] = [];
        if (emp.baseSalary) groups[key].push(Number(emp.baseSalary));
      }

      const results = Object.entries(groups).map(([group, salaries]) => {
        const avg = salaries.reduce((a, b) => a + b, 0) / salaries.length;
        const sorted = [...salaries].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        return { group, count: salaries.length, averageSalary: Math.round(avg), medianSalary: median };
      });

      return { groupBy, results };
    }),

  // ── Benefits Utilization ───────────────────────────────────────────
  getBenefitsUtilization: permissionProcedure('compensation', 'read')
    .input(
      z.object({ companyId: z.string().uuid().optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const benefits = await db.benefit.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
        },
        include: {
          _count: { select: { enrollments: true } },
        },
        orderBy: { name: 'asc' },
      });

      const totalEmployees = await db.employee.count({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
        },
      });

      return benefits.map((b: any) => ({
        id: b.id,
        name: b.name,
        category: b.category,
        enrolled: b._count.enrollments,
        utilization: totalEmployees
          ? Math.round((b._count.enrollments / totalEmployees) * 10000) / 100
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
        employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true, baseSalary: true } },
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  createAdjustment: permissionProcedure('compensation', 'create')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        type: z.enum(['merit', 'promotion', 'market', 'equity', 'other']),
        currentSalary: z.number().positive(),
        proposedSalary: z.number().positive(),
        reason: z.string().max(1000).optional(),
        effectiveDate: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.salaryAdjustment.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          requestedById: ctx.user.id,
          status: 'pending',
          percentageChange: Math.round(((input.proposedSalary - input.currentSalary) / input.currentSalary) * 10000) / 100,
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
          approvedAt: new Date(),
          approvalComment: input.comment,
        },
      });

      // If approved, update employee salary
      if (input.approved) {
        await db.employee.update({
          where: { id: adjustment.employeeId },
          data: { baseSalary: adjustment.proposedSalary },
        });
      }

      return updated;
    }),

  simulateAdjustment: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        proposedSalary: z.number().positive(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const employee = await db.employee.findFirst({
        where: { id: input.employeeId, organizationId: ctx.user.organizationId },
        select: { baseSalary: true, jobLevel: true, jobFamily: true, compaRatio: true },
      });

      if (!employee) throw new Error('Empleado no encontrado');

      const currentSalary = Number(employee.baseSalary) || 0;
      const percentageChange = currentSalary
        ? Math.round(((input.proposedSalary - currentSalary) / currentSalary) * 10000) / 100
        : 0;

      // Find salary band for new compa-ratio
      const band = await db.salaryBand.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          jobFamily: (employee as any).jobFamily,
          level: employee.jobLevel,
        },
      });

      const midpoint = band ? Number((band as any).midpoint) : 0;
      const newCompaRatio = midpoint ? Math.round((input.proposedSalary / midpoint) * 100) / 100 : null;

      return {
        currentSalary,
        proposedSalary: input.proposedSalary,
        percentageChange,
        currentCompaRatio: Number(employee.compaRatio) || null,
        newCompaRatio,
        bandMin: band ? Number((band as any).min) : null,
        bandMax: band ? Number((band as any).max) : null,
        withinBand: band
          ? input.proposedSalary >= Number((band as any).min) && input.proposedSalary <= Number((band as any).max)
          : null,
      };
    }),

  // ── Market Comparison ──────────────────────────────────────────────
  getMarketComparison: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        jobFamily: z.string().optional(),
        jobLevel: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const bands = await db.salaryBand.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.jobFamily ? { jobFamily: input.jobFamily } : {}),
          ...(input?.jobLevel ? { level: input.jobLevel } : {}),
        },
        orderBy: [{ jobFamily: 'asc' }, { level: 'asc' }],
      });

      return bands.map((b: any) => ({
        jobFamily: b.jobFamily,
        level: b.level,
        internalMin: Number(b.min),
        internalMid: Number(b.midpoint),
        internalMax: Number(b.max),
        marketP25: Number(b.marketP25) || null,
        marketP50: Number(b.marketP50) || null,
        marketP75: Number(b.marketP75) || null,
      }));
    }),

  // ── Total Comp Breakdown ───────────────────────────────────────────
  getTotalCompBreakdown: permissionProcedure('compensation', 'read')
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const employees = await db.employee.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          ...(input?.companyId ? { companyId: input.companyId } : {}),
        },
        select: {
          baseSalary: true,
          variablePay: true,
          benefitsCost: true,
        },
      });

      let totalBase = 0;
      let totalVariable = 0;
      let totalBenefits = 0;

      for (const emp of employees) {
        totalBase += Number(emp.baseSalary) || 0;
        totalVariable += Number((emp as any).variablePay) || 0;
        totalBenefits += Number((emp as any).benefitsCost) || 0;
      }

      const totalComp = totalBase + totalVariable + totalBenefits;

      return {
        totalComp,
        breakdown: {
          baseSalary: { total: totalBase, percentage: totalComp ? Math.round((totalBase / totalComp) * 10000) / 100 : 0 },
          variablePay: { total: totalVariable, percentage: totalComp ? Math.round((totalVariable / totalComp) * 10000) / 100 : 0 },
          benefits: { total: totalBenefits, percentage: totalComp ? Math.round((totalBenefits / totalComp) * 10000) / 100 : 0 },
        },
        employeeCount: employees.length,
      };
    }),

  // ── Employee Compensation Detail ───────────────────────────────────
  getEmployeeComp: permissionProcedure('compensation', 'read')
    .input(z.object({ employeeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const employee = await db.employee.findFirst({
        where: { id: input.employeeId, organizationId: ctx.user.organizationId },
        include: {
          benefitEnrollments: {
            include: { benefit: true },
            where: { isActive: true },
          },
          salaryHistory: {
            orderBy: { effectiveDate: 'desc' },
            take: 10,
          },
        },
      });

      if (!employee) throw new Error('Empleado no encontrado');

      return {
        employeeId: employee.id,
        baseSalary: Number(employee.baseSalary),
        variablePay: Number((employee as any).variablePay) || 0,
        compaRatio: Number(employee.compaRatio) || null,
        benefits: (employee as any).benefitEnrollments?.map((e: any) => ({
          name: e.benefit.name,
          category: e.benefit.category,
          employerCost: Number(e.benefit.employerCost) || 0,
        })) ?? [],
        salaryHistory: (employee as any).salaryHistory?.map((h: any) => ({
          effectiveDate: h.effectiveDate,
          salary: Number(h.salary),
          type: h.type,
        })) ?? [],
      };
    }),

  // ── Dashboard KPIs ─────────────────────────────────────────────────
  getDashboardKpis: permissionProcedure('compensation', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [totalPayroll, pendingAdjustments, avgCompaRatio] = await Promise.all([
      db.employee.aggregate({
        where: { organizationId: orgId, isActive: true },
        _sum: { baseSalary: true },
      }),
      db.salaryAdjustment.count({
        where: { organizationId: orgId, status: 'pending' },
      }),
      db.employee.aggregate({
        where: { organizationId: orgId, isActive: true, compaRatio: { not: null } },
        _avg: { compaRatio: true },
      }),
    ]);

    return {
      totalMonthlyPayroll: Number(totalPayroll._sum.baseSalary) || 0,
      pendingAdjustments,
      avgCompaRatio: avgCompaRatio._avg.compaRatio
        ? Math.round(Number(avgCompaRatio._avg.compaRatio) * 100) / 100
        : null,
    };
  }),
});
