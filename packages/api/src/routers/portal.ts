import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { db } from '@tims/db';
import { captchaBypassAllowed } from './portal-helpers';
import { createCvUploadPresignedPost } from '../lib/s3';
import { CV_ALLOWED_CONTENT_TYPES } from '../lib/cv-extraction';
import { portalApplicationService } from '../services/portal-application.service';
import { APPLICATION_CONSENT_TEXT_VERSION, APPLICATION_CONSENT_TYPE } from '@tims/shared';

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
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = z.object({ success: z.boolean() }).safeParse(await res.json());
    return data.success && data.data.success;
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
  getVacancy: publicProcedure
    .input(z.object({ id: z.string().uuid(), orgSlug: z.string().trim().min(1).max(200) }))
    .query(async ({ input }) => {
      const vacancy = await db.vacancy.findFirst({
        where: {
          id: input.id,
          status: 'published',
          deletedAt: null,
          organization: { is: { slug: input.orgSlug } },
        },
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
      });
      if (!vacancy) return null;
      const applicantCount = await db.application.count({ where: { vacancyId: vacancy.id } });
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
        // Explicit, prior data-processing authorization (Ley 1581). Required: a submission
        // without it — or against a superseded consent text — is rejected before any write.
        consentAccepted: z.literal(true, {
          errorMap: () => ({ message: 'Debes autorizar el tratamiento de tus datos personales para aplicar.' }),
        }),
        consentTextVersion: z.literal(APPLICATION_CONSENT_TEXT_VERSION, {
          errorMap: () => ({ message: 'El texto de autorización cambió. Recarga la página e intenta de nuevo.' }),
        }),
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

      let result: { applicationId: string; candidateId: string; isNew: boolean };
      try {
        // Candidate, consent evidence and application commit atomically: an application
        // never exists without the authorization that allowed its data to be processed.
        result = await db.$transaction(async (tx) => {
          const candidate = await tx.candidate.upsert({
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
            // This endpoint is unauthenticated. Knowing an email address must not
            // let a submitter overwrite an existing candidate's profile.
            update: {},
            select: { id: true },
          });

          // Record the explicit authorization (subject = candidate id, the same soft
          // reference ai-interview consent uses). INSERT-IF-ABSENT ONLY: this endpoint is
          // unauthenticated, so knowing a candidate's email must never let a submitter
          // rewrite existing consent evidence — not the agreed text version, not agreedAt,
          // and never a withdrawal. `update: {}` leaves an existing row byte-for-byte intact.
          const consent = await tx.dataConsent.upsert({
            where: {
              subjectUserId_consentType: { subjectUserId: candidate.id, consentType: APPLICATION_CONSENT_TYPE },
            },
            create: {
              organizationId: orgId,
              subjectUserId: candidate.id,
              consentType: APPLICATION_CONSENT_TYPE,
              textVersion: input.consentTextVersion,
              agreedAt: new Date(),
            },
            update: {},
            select: { withdrawnAt: true },
          });

          // A withdrawn authorization blocks any further processing of this person's data:
          // no new application and (because this throws before the transaction commits and
          // before the post-commit CV step) no CV fetch/extraction/AI call. Re-granting
          // consent needs a channel that verifies the data subject, which this one cannot.
          // The message deliberately does not confirm that a withdrawal exists.
          if (consent.withdrawnAt) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message:
                'No podemos procesar tu postulación con este correo. Si revocaste la autorización de tratamiento de datos, contacta directamente a la empresa.',
            });
          }

          // Idempotent: a candidate may only have one application per vacancy
          // (DB enforces @@unique([candidateId, vacancyId])). Re-submitting the public
          // form returns the existing application instead of throwing a 500.
          const existing = await tx.application.findFirst({
            where: { candidateId: candidate.id, vacancyId: vacancy.id },
            select: { id: true },
          });
          if (existing) {
            return { applicationId: existing.id, candidateId: candidate.id, isNew: false };
          }

          const defaultStage = vacancy.stages[0];
          const stageId =
            defaultStage?.id ??
            (
              await tx.pipelineStage.findFirstOrThrow({
                where: { vacancyId: vacancy.id },
                orderBy: { order: 'asc' },
                select: { id: true },
              })
            ).id;

          const application = await tx.application.create({
            data: {
              organizationId: orgId,
              candidateId: candidate.id,
              vacancyId: vacancy.id,
              currentStageId: stageId,
              source: input.source,
              coverLetter: input.coverLetter,
            },
            select: { id: true },
          });
          return { applicationId: application.id, candidateId: candidate.id, isNew: true };
        });
      } catch (err) {
        // Unique-constraint race on concurrent double-submit — resolve idempotently.
        // (The losing transaction rolled back; the winner committed its own consent row.)
        if ((err as { code?: string }).code === 'P2002') {
          const app = await db.application.findFirst({
            where: { vacancyId: vacancy.id, candidate: { organizationId: orgId, email: input.email } },
            select: { id: true, candidateId: true },
          });
          if (app) return { applicationId: app.id, candidateId: app.candidateId };
        }
        throw err;
      }

      // Only NEW applications get CV processing — the idempotent-duplicate
      // early-return and the P2002 race-catch above intentionally skip it, so a
      // resubmit never re-runs S3 fetch + extraction + an AI call. It runs AFTER the
      // transaction commits so a slow S3/AI call never holds a DB transaction open.
      // The key must belong to THIS org's upload prefix — cvFileKey is client-supplied
      // and otherwise unvalidated, so without this check a candidate could pass an
      // arbitrary key and have the server fetch+process another org's S3 object into
      // their own CandidateDocument row (a cross-tenant leak once a future "download
      // the CV" feature generates a signed GET from fileUrl). Silently skipped, same
      // non-fatal posture as every other CV failure.
      if (result.isNew && input.cvFileKey && input.cvFileKey.startsWith(`cv-uploads/${orgId}/`)) {
        await portalApplicationService.processCvUpload(
          orgId,
          result.candidateId,
          input.cvFileKey,
          input.cvFileName ?? input.cvFileKey.split('/').pop() ?? 'cv',
        );
      }

      return { applicationId: result.applicationId, candidateId: result.candidateId };
    }),
});
