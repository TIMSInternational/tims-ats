import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, requireOrgScope } from '../access';
import { computeAvgTenureYears, computeRoleDiversity } from './team-intel-metrics';

export const teamIntelRouter = router({
  // ── Team Profile ─────────────────────────────────────────────────────

  getTeamProfile: permissionProcedure('team_intel', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Team-scope probe: narrow scopes (leader/hrbp) may only read teams they
      // lead / teams in their assigned units (NOT_FOUND otherwise). Precedes
      // the org-check fetch below (which keeps the team fields the handler uses).
      await assertScoped('team', input.teamId, ctx.access, ctx.user.id, ctx.user.organizationId);
      const team = await db.team.findFirstOrThrow({
        where: { id: input.teamId, organizationId: ctx.user.organizationId },
        include: {
          leader: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              jobTitle: true,
              email: true,
            },
          },
          businessUnit: {
            select: { id: true, name: true, companyId: true },
          },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                  jobTitle: true,
                },
              },
            },
          },
          _count: { select: { vacancies: true, okrs: true } },
        },
      });

      return team;
    }),

  getMembers: permissionProcedure('team_intel', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Team-scope probe (replaces the prior org-only existence check).
      await assertScoped('team', input.teamId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const members = await db.userTeam.findMany({
        where: { teamId: input.teamId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              jobTitle: true,
              email: true,
              createdAt: true,
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      });

      return members;
    }),

  // ── Balance Score ────────────────────────────────────────────────────

  getBalanceScore: permissionProcedure('team_intel', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Team-scope probe (replaces the prior org-only existence check).
      await assertScoped('team', input.teamId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const members = await db.userTeam.findMany({
        where: { teamId: input.teamId },
        include: {
          user: {
            select: { id: true, jobTitle: true, createdAt: true },
          },
        },
      });

      const memberCount = members.length;

      // Tenure diversity (std deviation of tenure in months)
      const now = new Date();
      const tenureMonths = members.map(
        (m) => (now.getTime() - m.user.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30),
      );
      const avgTenure =
        tenureMonths.length > 0
          ? tenureMonths.reduce((a, b) => a + b, 0) / tenureMonths.length
          : 0;

      // Role diversity (unique job titles / member count)
      const uniqueRoles = new Set(members.map((m) => m.user.jobTitle).filter(Boolean)).size;
      const roleDiversity = memberCount > 0 ? Math.round((uniqueRoles / memberCount) * 100) : 0;

      // Simple balance score (0-100) based on size, tenure spread, role diversity
      const sizeScore = memberCount >= 3 && memberCount <= 10 ? 100 : Math.max(0, 100 - Math.abs(memberCount - 7) * 10);
      const balanceScore = Math.round((sizeScore + roleDiversity) / 2);

      return {
        teamId: input.teamId,
        memberCount,
        uniqueRoles,
        roleDiversity,
        avgTenureMonths: Math.round(avgTenure * 10) / 10,
        sizeScore,
        balanceScore,
      };
    }),

  // AI-driven team balance alerts.
  // NOT IMPLEMENTED: needs an analysis agent + Competency model (Wave 3/4).
  // Returns 501 rather than fabricated skill-gap/tenure alerts (rule #4).
  getBalanceAlerts: permissionProcedure('team_intel', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Scope-probe the team even though the body is a stub — the contract is
      // teamId-keyed, so the access check is wired now (no leak when implemented).
      await assertScoped('team', input.teamId, ctx.access, ctx.user.id, ctx.user.organizationId);
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Las alertas de balance con IA aun no estan disponibles (agente pendiente).',
      });
    }),

  // AI-driven hiring recommendations.
  // NOT IMPLEMENTED: needs a recommendation agent + Competency model (Wave 3/4).
  // Returns 501 rather than fabricated role recommendations (rule #4).
  getRecommendedHires: permissionProcedure('team_intel', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Scope-probe the team (teamId-keyed contract) ahead of the stub body.
      await assertScoped('team', input.teamId, ctx.access, ctx.user.id, ctx.user.organizationId);
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Las recomendaciones de contratacion con IA aun no estan disponibles (agente pendiente).',
      });
    }),

  // ── Compare Teams ────────────────────────────────────────────────────

  compareTeams: permissionProcedure('team_intel', 'read')
    .input(
      z.object({
        teamIds: z.array(z.string().uuid()).min(2).max(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Row-level multi-team read → compose the team scope fragment so narrow
      // scopes only compare teams within their grant (out-of-scope ids drop).
      const scopeWhere = (await scopeWhereFor('team', ctx.access, ctx.user.id)) as Prisma.TeamWhereInput;
      const teams = await db.team.findMany({
        where: {
          AND: [
            { id: { in: input.teamIds }, organizationId: ctx.user.organizationId },
            scopeWhere,
          ],
        },
        include: {
          leader: {
            select: { id: true, firstName: true, lastName: true },
          },
          members: {
            include: {
              user: {
                select: { id: true, jobTitle: true, createdAt: true },
              },
            },
          },
          _count: { select: { vacancies: true, okrs: true } },
        },
      });

      const now = new Date();

      const comparison = teams.map((team) => {
        const memberCount = team.members.length;
        const uniqueRoles = new Set(
          team.members.map((m) => m.user.jobTitle).filter(Boolean),
        ).size;
        const tenureMonths = team.members.map(
          (m) => (now.getTime() - m.user.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30),
        );
        const avgTenure =
          tenureMonths.length > 0
            ? tenureMonths.reduce((a, b) => a + b, 0) / tenureMonths.length
            : 0;

        return {
          teamId: team.id,
          teamName: team.name,
          leader: team.leader,
          memberCount,
          uniqueRoles,
          avgTenureMonths: Math.round(avgTenure * 10) / 10,
          openVacancies: team._count.vacancies,
          activeOkrs: team._count.okrs,
        };
      });

      return { teams: comparison };
    }),

  // ── Dashboard KPIs ───────────────────────────────────────────────────

  getDashboardKpis: permissionProcedure('team_intel', 'read')
    .query(async ({ ctx }) => {
      // Org-rollup dashboard aggregate → interim org-gate (slice-6 follow-up).
      requireOrgScope(ctx.access);

      const orgId = ctx.user.organizationId;

      // NOTE on populations: `totalMembers` (the "Team Size" KPI) counts userTeam
      // membership rows, whereas `members` (used for tenure + diversity below) is the
      // org's active headcount. Different sets by design — each KPI is labeled independently.
      const [totalTeams, totalMembers, teamsWithLeader, members] = await Promise.all([
        db.team.count({ where: { organizationId: orgId, isActive: true } }),
        db.userTeam.count({
          where: { team: { organizationId: orgId, isActive: true } },
        }),
        db.team.count({
          where: { organizationId: orgId, isActive: true, leaderId: { not: null } },
        }),
        db.user.findMany({
          where: { organizationId: orgId, isActive: true },
          select: { createdAt: true, jobTitle: true },
        }),
      ]);

      const avgTeamSize = totalTeams > 0 ? Math.round((totalMembers / totalTeams) * 10) / 10 : 0;

      return {
        totalTeams,
        totalMembers,
        teamsWithLeader,
        teamsWithoutLeader: totalTeams - teamsWithLeader,
        avgTeamSize,
        avgTenureYears: computeAvgTenureYears(members, Date.now()),
        diversityIndex: computeRoleDiversity(members),
      };
    }),
});
