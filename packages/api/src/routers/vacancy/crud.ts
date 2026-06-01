import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

const salarySchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  currency: z.string().default('COP'),
  period: z.enum(['monthly', 'yearly']).default('monthly'),
}).optional();

const createVacancyInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  companyId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  positions: z.number().int().min(1).default(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  salary: salarySchema,
  contractType: z.string().optional(),
  location: z.string().optional(),
  remotePolicy: z.enum(['onsite', 'remote', 'hybrid']).optional(),
  assignedTo: z.string().uuid().optional(),
  settings: z.record(z.unknown()).optional(),
});

const updateVacancyInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  companyId: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  positions: z.number().int().min(1).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  salary: salarySchema,
  contractType: z.string().nullish(),
  location: z.string().nullish(),
  remotePolicy: z.enum(['onsite', 'remote', 'hybrid']).nullish(),
  assignedTo: z.string().uuid().nullish(),
  settings: z.record(z.unknown()).optional(),
});

const paginationInput = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

// ---------------------------------------------------------------------------
// CRUD sub-router
// ---------------------------------------------------------------------------

export const vacancyCrudRouter = router({
  // 4.1 — List vacancies with cursor pagination and filters
  list: permissionProcedure('vacancy', 'read')
    .input(
      paginationInput.extend({
        status: z.enum(['draft', 'pending_approval', 'approved', 'published', 'closed', 'frozen']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
        assignedTo: z.string().uuid().optional(),
        search: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, status, priority, companyId, businessUnitId, teamId, assignedTo, search } = input;

      const where: any = {
        organizationId: ctx.user.organizationId,
        deletedAt: null,
        ...(status && { status }),
        ...(priority && { priority }),
        ...(companyId && { companyId }),
        ...(businessUnitId && { businessUnitId }),
        ...(teamId && { teamId }),
        ...(assignedTo && { assignedTo }),
        ...(search && { title: { contains: search, mode: 'insensitive' as const } }),
      };

      const items = await db.vacancy.findMany({
        where,
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          _count: { select: { applications: true } },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const next = items.pop()!;
        nextCursor = next.id;
      }

      return { items, nextCursor };
    }),

  // 4.2 — Get vacancy by ID
  getById: permissionProcedure('vacancy', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.user.organizationId,
          deletedAt: null,
        },
        include: {
          company: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          jobProfile: true,
          channels: true,
          approvals: {
            orderBy: { step: 'asc' },
            include: { approver: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
          },
          stages: { orderBy: { order: 'asc' } },
          _count: { select: { applications: true } },
        },
      });

      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return vacancy;
    }),

  // 4.3 — Create vacancy
  create: permissionProcedure('vacancy', 'create')
    .input(createVacancyInput)
    .mutation(async ({ ctx, input }) => {
      return db.vacancy.create({
        data: {
          ...input,
          salary: (input.salary ?? undefined) as any,
          settings: (input.settings ?? {}) as any,
          organizationId: ctx.user.organizationId,
          createdBy: ctx.user.id,
        },
      });
    }),

  // 4.4 — Update vacancy
  update: permissionProcedure('vacancy', 'update')
    .input(updateVacancyInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const vacancy = await db.vacancy.findFirst({
        where: { id, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.vacancy.update({
        where: { id },
        data: {
          ...data,
          salary: (data.salary ?? undefined) as any,
          settings: (data.settings ?? undefined) as any,
        },
      });
    }),

  // 4.5 — Close vacancy
  close: permissionProcedure('vacancy', 'update')
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.vacancy.update({
        where: { id: input.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedReason: input.reason,
        },
      });
    }),

  // 4.6 — Freeze vacancy
  freeze: permissionProcedure('vacancy', 'update')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.vacancy.update({
        where: { id: input.id },
        data: { status: 'frozen' },
      });
    }),

  // 4.7 — Duplicate vacancy
  duplicate: permissionProcedure('vacancy', 'create')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const original = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, deletedAt: null },
        include: { jobProfile: true, stages: { orderBy: { order: 'asc' } } },
      });
      if (!original) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      const { id: _id, createdAt: _ca, updatedAt: _ua, deletedAt: _da, closedAt: _cla, closedReason: _clr, jobProfile: _jp, stages: _stg, ...rest } = original;

      return db.$transaction(async (tx) => {
        const newVacancy = await tx.vacancy.create({
          data: {
            ...rest,
            title: `${rest.title} (copia)`,
            status: 'draft',
            createdBy: ctx.user.id,
            settings: rest.settings as any,
            salary: (rest.salary as any) ?? undefined,
          },
        });

        // Duplicate job profile
        if (original.jobProfile) {
          const { id: _jpId, vacancyId: _vId, createdAt: _jpCa, updatedAt: _jpUa, ...jpRest } = original.jobProfile;
          await tx.jobProfile.create({
            data: {
              ...jpRest,
              vacancyId: newVacancy.id,
              discTargets: jpRest.discTargets as any,
              competencies: jpRest.competencies as any,
              pcaExpected: jpRest.pcaExpected as any ?? undefined,
              milExpected: jpRest.milExpected as any ?? undefined,
              kpis: jpRest.kpis as any ?? undefined,
              requirements: jpRest.requirements as any ?? undefined,
            },
          });
        }

        // Duplicate pipeline stages
        if (original.stages.length > 0) {
          await tx.pipelineStage.createMany({
            data: original.stages.map((s) => ({
              organizationId: newVacancy.organizationId,
              vacancyId: newVacancy.id,
              name: s.name,
              order: s.order,
              slaHours: s.slaHours,
              checklist: s.checklist as any ?? undefined,
              isDefault: s.isDefault,
            })),
          });
        }

        return newVacancy;
      });
    }),
});
