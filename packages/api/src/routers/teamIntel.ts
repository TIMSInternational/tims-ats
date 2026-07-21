import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, requireOrgScope } from '../access';
import { computeAvgTenureYears, computeRoleDiversity } from './team-intel-metrics';
import { buildBalanceScore, buildTeamComparison } from '@tims/shared';
import { cacheGet, cacheSet } from '../lib/cache';

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

      // Balance-score shaping lives in the shared kernel (the SINGLE source the C# port mirrors,
      // golden-fixtured both stacks); the router wraps it with the teamId.
      const balance = buildBalanceScore(
        members.map((m) => ({ jobTitle: m.user.jobTitle, createdAt: m.user.createdAt })),
        Date.now(),
      );

      return { teamId: input.teamId, ...balance };
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

      // Comparison shaping lives in the shared kernel (the SINGLE source the C# port mirrors,
      // golden-fixtured both stacks).
      return buildTeamComparison(
        teams.map((team) => ({
          id: team.id,
          name: team.name,
          leader: team.leader,
          members: team.members.map((m) => ({ jobTitle: m.user.jobTitle, createdAt: m.user.createdAt })),
          openVacancies: team._count.vacancies,
          activeOkrs: team._count.okrs,
        })),
        Date.now(),
      );
    }),

  // ── Dashboard KPIs ───────────────────────────────────────────────────

  getDashboardKpis: permissionProcedure('team_intel', 'read')
    .query(async ({ ctx }) => {
      // Org-rollup dashboard aggregate → interim org-gate (slice-6 follow-up).
      requireOrgScope(ctx.access);

      const orgId = ctx.user.organizationId;

      type KpiResult = {
        totalTeams: number;
        totalMembers: number;
        teamsWithLeader: number;
        teamsWithoutLeader: number;
        avgTeamSize: number;
        avgTenureYears: number;
        diversityIndex: number;
      };

      // Safe to key on orgId alone: requireOrgScope() above gates this to org/company
      // callers only (no sub-org scope reaches here), so all callers see the identical
      // org rollup. If scope-aware aggregation is ever added, the key MUST include scope
      // identity (see vacancy/stats.ts).
      const cacheKey = `tims:kpis:teamintel:${orgId}`;
      const cached = await cacheGet<KpiResult>(cacheKey);
      if (cached) return cached;

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

      const result: KpiResult = {
        totalTeams,
        totalMembers,
        teamsWithLeader,
        teamsWithoutLeader: totalTeams - teamsWithLeader,
        avgTeamSize,
        avgTenureYears: computeAvgTenureYears(members, Date.now()),
        diversityIndex: computeRoleDiversity(members),
      };
      await cacheSet(cacheKey, result, 45);
      return result;
    }),
});
