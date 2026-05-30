import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';
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
  listCompanies: protectedProcedure.query(async ({ ctx }) => {
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
  listBusinessUnits: protectedProcedure
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
  listTeams: protectedProcedure
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
});
