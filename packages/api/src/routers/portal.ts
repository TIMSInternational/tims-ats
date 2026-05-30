import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { db } from '@tims/db';

export const portalRouter = router({
  // ── Public (no auth) ────────────────────────────────────────

  // List published vacancies for the careers portal
  listVacancies: publicProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        location: z.string().optional(),
        search: z.string().optional(),
        take: z.number().min(1).max(50).default(20),
        cursor: z.string().uuid().optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {
        organizationId: input.organizationId,
        status: 'published',
        deletedAt: null,
      };
      if (input.location) where.location = { contains: input.location, mode: 'insensitive' };
      if (input.search) where.title = { contains: input.search, mode: 'insensitive' };

      const items = await db.vacancy.findMany({
        where,
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          title: true,
          location: true,
          remotePolicy: true,
          contractType: true,
          createdAt: true,
          company: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const hasMore = items.length > input.take;
      return {
        items: items.slice(0, input.take),
        nextCursor: hasMore ? items[input.take - 1]!.id : undefined,
      };
    }),

  // Get single vacancy detail for portal
  getVacancy: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.vacancy.findFirstOrThrow({
        where: { id: input.id, status: 'published', deletedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          remotePolicy: true,
          contractType: true,
          salary: true,
          positions: true,
          createdAt: true,
          company: { select: { id: true, name: true } },
          jobProfile: {
            select: { competencies: true, requirements: true },
          },
        },
      });
    }),

  // Apply to a vacancy (public — creates candidate + application)
  applyToVacancy: publicProcedure
    .input(
      z.object({
        vacancyId: z.string().uuid(),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        email: z.string().email(),
        phone: z.string().optional(),
        source: z.string().default('portal'),
        linkedinUrl: z.string().url().optional(),
        currentTitle: z.string().optional(),
        currentCompany: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const vacancy = await db.vacancy.findFirstOrThrow({
        where: { id: input.vacancyId, status: 'published', deletedAt: null },
        include: { stages: { where: { isDefault: true }, take: 1 } },
      });

      const orgId = vacancy.organizationId;

      // Upsert candidate
      const candidate = await db.candidate.upsert({
        where: { organizationId_email: { organizationId: orgId, email: input.email } },
        create: {
          organizationId: orgId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          source: input.source,
          poolType: 'applicant',
          linkedinUrl: input.linkedinUrl,
          currentTitle: input.currentTitle,
          currentCompany: input.currentCompany,
        },
        update: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
        },
      });

      // Find the default stage (first stage)
      const defaultStage = vacancy.stages[0];
      if (!defaultStage) {
        // Fallback: get the first ordered stage
        const firstStage = await db.pipelineStage.findFirst({
          where: { vacancyId: vacancy.id },
          orderBy: { order: 'asc' },
        });
        if (!firstStage) {
          throw new Error('No pipeline stages configured for this vacancy');
        }

        const application = await db.application.create({
          data: {
            organizationId: orgId,
            candidateId: candidate.id,
            vacancyId: vacancy.id,
            currentStageId: firstStage.id,
            source: input.source,
          },
        });
        return { applicationId: application.id, candidateId: candidate.id };
      }

      const application = await db.application.create({
        data: {
          organizationId: orgId,
          candidateId: candidate.id,
          vacancyId: vacancy.id,
          currentStageId: defaultStage.id,
          source: input.source,
        },
      });

      return { applicationId: application.id, candidateId: candidate.id };
    }),

  // ── Authenticated (candidate portal) ───────────────────────

  // Get my applications
  getMyApplications: protectedProcedure.query(async ({ ctx }) => {
    const candidate = await db.candidate.findFirst({
      where: { organizationId: ctx.user.organizationId, email: ctx.user.email },
    });
    if (!candidate) return [];

    return db.application.findMany({
      where: { candidateId: candidate.id, organizationId: ctx.user.organizationId },
      include: {
        vacancy: { select: { id: true, title: true, company: { select: { name: true } } } },
        currentStage: { select: { id: true, name: true } },
      },
      orderBy: { appliedAt: 'desc' },
    });
  }),

  // Get single application status
  getApplicationStatus: protectedProcedure
    .input(z.object({ applicationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.application.findFirstOrThrow({
        where: { id: input.applicationId, organizationId: ctx.user.organizationId },
        include: {
          vacancy: { select: { title: true } },
          currentStage: { select: { name: true } },
          movements: {
            select: { toStage: { select: { name: true } }, movedAt: true },
            orderBy: { movedAt: 'desc' },
          },
        },
      });
    }),

  // Upload document — stub
  uploadDocument: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        type: z.string(),
        fileName: z.string(),
      })
    )
    .mutation(async () => {
      // Stub — would return a presigned upload URL
      return {
        uploadUrl: 'https://storage.example.com/upload/stub',
        expiresIn: 300,
      };
    }),

  // Get my assessments
  getMyAssessments: protectedProcedure.query(async ({ ctx }) => {
    const candidate = await db.candidate.findFirst({
      where: { organizationId: ctx.user.organizationId, email: ctx.user.email },
    });
    if (!candidate) return [];

    return db.assessmentAssignment.findMany({
      where: { candidateId: candidate.id, organizationId: ctx.user.organizationId },
      include: {
        assessmentType: { select: { name: true, code: true, duration: true } },
        vacancy: { select: { title: true } },
        result: { select: { normalizedScore: true, percentile: true } },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }),

  // Start assessment — stub
  startAssessment: protectedProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Stub — would initialize the assessment session
      await db.assessmentAssignment.update({
        where: { id: input.assignmentId, organizationId: ctx.user.organizationId },
        data: { status: 'in_progress', startedAt: new Date() },
      });
      return { started: true, sessionUrl: '/assessments/session/stub' };
    }),

  // Get my interviews
  getMyInterviews: protectedProcedure.query(async ({ ctx }) => {
    const candidate = await db.candidate.findFirst({
      where: { organizationId: ctx.user.organizationId, email: ctx.user.email },
    });
    if (!candidate) return [];

    return db.interview.findMany({
      where: {
        candidateId: candidate.id,
        organizationId: ctx.user.organizationId,
        status: { in: ['scheduled', 'confirmed'] },
      },
      select: {
        id: true,
        type: true,
        status: true,
        scheduledAt: true,
        duration: true,
        location: true,
        meetingUrl: true,
        vacancy: { select: { title: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }),

  // Get my offer
  getMyOffer: protectedProcedure
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const candidate = await db.candidate.findFirst({
        where: { organizationId: ctx.user.organizationId, email: ctx.user.email },
      });
      if (!candidate) return null;

      return db.offer.findFirst({
        where: {
          id: input.offerId,
          candidateId: candidate.id,
          organizationId: ctx.user.organizationId,
        },
        select: {
          id: true,
          status: true,
          salary: true,
          currency: true,
          startDate: true,
          contractType: true,
          benefits: true,
          terms: true,
          expiresAt: true,
          vacancy: { select: { title: true, company: { select: { name: true } } } },
        },
      });
    }),

  // Accept offer
  acceptOffer: protectedProcedure
    .input(z.object({ offerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const candidate = await db.candidate.findFirstOrThrow({
        where: { organizationId: ctx.user.organizationId, email: ctx.user.email },
      });
      return db.offer.update({
        where: {
          id: input.offerId,
          candidateId: candidate.id,
          organizationId: ctx.user.organizationId,
        },
        data: { status: 'accepted', respondedAt: new Date() },
      });
    }),

  // Decline offer
  declineOffer: protectedProcedure
    .input(
      z.object({
        offerId: z.string().uuid(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const candidate = await db.candidate.findFirstOrThrow({
        where: { organizationId: ctx.user.organizationId, email: ctx.user.email },
      });
      return db.offer.update({
        where: {
          id: input.offerId,
          candidateId: candidate.id,
          organizationId: ctx.user.organizationId,
        },
        data: { status: 'declined', respondedAt: new Date() },
      });
    }),

  // Update profile
  updateProfile: protectedProcedure
    .input(
      z.object({
        phone: z.string().optional(),
        location: z.string().optional(),
        currentTitle: z.string().optional(),
        currentCompany: z.string().optional(),
        linkedinUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.candidate.updateMany({
        where: { organizationId: ctx.user.organizationId, email: ctx.user.email },
        data: input,
      });
    }),

  // Request data deletion — stub (GDPR)
  requestDataDeletion: protectedProcedure.mutation(async () => {
    // Stub — would enqueue a data deletion task
    return {
      status: 'received',
      message: 'Your data deletion request has been received and will be processed within 30 days.',
    };
  }),

  // Submit NPS — stub
  submitNps: protectedProcedure
    .input(
      z.object({
        score: z.number().min(0).max(10),
        comment: z.string().optional(),
        context: z.string().optional(),
      })
    )
    .mutation(async () => {
      // Stub — would store NPS response
      return { submitted: true };
    }),
});
