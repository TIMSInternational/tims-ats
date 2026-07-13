import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { scopeWhereFor, assertScoped, buildAccessForUser } from '../../access';

// ---------------------------------------------------------------------------
// Shared selects — explicit field selection (CLAUDE.md: never return full records)
// ---------------------------------------------------------------------------

const vacancyListSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  positions: true,
  location: true,
  remotePolicy: true,
  contractType: true,
  salary: true,
  createdAt: true,
  closedAt: true,
  company: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
  assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.VacancySelect;

const vacancyDetailSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  positions: true,
  location: true,
  remotePolicy: true,
  contractType: true,
  salary: true,
  settings: true,
  roleFamily: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  closedReason: true,
  organizationId: true,
  company: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  creator: { select: { id: true, firstName: true, lastName: true, avatar: true, email: true } },
  assignee: { select: { id: true, firstName: true, lastName: true, avatar: true, email: true } },
  jobProfile: {
    select: {
      id: true,
      discTargets: true,
      competencies: true,
      pcaExpected: true,
      milExpected: true,
      kpis: true,
      requirements: true,
      fitRequirements: true,
    },
  },
  channels: {
    select: {
      id: true,
      channelName: true,
      channelType: true,
      status: true,
      publishedAt: true,
      stats: true,
    },
  },
  approvals: {
    orderBy: { step: 'asc' as const },
    select: {
      id: true,
      step: true,
      status: true,
      comment: true,
      decidedAt: true,
      approver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
    },
  },
  stages: {
    orderBy: { order: 'asc' as const },
    select: { id: true, name: true, order: true, slaHours: true, isDefault: true },
  },
  _count: { select: { applications: true } },
} satisfies Prisma.VacancySelect;

const vacancyMutationSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  positions: true,
  createdAt: true,
} satisfies Prisma.VacancySelect;

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

const salarySchema = z.object({
  min: z.number().min(0).optional(),
  max: z.number().min(0).optional(),
  currency: z.string().max(10).default('COP'),
  period: z.enum(['monthly', 'yearly']).default('monthly'),
}).optional();

const settingsSchema = z.object({
  slaTargetDays: z.number().int().min(1).max(365).optional(),
  autoPublish: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  notifyOnApply: z.boolean().optional(),
}).optional();

const createVacancyInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  // AI-generated "social"/"whatsapp" description variants (packages/ai's
  // vacancy-writer agent) — populated only when the user picks "Use this"
  // for that variant in the creation wizard; otherwise left unset.
  socialDescription: z.string().max(2000).optional(),
  whatsappDescription: z.string().max(1000).optional(),
  companyId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  positions: z.number().int().min(1).max(100).default(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  salary: salarySchema,
  contractType: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  remotePolicy: z.enum(['onsite', 'remote', 'hybrid']).optional(),
  assignedTo: z.string().uuid().optional(),
  settings: settingsSchema,
});

const updateVacancyInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  companyId: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  positions: z.number().int().min(1).max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  salary: salarySchema,
  contractType: z.string().max(100).nullish(),
  location: z.string().max(200).nullish(),
  remotePolicy: z.enum(['onsite', 'remote', 'hybrid']).nullish(),
  assignedTo: z.string().uuid().nullish(),
  settings: settingsSchema,
});

const paginationInput = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

// ---------------------------------------------------------------------------
// CRUD sub-router
// ---------------------------------------------------------------------------

