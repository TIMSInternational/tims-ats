import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped } from '../access';
import { buildBalanceScore, buildTeamComparison } from '@tims/shared';

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
});
