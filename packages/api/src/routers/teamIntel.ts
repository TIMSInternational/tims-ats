import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';

export const teamIntelRouter = router({
  // ── Team Profile ─────────────────────────────────────────────────────

  getTeamProfile: permissionProcedure('team_intel', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
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
      // Verify the team belongs to the org
      await db.team.findFirstOrThrow({
        where: { id: input.teamId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });

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
      // Verify org ownership
      await db.team.findFirstOrThrow({
        where: { id: input.teamId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });

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

  // Stub: AI-driven balance alerts
  getBalanceAlerts: permissionProcedure('team_intel', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // TODO: integrate with AI analysis engine
      return {
        teamId: input.teamId,
        organizationId: ctx.user.organizationId,
        alerts: [
          {
            type: 'skill_gap',
            severity: 'medium',
            message: 'El equipo carece de experiencia en analisis de datos',
            recommendation: 'Considerar capacitacion o contratacion en esta area',
          },
          {
            type: 'tenure_imbalance',
            severity: 'low',
            message: 'Alta concentracion de miembros con menos de 6 meses',
            recommendation: 'Asignar mentores para acelerar integracion',
          },
        ],
        generatedAt: new Date(),
        _stub: true,
      };
    }),

  // Stub: AI-driven hiring recommendations
  getRecommendedHires: permissionProcedure('team_intel', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // TODO: integrate with AI recommendation engine
      return {
        teamId: input.teamId,
        organizationId: ctx.user.organizationId,
        recommendations: [
          {
            role: 'Analista de Datos Senior',
            priority: 'high',
            reason: 'Brecha critica en competencias de datos',
            idealProfile: {
              experience: '3-5 anos',
              skills: ['SQL', 'Python', 'Visualizacion'],
            },
          },
          {
            role: 'Disenador UX',
            priority: 'medium',
            reason: 'Mejorar capacidad de diseno centrado en el usuario',
            idealProfile: {
              experience: '2-4 anos',
              skills: ['Figma', 'Investigacion de usuarios', 'Prototipado'],
            },
          },
        ],
        generatedAt: new Date(),
        _stub: true,
      };
    }),

  // ── Compare Teams ────────────────────────────────────────────────────

  compareTeams: permissionProcedure('team_intel', 'read')
    .input(
      z.object({
        teamIds: z.array(z.string().uuid()).min(2).max(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const teams = await db.team.findMany({
        where: {
          id: { in: input.teamIds },
          organizationId: ctx.user.organizationId,
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
      const orgId = ctx.user.organizationId;

      const [totalTeams, totalMembers, teamsWithLeader] = await Promise.all([
        db.team.count({ where: { organizationId: orgId, isActive: true } }),
        db.userTeam.count({
          where: { team: { organizationId: orgId, isActive: true } },
        }),
        db.team.count({
          where: { organizationId: orgId, isActive: true, leaderId: { not: null } },
        }),
      ]);

      const avgTeamSize = totalTeams > 0 ? Math.round((totalMembers / totalTeams) * 10) / 10 : 0;

      return {
        totalTeams,
        totalMembers,
        teamsWithLeader,
        teamsWithoutLeader: totalTeams - teamsWithLeader,
        avgTeamSize,
      };
    }),
});
