import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
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
// Router
// ---------------------------------------------------------------------------

export const vacancyRouter = router({
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

  // 4.8 — Submit vacancy for approval
  submitForApproval: permissionProcedure('vacancy', 'update')
    .input(z.object({
      id: z.string().uuid(),
      approverIds: z.array(z.string().uuid()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, status: 'draft', deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada o no esta en borrador' });
      }

      return db.$transaction(async (tx) => {
        await tx.vacancy.update({
          where: { id: input.id },
          data: { status: 'pending_approval' },
        });

        await tx.vacancyApproval.createMany({
          data: input.approverIds.map((approverId, idx) => ({
            organizationId: ctx.user.organizationId,
            vacancyId: input.id,
            approverId,
            step: idx + 1,
            status: 'pending',
          })),
        });

        return tx.vacancy.findUniqueOrThrow({
          where: { id: input.id },
          include: { approvals: { orderBy: { step: 'asc' } } },
        });
      });
    }),

  // 4.9 — Approve vacancy
  approve: permissionProcedure('vacancy', 'approve')
    .input(z.object({
      id: z.string().uuid(),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const approval = await db.vacancyApproval.findFirst({
        where: {
          vacancyId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
      });
      if (!approval) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay aprobacion pendiente para este usuario' });
      }

      await db.vacancyApproval.update({
        where: { id: approval.id },
        data: { status: 'approved', comment: input.comment, decidedAt: new Date() },
      });

      // Check if all approvals are done
      const pendingCount = await db.vacancyApproval.count({
        where: { vacancyId: input.id, status: 'pending' },
      });

      if (pendingCount === 0) {
        await db.vacancy.update({
          where: { id: input.id },
          data: { status: 'approved' },
        });
      }

      return db.vacancy.findUniqueOrThrow({
        where: { id: input.id },
        include: { approvals: { orderBy: { step: 'asc' } } },
      });
    }),

  // 4.10 — Reject vacancy
  reject: permissionProcedure('vacancy', 'approve')
    .input(z.object({
      id: z.string().uuid(),
      comment: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const approval = await db.vacancyApproval.findFirst({
        where: {
          vacancyId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
      });
      if (!approval) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay aprobacion pendiente para este usuario' });
      }

      return db.$transaction(async (tx) => {
        await tx.vacancyApproval.update({
          where: { id: approval.id },
          data: { status: 'rejected', comment: input.comment, decidedAt: new Date() },
        });

        await tx.vacancy.update({
          where: { id: input.id },
          data: { status: 'draft' },
        });

        // Cancel remaining pending approvals
        await tx.vacancyApproval.updateMany({
          where: { vacancyId: input.id, status: 'pending' },
          data: { status: 'cancelled' },
        });

        return tx.vacancy.findUniqueOrThrow({
          where: { id: input.id },
          include: { approvals: { orderBy: { step: 'asc' } } },
        });
      });
    }),

  // 4.11 — Generate description (AI stub)
  generateDescription: permissionProcedure('vacancy', 'create')
    .input(z.object({
      title: z.string().min(1),
      context: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Stub — will be replaced with AWS Bedrock call
      return {
        description: `## ${input.title}\n\nEstamos buscando un profesional talentoso para unirse a nuestro equipo como **${input.title}**.\n\n### Responsabilidades\n- Liderar iniciativas clave del area\n- Colaborar con equipos multifuncionales\n- Contribuir al crecimiento de la organizacion\n\n### Requisitos\n- Experiencia relevante en el area\n- Habilidades de comunicacion efectiva\n- Orientacion a resultados\n\n### Beneficios\n- Salario competitivo\n- Desarrollo profesional continuo\n- Ambiente de trabajo colaborativo`,
        model: 'stub',
        tokensUsed: 0,
      };
    }),

  // 4.12 — Check inclusive language (AI stub)
  checkInclusiveLanguage: permissionProcedure('vacancy', 'read')
    .input(z.object({ text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // Stub — will be replaced with AWS Bedrock call
      return {
        score: 85,
        suggestions: [
          { original: 'candidato', suggestion: 'persona candidata', reason: 'Lenguaje de genero neutro' },
        ],
        model: 'stub',
      };
    }),

  // 4.13 — Get job profile for a vacancy
  getJobProfile: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify vacancy belongs to org
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.jobProfile.findUnique({
        where: { vacancyId: input.vacancyId },
      });
    }),

  // 4.14 — Update (or create) job profile for a vacancy
  updateJobProfile: permissionProcedure('vacancy', 'update')
    .input(z.object({
      vacancyId: z.string().uuid(),
      discTargets: z.record(z.unknown()).optional(),
      competencies: z.record(z.unknown()).optional(),
      pcaExpected: z.record(z.unknown()).nullish(),
      milExpected: z.record(z.unknown()).nullish(),
      kpis: z.unknown().nullish(),
      requirements: z.unknown().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      const { vacancyId, ...data } = input;

      return db.jobProfile.upsert({
        where: { vacancyId },
        create: {
          organizationId: ctx.user.organizationId,
          vacancyId,
          discTargets: (data.discTargets ?? {}) as any,
          competencies: (data.competencies ?? {}) as any,
          pcaExpected: data.pcaExpected as any ?? undefined,
          milExpected: data.milExpected as any ?? undefined,
          kpis: data.kpis as any ?? undefined,
          requirements: data.requirements as any ?? undefined,
        },
        update: {
          ...(data.discTargets !== undefined && { discTargets: data.discTargets as any }),
          ...(data.competencies !== undefined && { competencies: data.competencies as any }),
          ...(data.pcaExpected !== undefined && { pcaExpected: data.pcaExpected as any }),
          ...(data.milExpected !== undefined && { milExpected: data.milExpected as any }),
          ...(data.kpis !== undefined && { kpis: data.kpis as any }),
          ...(data.requirements !== undefined && { requirements: data.requirements as any }),
        },
      });
    }),

  // 4.15 — List publication channels for a vacancy
  listChannels: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.publicationChannel.findMany({
        where: { vacancyId: input.vacancyId, organizationId: ctx.user.organizationId },
        orderBy: { createdAt: 'desc' },
      });
    }),

  // 4.16 — Publish vacancy to a channel
  publish: permissionProcedure('vacancy', 'publish')
    .input(z.object({
      vacancyId: z.string().uuid(),
      channelName: z.string().min(1),
      channelType: z.enum(['internal', 'linkedin', 'indeed', 'computrabajo', 'elempleo', 'website', 'other']),
    }))
    .mutation(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: {
          id: input.vacancyId,
          organizationId: ctx.user.organizationId,
          status: { in: ['approved', 'published'] },
          deletedAt: null,
        },
      });
      if (!vacancy) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'La vacante debe estar aprobada para publicar',
        });
      }

      const channel = await db.publicationChannel.create({
        data: {
          organizationId: ctx.user.organizationId,
          vacancyId: input.vacancyId,
          channelName: input.channelName,
          channelType: input.channelType,
          status: 'published',
          publishedAt: new Date(),
        },
      });

      // Update vacancy status to published if not already
      if (vacancy.status !== 'published') {
        await db.vacancy.update({
          where: { id: input.vacancyId },
          data: { status: 'published' },
        });
      }

      return channel;
    }),

  // 4.17 — Unpublish vacancy from a channel
  unpublish: permissionProcedure('vacancy', 'publish')
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await db.publicationChannel.findFirst({
        where: { id: input.channelId, organizationId: ctx.user.organizationId },
      });
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Canal no encontrado' });
      }

      return db.publicationChannel.update({
        where: { id: input.channelId },
        data: { status: 'unpublished', unpublishedAt: new Date() },
      });
    }),

  // 4.18 — Get vacancy stats (application counts by stage)
  getStats: permissionProcedure('vacancy', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      const [totalApplications, activeApplications, rejectedApplications, stageBreakdown] =
        await Promise.all([
          db.application.count({ where: { vacancyId: input.id } }),
          db.application.count({ where: { vacancyId: input.id, status: 'active' } }),
          db.application.count({ where: { vacancyId: input.id, status: 'rejected' } }),
          db.pipelineStage.findMany({
            where: { vacancyId: input.id },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              name: true,
              order: true,
              _count: { select: { applications: true } },
            },
          }),
        ]);

      return {
        vacancyId: input.id,
        totalApplications,
        activeApplications,
        rejectedApplications,
        stageBreakdown: stageBreakdown.map((s) => ({
          stageId: s.id,
          stageName: s.name,
          order: s.order,
          count: s._count.applications,
        })),
      };
    }),

  // 4.19 — Get approval chain for a vacancy
  getApprovalChain: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.vacancyApproval.findMany({
        where: { vacancyId: input.vacancyId },
        orderBy: { step: 'asc' },
        include: {
          approver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });
    }),

  // 4.20 — Get dashboard KPIs across all vacancies
  getDashboardKpis: permissionProcedure('vacancy', 'read')
    .query(async ({ ctx }) => {
      const orgId = ctx.user.organizationId;

      const [
        totalOpen,
        totalDraft,
        totalPendingApproval,
        totalPublished,
        totalClosed,
        totalApplications,
        recentVacancies,
      ] = await Promise.all([
        db.vacancy.count({ where: { organizationId: orgId, status: { in: ['approved', 'published'] }, deletedAt: null } }),
        db.vacancy.count({ where: { organizationId: orgId, status: 'draft', deletedAt: null } }),
        db.vacancy.count({ where: { organizationId: orgId, status: 'pending_approval', deletedAt: null } }),
        db.vacancy.count({ where: { organizationId: orgId, status: 'published', deletedAt: null } }),
        db.vacancy.count({ where: { organizationId: orgId, status: 'closed', deletedAt: null } }),
        db.application.count({ where: { organizationId: orgId } }),
        db.vacancy.findMany({
          where: { organizationId: orgId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            _count: { select: { applications: true } },
          },
        }),
      ]);

      return {
        totalOpen,
        totalDraft,
        totalPendingApproval,
        totalPublished,
        totalClosed,
        totalApplications,
        recentVacancies,
      };
    }),
});
