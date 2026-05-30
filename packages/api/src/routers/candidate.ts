import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const cursorPaginationInput = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const candidateCreateInput = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().optional(),
  source: z.string().min(1),
  poolType: z.string().min(1),
  avatar: z.string().url().optional(),
  location: z.string().optional(),
  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  yearsExperience: z.number().int().min(0).optional(),
  skills: z.array(z.string()).optional(),
  linkedinUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

const candidateUpdateInput = candidateCreateInput.partial().extend({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const candidateRouter = router({
  // 6.1 — List candidates with filters + cursor pagination
  list: permissionProcedure('candidate', 'read')
    .input(
      cursorPaginationInput.extend({
        search: z.string().optional(),
        poolType: z.string().optional(),
        fitMin: z.number().min(0).max(100).optional(),
        fitMax: z.number().min(0).max(100).optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        skills: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, search, poolType, tags, source, skills, fitMin, fitMax } = input;

      // Build where clause
      const where: any = {
        organizationId: ctx.user.organizationId,
        isActive: true,
        deletedAt: null,
      };

      if (poolType) where.poolType = poolType;
      if (source) where.source = source;

      if (search) {
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { currentTitle: { contains: search, mode: 'insensitive' } },
          { currentCompany: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (tags && tags.length > 0) {
        where.tags = { some: { tag: { in: tags } } };
      }

      if (skills && skills.length > 0) {
        // JSON array containment — assumes skills stored as JSON string array
        where.skills = { array_contains: skills };
      }

      // Fit-score range requires a sub-query on fitScores
      if (fitMin !== undefined || fitMax !== undefined) {
        where.fitScores = {
          some: {
            overallScore: {
              ...(fitMin !== undefined ? { gte: fitMin } : {}),
              ...(fitMax !== undefined ? { lte: fitMax } : {}),
            },
          },
        };
      }

      const items = await db.candidate.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          tags: true,
          fitScores: { orderBy: { calculatedAt: 'desc' }, take: 1 },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const extra = items.pop()!;
        nextCursor = extra.id;
      }

      return { items, nextCursor };
    }),

  // 6.2 — Get candidate by ID
  getById: permissionProcedure('candidate', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const candidate = await db.candidate.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.user.organizationId,
          deletedAt: null,
        },
        include: {
          tags: true,
          documents: { orderBy: { uploadedAt: 'desc' } },
          applications: {
            include: {
              vacancy: { select: { id: true, title: true } },
              currentStage: { select: { id: true, name: true } },
            },
          },
          fitScores: { orderBy: { calculatedAt: 'desc' } },
          assessmentAssignments: {
            include: {
              assessmentType: { select: { id: true, name: true, code: true } },
              result: true,
            },
          },
          createdBy: {
            select: { id: true, firstName: true, lastName: true, avatar: true },
          },
        },
      });

      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      return candidate;
    }),

  // 6.3 — Create candidate
  create: permissionProcedure('candidate', 'create')
    .input(candidateCreateInput)
    .mutation(async ({ ctx, input }) => {
      return db.candidate.create({
        data: {
          ...input,
          skills: input.skills ?? undefined,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
      });
    }),

  // 6.4 — Update candidate
  update: permissionProcedure('candidate', 'update')
    .input(candidateUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await db.candidate.findFirst({
        where: { id, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      return db.candidate.update({
        where: { id },
        data: {
          ...data,
          skills: data.skills ?? undefined,
        },
      });
    }),

  // 6.5 — Upload document (stub — returns mock)
  uploadDocument: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        type: z.string().min(1),
        fileName: z.string().min(1),
        fileSize: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Stub: in production this would generate a pre-signed S3 URL
      const mockUrl = `https://storage.tims.app/${ctx.user.organizationId}/${input.candidateId}/${input.fileName}`;

      const doc = await db.candidateDocument.create({
        data: {
          organizationId: ctx.user.organizationId,
          candidateId: input.candidateId,
          type: input.type,
          fileName: input.fileName,
          fileUrl: mockUrl,
          fileSize: input.fileSize,
        },
      });

      return { document: doc, uploadUrl: mockUrl };
    }),

  // 6.6 — Delete document
  deleteDocument: permissionProcedure('candidate', 'update')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await db.candidateDocument.findFirst({
        where: { id: input.documentId, organizationId: ctx.user.organizationId },
      });
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
      }

      await db.candidateDocument.delete({ where: { id: input.documentId } });
      return { success: true };
    }),

  // 6.7 — Parse CV (stub — mock AI)
  parseCV: permissionProcedure('candidate', 'update')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await db.candidateDocument.findFirst({
        where: { id: input.documentId, organizationId: ctx.user.organizationId },
      });
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
      }

      // Stub: mock AI-parsed data
      const parsedData = {
        extractedName: 'Juan Perez',
        extractedEmail: 'juan@example.com',
        extractedPhone: '+57 300 123 4567',
        extractedSkills: ['JavaScript', 'React', 'Node.js'],
        extractedExperience: [
          { company: 'Acme Corp', title: 'Software Engineer', years: 3 },
        ],
        extractedEducation: [
          { institution: 'Universidad Nacional', degree: 'Ingenieria de Sistemas', year: 2020 },
        ],
        confidence: 0.87,
        modelVersion: 'bedrock-claude-v1-stub',
      };

      await db.candidateDocument.update({
        where: { id: input.documentId },
        data: { parsedData },
      });

      return parsedData;
    }),

  // 6.8 — Add tag
  addTag: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        tag: z.string().min(1).max(50),
        source: z.string().default('manual'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.candidateTag.create({
        data: {
          organizationId: ctx.user.organizationId,
          candidateId: input.candidateId,
          tag: input.tag,
          source: input.source,
        },
      });
    }),

  // 6.9 — Remove tag
  removeTag: permissionProcedure('candidate', 'update')
    .input(z.object({ candidateId: z.string().uuid(), tag: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.candidateTag.findFirst({
        where: {
          candidateId: input.candidateId,
          tag: input.tag,
          organizationId: ctx.user.organizationId,
        },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag no encontrado' });
      }

      await db.candidateTag.delete({ where: { id: existing.id } });
      return { success: true };
    }),

  // 6.10 — Add to pool (change poolType)
  addToPool: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        poolType: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.candidate.findFirst({
        where: { id: input.candidateId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      return db.candidate.update({
        where: { id: input.candidateId },
        data: { poolType: input.poolType },
      });
    }),

  // 6.11 — Get timeline (applications + movements + assessments)
  getTimeline: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [applications, assessments, documents] = await Promise.all([
        db.application.findMany({
          where: {
            candidateId: input.candidateId,
            organizationId: ctx.user.organizationId,
          },
          include: {
            vacancy: { select: { id: true, title: true } },
            movements: {
              include: {
                fromStage: { select: { name: true } },
                toStage: { select: { name: true } },
                actor: { select: { firstName: true, lastName: true } },
              },
              orderBy: { movedAt: 'desc' },
            },
          },
          orderBy: { appliedAt: 'desc' },
        }),
        db.assessmentAssignment.findMany({
          where: {
            candidateId: input.candidateId,
            organizationId: ctx.user.organizationId,
          },
          include: {
            assessmentType: { select: { name: true, code: true } },
            result: true,
          },
          orderBy: { assignedAt: 'desc' },
        }),
        db.candidateDocument.findMany({
          where: {
            candidateId: input.candidateId,
            organizationId: ctx.user.organizationId,
          },
          orderBy: { uploadedAt: 'desc' },
        }),
      ]);

      // Merge into a unified timeline sorted by date
      type TimelineEvent = {
        type: string;
        date: Date;
        data: unknown;
      };

      const events: TimelineEvent[] = [];

      for (const app of applications) {
        events.push({ type: 'application', date: app.appliedAt, data: app });
        for (const mov of app.movements) {
          events.push({ type: 'stage_movement', date: mov.movedAt, data: mov });
        }
      }

      for (const a of assessments) {
        events.push({ type: 'assessment_assigned', date: a.assignedAt, data: a });
        if (a.completedAt) {
          events.push({ type: 'assessment_completed', date: a.completedAt, data: a });
        }
      }

      for (const doc of documents) {
        events.push({ type: 'document_uploaded', date: doc.uploadedAt, data: doc });
      }

      events.sort((a, b) => b.date.getTime() - a.date.getTime());

      return events;
    }),

  // 6.12 — Apply candidate to a vacancy
  applyToVacancy: permissionProcedure('candidate', 'create')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        vacancyId: z.string().uuid(),
        source: z.string().default('manual'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find the first pipeline stage for the vacancy
      const firstStage = await db.pipelineStage.findFirst({
        where: { vacancyId: input.vacancyId, organizationId: ctx.user.organizationId },
        orderBy: { order: 'asc' },
      });

      if (!firstStage) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'La vacante no tiene etapas de pipeline configuradas',
        });
      }

      return db.application.create({
        data: {
          organizationId: ctx.user.organizationId,
          candidateId: input.candidateId,
          vacancyId: input.vacancyId,
          currentStageId: firstStage.id,
          source: input.source,
        },
        include: {
          vacancy: { select: { id: true, title: true } },
          currentStage: { select: { id: true, name: true } },
        },
      });
    }),

  // 6.13 — Get risks (flight risk, bias, compliance)
  getRisks: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const candidate = await db.candidate.findFirst({
        where: { id: input.candidateId, organizationId: ctx.user.organizationId, deletedAt: null },
        include: {
          applications: { select: { status: true } },
          fitScores: { orderBy: { calculatedAt: 'desc' }, take: 1 },
        },
      });

      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      // Simple heuristic-based risk assessment
      const latestFit = candidate.fitScores[0];
      const rejectedCount = candidate.applications.filter((a) => a.status === 'rejected').length;

      return {
        overallRisk: latestFit && latestFit.overallScore < 40 ? 'high' : rejectedCount > 2 ? 'medium' : 'low',
        factors: [
          {
            label: 'Fit Score',
            value: latestFit?.overallScore ?? null,
            risk: latestFit && latestFit.overallScore < 40 ? 'high' : 'low',
          },
          {
            label: 'Previous Rejections',
            value: rejectedCount,
            risk: rejectedCount > 2 ? 'medium' : 'low',
          },
          {
            label: 'Missing Documents',
            value: null,
            risk: 'unknown',
          },
        ],
      };
    }),

  // 6.14 — Get recommendations (stub — mock AI)
  getRecommendations: permissionProcedure('candidate', 'read')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const candidate = await db.candidate.findFirst({
        where: { id: input.candidateId, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      // Stub: mock AI recommendations
      return {
        candidateId: input.candidateId,
        recommendedVacancies: [
          { vacancyId: '00000000-0000-0000-0000-000000000001', title: 'Software Engineer Sr.', fitScore: 92, reason: 'Skills match: React, Node.js' },
          { vacancyId: '00000000-0000-0000-0000-000000000002', title: 'Tech Lead', fitScore: 78, reason: 'Experience level matches' },
        ],
        suggestedActions: [
          'Schedule technical assessment',
          'Request updated CV',
          'Add to talent pool: Engineering',
        ],
        modelVersion: 'bedrock-claude-v1-stub',
      };
    }),

  // 6.15 — Full-text search candidates
  search: permissionProcedure('candidate', 'read')
    .input(
      z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      return db.candidate.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          deletedAt: null,
          OR: [
            { firstName: { contains: input.query, mode: 'insensitive' } },
            { lastName: { contains: input.query, mode: 'insensitive' } },
            { email: { contains: input.query, mode: 'insensitive' } },
            { currentTitle: { contains: input.query, mode: 'insensitive' } },
            { currentCompany: { contains: input.query, mode: 'insensitive' } },
          ],
        },
        take: input.limit,
        orderBy: { updatedAt: 'desc' },
        include: { tags: true },
      });
    }),

  // 6.16 — Merge duplicate candidates
  merge: permissionProcedure('candidate', 'delete')
    .input(
      z.object({
        primaryId: z.string().uuid(),
        duplicateId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.primaryId === input.duplicateId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No puedes fusionar un candidato consigo mismo' });
      }

      const orgId = ctx.user.organizationId;

      const [primary, duplicate] = await Promise.all([
        db.candidate.findFirst({ where: { id: input.primaryId, organizationId: orgId, deletedAt: null } }),
        db.candidate.findFirst({ where: { id: input.duplicateId, organizationId: orgId, deletedAt: null } }),
      ]);

      if (!primary || !duplicate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Uno o ambos candidatos no encontrados' });
      }

      // Move related records to primary candidate
      await db.$transaction([
        db.candidateDocument.updateMany({
          where: { candidateId: input.duplicateId },
          data: { candidateId: input.primaryId },
        }),
        db.candidateTag.deleteMany({
          where: {
            candidateId: input.duplicateId,
            tag: { in: await db.candidateTag.findMany({ where: { candidateId: input.primaryId }, select: { tag: true } }).then((t) => t.map((x) => x.tag)) },
          },
        }),
        db.candidateTag.updateMany({
          where: { candidateId: input.duplicateId },
          data: { candidateId: input.primaryId },
        }),
        db.assessmentAssignment.updateMany({
          where: { candidateId: input.duplicateId },
          data: { candidateId: input.primaryId },
        }),
        db.fitScore.deleteMany({
          where: { candidateId: input.duplicateId },
        }),
        // Soft-delete the duplicate
        db.candidate.update({
          where: { id: input.duplicateId },
          data: { deletedAt: new Date(), isActive: false },
        }),
      ]);

      return db.candidate.findUnique({
        where: { id: input.primaryId },
        include: { tags: true, documents: true },
      });
    }),

  // 6.17 — Get pool statistics
  getPoolStats: permissionProcedure('candidate', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const stats = await db.candidate.groupBy({
      by: ['poolType'],
      where: { organizationId: orgId, isActive: true, deletedAt: null },
      _count: { id: true },
    });

    const total = stats.reduce((sum, s) => sum + s._count.id, 0);

    return {
      total,
      byPool: stats.map((s) => ({
        poolType: s.poolType,
        count: s._count.id,
      })),
    };
  }),

  // 6.18 — Bulk tag candidates
  bulkTag: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateIds: z.array(z.string().uuid()).min(1).max(200),
        tag: z.string().min(1).max(50),
        source: z.string().default('bulk'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.user.organizationId;

      // Verify all candidates belong to org
      const count = await db.candidate.count({
        where: { id: { in: input.candidateIds }, organizationId: orgId, deletedAt: null },
      });
      if (count !== input.candidateIds.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Uno o mas candidatos no encontrados' });
      }

      // Use createMany with skipDuplicates to avoid unique constraint errors
      const result = await db.candidateTag.createMany({
        data: input.candidateIds.map((candidateId) => ({
          organizationId: orgId,
          candidateId,
          tag: input.tag,
          source: input.source,
        })),
        skipDuplicates: true,
      });

      return { tagged: result.count };
    }),

  // 6.19 — Export candidates (stub)
  export: permissionProcedure('candidate', 'read')
    .input(
      z.object({
        format: z.enum(['csv', 'xlsx']).default('csv'),
        poolType: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Stub: in production this would generate and upload the file to S3
      return {
        downloadUrl: `https://storage.tims.app/${ctx.user.organizationId}/exports/candidates-${Date.now()}.${input.format}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        format: input.format,
        status: 'stub_generated',
      };
    }),
});
