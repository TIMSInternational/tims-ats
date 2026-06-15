import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  createCompanySchema,
  createBusinessUnitSchema,
  createTeamSchema,
} from '@tims/shared';

export const organizationRouter = router({
  // Get current organization
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    return db.organization.findUnique({
      where: { id: ctx.user.organizationId },
      include: {
        companies: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
        },
      },
    });
  }),

  // Update organization
  update: permissionProcedure('organization', 'update')
    .input(updateOrganizationSchema)
    .mutation(async ({ ctx, input }) => {
      return db.organization.update({
        where: { id: ctx.user.organizationId },
        data: input,
      });
    }),

  // Company CRUD
  listCompanies: permissionProcedure('organization', 'read').query(async ({ ctx }) => {
    return db.company.findMany({
      where: { organizationId: ctx.user.organizationId, isActive: true },
      include: { businessUnits: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    });
  }),

  createCompany: permissionProcedure('organization', 'create')
    .input(createCompanySchema)
    .mutation(async ({ ctx, input }) => {
      return db.company.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // Business Unit CRUD
  listBusinessUnits: permissionProcedure('organization', 'read')
    .input(z.object({ companyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.businessUnit.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          companyId: input.companyId,
          isActive: true,
        },
        include: { teams: { where: { isActive: true } } },
        orderBy: { name: 'asc' },
      });
    }),

  createBusinessUnit: permissionProcedure('organization', 'create')
    .input(createBusinessUnitSchema)
    .mutation(async ({ ctx, input }) => {
      return db.businessUnit.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // Team CRUD
  listTeams: permissionProcedure('organization', 'read')
    .input(z.object({ businessUnitId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.team.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          businessUnitId: input.businessUnitId,
          isActive: true,
        },
        include: {
          leader: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          members: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
      });
    }),

  createTeam: permissionProcedure('organization', 'create')
    .input(createTeamSchema)
    .mutation(async ({ ctx, input }) => {
      return db.team.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // ── hrbp ↔ business-unit assignment (Wave 2.5 slice 7a) ──────────────
  // Populates UserBusinessUnit, the anchor that unitIds()/unitMemberIds() read.
  // People-management act → user:create/delete (hr_admin holds user:* at org
  // scope; super_admin too). IDOR: both the unit and the target user are
  // org-verified before writing.
  listUnitMembers: permissionProcedure('user', 'read')
    .input(z.object({ businessUnitId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const unit = await db.businessUnit.findFirst({
        where: { id: input.businessUnitId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!unit) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unidad de negocio no encontrada' });
      return db.userBusinessUnit.findMany({
        where: { businessUnitId: input.businessUnitId, organizationId: ctx.user.organizationId },
        select: {
          id: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  assignUserToUnit: permissionProcedure('user', 'create')
    .input(z.object({ userId: z.string().uuid(), businessUnitId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await db.$transaction(async (tx) => {
          const [unit, user] = await Promise.all([
            tx.businessUnit.findFirst({
              where: { id: input.businessUnitId, organizationId: ctx.user.organizationId },
              select: { id: true },
            }),
            tx.user.findFirst({
              where: { id: input.userId, organizationId: ctx.user.organizationId },
              select: { id: true },
            }),
          ]);
          if (!unit) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unidad de negocio no encontrada' });
          if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
          return tx.userBusinessUnit.create({
            data: {
              organizationId: ctx.user.organizationId,
              userId: input.userId,
              businessUnitId: input.businessUnitId,
            },
            select: { id: true },
          });
        });
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'El usuario ya esta asignado a esta unidad' });
        }
        throw err;
      }
    }),

  unassignUserFromUnit: permissionProcedure('user', 'delete')
    .input(z.object({ userId: z.string().uuid(), businessUnitId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.userBusinessUnit.deleteMany({
        where: {
          organizationId: ctx.user.organizationId,
          userId: input.userId,
          businessUnitId: input.businessUnitId,
        },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      return { success: true };
    }),
});
