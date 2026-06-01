import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const candidateTimelineRouter = router({
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
});
