import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { db } from '@tims/db';
import { captchaBypassAllowed } from './portal-helpers';
import { createCvUploadPresignedPost } from '../lib/s3';
import { CV_ALLOWED_CONTENT_TYPES } from '../lib/cv-extraction';
import { portalApplicationService } from '../services/portal-application.service';

// Verify a Cloudflare Turnstile token on the public apply form. In production the
// secret MUST be configured (else every apply is rejected — fail closed). Once the
// secret is set, a valid token is required — this throttles scripted spam/DoS
// against the unauthenticated endpoint.
async function verifyCaptcha(token: string | undefined): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return captchaBypassAllowed(secret, process.env.NODE_ENV);
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // fail closed on verification error
  }
}

export const portalRouter = router({
  // ── Public (no auth) ────────────────────────────────────────

  // Get portal stats for hero section
  getPortalStats: publicProcedure.input(z.object({ organizationId: z.string().uuid() })).query(async ({ input }) => {
    const where = { organizationId: input.organizationId, status: 'published', deletedAt: null };
    const [totalVacancies, vacancies] = await Promise.all([
      db.vacancy.count({ where }),
      db.vacancy.findMany({
        where,
        select: { location: true, unit: { select: { name: true } } },
      }),
    ]);
    const locations = new Set(vacancies.map((v) => v.location).filter(Boolean));
    const departments = new Set(vacancies.map((v) => v.unit?.name).filter(Boolean));
    return { totalVacancies, totalLocations: locations.size, totalDepartments: departments.size };
  }),

  // List published vacancies for the careers portal
  listVacancies: publicProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        location: z.string().trim().max(100).optional(),
        search: z.string().trim().max(100).optional(),
        take: z.number().min(1).max(50).default(20),
        cursor: z.string().uuid().optional(),
      }),
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
          description: true,
          location: true,
          remotePolicy: true,
          contractType: true,
          salary: true,
          priority: true,
          createdAt: true,
          company: { select: { id: true, name: true } },
          unit: { select: { name: true } },
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
  getVacancy: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const [vacancy, applicantCount] = await Promise.all([
      db.vacancy.findFirstOrThrow({
        where: { id: input.id, status: 'published', deletedAt: null },
        select: {
          id: true,
          organizationId: true,
          title: true,
          description: true,
          location: true,
          remotePolicy: true,
          contractType: true,
          salary: true,
          positions: true,
          priority: true,
          settings: true,
          createdAt: true,
          company: { select: { id: true, name: true } },
          unit: { select: { name: true } },
          organization: { select: { name: true, logo: true } },
          jobProfile: {
            select: { competencies: true, requirements: true },
          },
        },
      }),
      db.application.count({
        where: { vacancyId: input.id },
      }),
    ]);
    return { ...vacancy, applicantCount };
  }),

  // Get a presigned S3 POST for the candidate to upload a CV directly, before
  // applying. Server-enforced size cap + content-type via the POST policy's
  // conditions (not merely trusted from the client).
  getCvUploadUrl: publicProcedure
    .input(
      z.object({
        vacancyId: z.string().uuid(),
        fileName: z.string().min(1).max(255),
        contentType: z.enum(CV_ALLOWED_CONTENT_TYPES),
      }),
    )
    .mutation(async ({ input }) => {
      const vacancy = await db.vacancy.findFirstOrThrow({
        where: { id: input.vacancyId, status: 'published', deletedAt: null },
        select: { organizationId: true },
      });
      return createCvUploadPresignedPost(vacancy.organizationId, input.contentType);
    }),

  // Apply to a vacancy (public — creates candidate + application)
  applyToVacancy: publicProcedure
    .input(
      z.object({
        vacancyId: z.string().uuid(),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        email: z.string().email().max(320),
        phone: z.string().max(30).optional(),
        source: z.string().max(50).default('portal'),
        linkedinUrl: z.string().url().max(2048).optional(),
        currentTitle: z.string().max(200).optional(),
        currentCompany: z.string().max(200).optional(),
        yearsExperience: z.number().int().min(0).max(50).optional(),
        location: z.string().max(200).optional(),
        coverLetter: z.string().max(5000).optional(),
        cvFileKey: z.string().max(500).optional(),
        cvFileName: z.string().min(1).max(255).optional(),
        captchaToken: z.string().max(4096).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!(await verifyCaptcha(input.captchaToken))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Verificacion de seguridad fallida. Recarga la pagina e intenta de nuevo.',
        });
      }

      const vacancy = await db.vacancy.findFirstOrThrow({
        where: { id: input.vacancyId, status: 'published', deletedAt: null },
        include: { stages: { where: { isDefault: true }, take: 1 } },
      });

      const orgId = vacancy.organizationId;

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
          yearsExperience: input.yearsExperience,
          location: input.location,
        },
        update: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          linkedinUrl: input.linkedinUrl,
          currentTitle: input.currentTitle,
          currentCompany: input.currentCompany,
          yearsExperience: input.yearsExperience,
          location: input.location,
        },
      });

      // Idempotent: a candidate may only have one application per vacancy
      // (DB enforces @@unique([candidateId, vacancyId])). Re-submitting the public
      // form returns the existing application instead of throwing a 500.
      const existing = await db.application.findFirst({
        where: { candidateId: candidate.id, vacancyId: vacancy.id },
        select: { id: true },
      });
      if (existing) {
        return { applicationId: existing.id, candidateId: candidate.id };
      }

      const defaultStage = vacancy.stages[0];
      const stageId =
        defaultStage?.id ??
        (
          await db.pipelineStage.findFirstOrThrow({
            where: { vacancyId: vacancy.id },
            orderBy: { order: 'asc' },
            select: { id: true },
          })
        ).id;

      try {
        const application = await db.application.create({
          data: {
            organizationId: orgId,
            candidateId: candidate.id,
            vacancyId: vacancy.id,
            currentStageId: stageId,
            source: input.source,
            coverLetter: input.coverLetter,
          },
        });

        // Only NEW applications get CV processing — the idempotent-duplicate
        // early-return above and the P2002 race-catch below intentionally
        // skip it, so a resubmit never re-runs S3 fetch + extraction + an AI call.
        if (input.cvFileKey) {
          await portalApplicationService.processCvUpload(
            orgId,
            candidate.id,
            input.cvFileKey,
            input.cvFileName ?? input.cvFileKey.split('/').pop() ?? 'cv',
          );
        }

        return { applicationId: application.id, candidateId: candidate.id };
      } catch (err) {
        // Unique-constraint race on concurrent double-submit — resolve idempotently
        if ((err as { code?: string }).code === 'P2002') {
          const app = await db.application.findFirst({
            where: { candidateId: candidate.id, vacancyId: vacancy.id },
            select: { id: true },
          });
          if (app) return { applicationId: app.id, candidateId: candidate.id };
        }
        throw err;
      }
    }),
});