export const vacancyCrudRouter = router({
  list: permissionProcedure('vacancy', 'read')
    .input(
      paginationInput.extend({
        status: z.enum(['draft', 'pending_approval', 'approved', 'published', 'closed', 'frozen']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
        assignedTo: z.string().uuid().optional(),
        search: z.string().max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, status, priority, companyId, businessUnitId, teamId, assignedTo, search } = input;
      const scopeWhere = await scopeWhereFor('vacancy', ctx.access, ctx.user.id);

      const where: Prisma.VacancyWhereInput = {
        AND: [
          { organizationId: ctx.user.organizationId, deletedAt: null },
          scopeWhere as Prisma.VacancyWhereInput,
          {
            ...(status && { status }),
            ...(priority && { priority }),
            ...(companyId && { companyId }),
            ...(businessUnitId && { businessUnitId }),
            ...(teamId && { teamId }),
            ...(assignedTo && { assignedTo }),
            ...(search && { title: { contains: search, mode: 'insensitive' as const } }),
          },
        ],
      };

      const items = await db.vacancy.findMany({
        where,
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
        select: vacancyListSelect,
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const next = items.pop()!;
        nextCursor = next.id;
      }

      return { items, nextCursor };
    }),

  getById: permissionProcedure('vacancy', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('vacancy', ctx.access, ctx.user.id);
      const vacancy = await db.vacancy.findFirst({
        where: {
          AND: [
            { id: input.id, organizationId: ctx.user.organizationId, deletedAt: null },
            scopeWhere as Prisma.VacancyWhereInput,
          ],
        },
        select: vacancyDetailSelect,
      });

      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return vacancy;
    }),

  create: permissionProcedure('vacancy', 'create')
    .input(createVacancyInput)
    .mutation(async ({ ctx, input }) => {
      const requireApproval = input.settings?.requireApproval ?? false;
      const autoPublish = input.settings?.autoPublish ?? false;

      // Status-resolution matrix (Codex PR #120 fix wave, finding #2):
      //   requireApproval=false, autoPublish=false -> created directly as 'approved'
      //     (skips the draft->pending_approval->approved chain; still needs a manual
      //     vacancy:publish call to actually go live -- no more draft dead end).
      //   requireApproval=false, autoPublish=true  -> 'approved' + published in one
      //     transaction below, gated by an explicit vacancy:publish check.
      //   requireApproval=true,  autoPublish=false -> 'draft' (unchanged), proceeds
      //     through submitForApproval/approve.
      //   requireApproval=true,  autoPublish=true   -> rejected up front: combining an
      //     approval requirement with an immediate auto-publish is a contradictory
      //     request in this router (cross-cutting wiring into approve() is deferred).
      if (requireApproval && autoPublish) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'autoPublish requiere requireApproval en false',
        });
      }

      const baseData = {
        ...input,
        salary: (input.salary ?? undefined) as Prisma.InputJsonValue | undefined,
        settings: (input.settings ?? {}) as Prisma.InputJsonValue,
        organizationId: ctx.user.organizationId,
        createdBy: ctx.user.id,
        status: requireApproval ? 'draft' : 'approved',
      };

      if (autoPublish) {
        // This mutation is gated only by vacancy:create (see permissionProcedure
        // above) -- but the autoPublish branch also performs a publish in the same
        // call, so it must additionally hold vacancy:publish. Otherwise a user who
        // can create vacancies but not publish them could bypass that control via
        // this flag (Codex PR #120 finding #1). Check BEFORE the transaction so we
        // never partially create then fail.
        const publishAccess = await buildAccessForUser(
          {
            id: ctx.user.id,
            organizationId: ctx.user.organizationId,
            roles: ctx.user.roles,
            isPlatformOwner: ctx.user.isPlatformOwner,
          },
          'vacancy',
          'publish',
        );
        if (!publishAccess.allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'No tiene permiso para publicar vacantes',
          });
        }

        return db.$transaction(async (tx) => {
          const vacancy = await tx.vacancy.create({
            data: baseData,
            select: vacancyMutationSelect,
          });

          await tx.publicationChannel.create({
            data: {
              organizationId: ctx.user.organizationId,
              vacancyId: vacancy.id,
              channelName: 'Portal de candidatos',
              channelType: 'internal',
              status: 'published',
              publishedAt: new Date(),
            },
          });

          return tx.vacancy.update({
            where: { id: vacancy.id },
            data: { status: 'published' },
            select: vacancyMutationSelect,
          });
        });
      }

      return db.vacancy.create({
        data: baseData,
        select: vacancyMutationSelect,
      });
    }),

  update: permissionProcedure('vacancy', 'update')
    .input(updateVacancyInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      await assertScoped('vacancy', id, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.vacancy.update({
        where: { id },
        data: {
          ...data,
          salary: (data.salary ?? undefined) as Prisma.InputJsonValue | undefined,
          settings: (data.settings ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        select: vacancyMutationSelect,
      });
    }),

  close: permissionProcedure('vacancy', 'update')
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(1).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.vacancy.update({
        where: { id: input.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedReason: input.reason,
        },
        select: vacancyMutationSelect,
      });
    }),

  freeze: permissionProcedure('vacancy', 'update')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.vacancy.update({
        where: { id: input.id },
        data: { status: 'frozen' },
        select: vacancyMutationSelect,
      });
    }),

  updateRoleFamily: permissionProcedure('vacancy', 'update')
    .input(z.object({ vacancyId: z.string().uuid(), roleFamily: z.string().max(100).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.vacancy.update({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId },
        data: { roleFamily: input.roleFamily },
        select: { id: true, roleFamily: true },
      });
    }),

  duplicate: permissionProcedure('vacancy', 'create')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const original = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, deletedAt: null },
        select: {
          title: true,
          description: true,
          organizationId: true,
          companyId: true,
          businessUnitId: true,
          teamId: true,
          positions: true,
          priority: true,
          salary: true,
          contractType: true,
          location: true,
          remotePolicy: true,
          settings: true,
          jobProfile: {
            select: {
              organizationId: true,
              discTargets: true,
              competencies: true,
              pcaExpected: true,
              milExpected: true,
              kpis: true,
              requirements: true,
            },
          },
          stages: {
            orderBy: { order: 'asc' },
            select: { name: true, order: true, slaHours: true, checklist: true, isDefault: true },
          },
        },
      });
      if (!original) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.$transaction(async (tx) => {
        const newVacancy = await tx.vacancy.create({
          data: {
            title: `${original.title} (copia)`,
            description: original.description,
            organizationId: original.organizationId,
            companyId: original.companyId,
            businessUnitId: original.businessUnitId,
            teamId: original.teamId,
            positions: original.positions,
            priority: original.priority,
            salary: (original.salary as Prisma.InputJsonValue) ?? undefined,
            contractType: original.contractType,
            location: original.location,
            remotePolicy: original.remotePolicy,
            settings: (original.settings as Prisma.InputJsonValue) ?? {},
            status: 'draft',
            createdBy: ctx.user.id,
          },
          select: vacancyMutationSelect,
        });

        if (original.jobProfile) {
          await tx.jobProfile.create({
            data: {
              organizationId: original.jobProfile.organizationId,
              vacancyId: newVacancy.id,
              discTargets: (original.jobProfile.discTargets as Prisma.InputJsonValue) ?? {},
              competencies: (original.jobProfile.competencies as Prisma.InputJsonValue) ?? {},
              pcaExpected: (original.jobProfile.pcaExpected as Prisma.InputJsonValue) ?? undefined,
              milExpected: (original.jobProfile.milExpected as Prisma.InputJsonValue) ?? undefined,
              kpis: (original.jobProfile.kpis as Prisma.InputJsonValue) ?? undefined,
              requirements: (original.jobProfile.requirements as Prisma.InputJsonValue) ?? undefined,
            },
          });
        }

        if (original.stages.length > 0) {
          await tx.pipelineStage.createMany({
            data: original.stages.map((s) => ({
              organizationId: newVacancy.id ? original.organizationId : original.organizationId,
              vacancyId: newVacancy.id,
              name: s.name,
              order: s.order,
              slaHours: s.slaHours,
              checklist: (s.checklist as Prisma.InputJsonValue) ?? undefined,
              isDefault: s.isDefault,
            })),
          });
        }

        return newVacancy;
      });
    }),
});
