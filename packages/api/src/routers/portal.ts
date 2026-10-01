import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { db } from '@tims/db';
import { captchaBypassAllowed } from './portal-helpers';
import { createCvUploadPresignedPost } from '../lib/s3';
import { CV_ALLOWED_CONTENT_TYPES } from '../lib/cv-extraction';
import { portalApplicationService } from '../services/portal-application.service';
import {
  APPLICATION_CONSENT_LOCALES,
  APPLICATION_CONSENT_TEXT_VERSION,
  APPLICATION_CONSENT_TYPE,
  logger,
} from '@tims/shared';
import { buildApplicationConsentEvidence, writeConsentEvidence } from '../lib/application-consent-evidence';
import { emailService } from '../services/email.service';
import { consumeApplicationEmailQuota } from '../middleware/rate-limit';

// The ONE public response of portal.applyToVacancy, whatever happened server-side.
const APPLY_ACKNOWLEDGMENT = { received: true } as const;

type CandidateMatch = { id: string; email: string; firstName: string; deletedAt: Date | null };
type PortalDbClient = Pick<typeof db, 'candidate'>;

// Prisma compiles `{ equals, mode: 'insensitive' }` to an UNESCAPED `ILIKE` (measured on
// Prisma 6.8.2), so `_` / `%` in a submitted email are wildcards: `a_b@x.com` would match
// `axb@x.com`. Escape them so the query itself is exact, then post-filter on exact
// case-insensitive equality anyway, so correctness never depends on how Prisma compiles it.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

// Every candidate in the org whose email is EXACTLY `email` ignoring case (email must
// already be trimmed + lowercased). Soft-deleted rows are included: callers decide.
async function findCandidatesByExactEmail(
  client: PortalDbClient,
  orgId: string,
  email: string,
): Promise<CandidateMatch[]> {
  const rows = await client.candidate.findMany({
    where: { organizationId: orgId, email: { equals: escapeLikePattern(email), mode: 'insensitive' } },
    select: { id: true, email: true, firstName: true, deletedAt: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  return rows.filter((r) => r.email.trim().toLowerCase() === email);
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

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
        // Locale the consent text was shown in; the server hashes ITS canonical copy (#313).
        consentLocale: z.enum(APPLICATION_CONSENT_LOCALES).default('es'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await verifyCaptcha(input.captchaToken))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Verificacion de seguridad fallida. Recarga la pagina e intenta de nuevo.',
        });
      }

      const vacancy = await db.vacancy.findFirstOrThrow({
        where: { id: input.vacancyId, status: 'published', deletedAt: null },
        include: {
          stages: { where: { isDefault: true }, take: 1 },
          organization: { select: { name: true } },
          company: { select: { language: true } },
        },
      });

      const orgId = vacancy.organizationId;
      // A configured secret means the token was verified above; without one only a
      // non-production bypass let the request through (captchaBypassAllowed).
      const captchaVerified = Boolean(process.env.TURNSTILE_SECRET_KEY);

      // Canonical email identity: new candidates are stored trimmed + lowercased, and
      // existing ones are matched case-insensitively within this org (legacy and
      // staff-entered rows may be mixed case). Without this, `Ana@Example.com` would be
      // a different person from `ana@example.com` and could bypass a withdrawal.
      const email = input.email.trim().toLowerCase();

      type ApplyOutcome =
        // `recipient` = who the application-received email goes to: for a REUSED candidate the
        // stored row's email + first name; for a NEW candidate the form's (validated, trimmed,
        // lowercased) email + first name — the email is capped per recipient and the name is
        // greeting-sanitized by the template.
        | { kind: 'new'; candidateId: string; recipient: { email: string; firstName: string } }
        | { kind: 'duplicate' }
        | { kind: 'withdrawn' }
        | { kind: 'deleted' };

      // Candidate, consent evidence and application commit atomically: an application
      // never exists without the authorization that allowed its data to be processed.
      const attemptApply = () =>
        db.$transaction(async (tx): Promise<ApplyOutcome> => {
          // Exact case-insensitive matches only — never a wildcard neighbour.
          const variants = await findCandidatesByExactEmail(tx, orgId, email);
          const variantIds = variants.map((v) => v.id);

          // Serialize with a concurrent consent withdrawal of the same candidate(s): the C# withdrawal takes
          // the same transaction-scoped advisory lock (hashtextextended(<candidate id>, 0)), so an application
          // cannot commit on a consent that is being revoked at that instant. Sorted → no lock-order deadlock.
          for (const id of [...variantIds].sort()) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
          }

          // A withdrawn application consent on ANY case-variant of this email — including
          // a soft-deleted one — blocks further processing: no candidate write, no consent
          // write, no application, no CV processing.
          if (variantIds.length > 0) {
            const withdrawn = await tx.dataConsent.findFirst({
              where: {
                organizationId: orgId,
                consentType: APPLICATION_CONSENT_TYPE,
                subjectUserId: { in: variantIds },
                withdrawnAt: { not: null },
              },
              select: { id: true },
            });
            if (withdrawn) return { kind: 'withdrawn' as const };
          }

          // Soft-deleted candidates are never reused or revived from this unauthenticated
          // form, and (orgId, email) is unique so a fresh row cannot be created beside one
          // either: when every match is soft-deleted the submission is acknowledged with
          // no writes (a staff decision removed that record).
          const active = variants.filter((v) => v.deletedAt === null);
          if (variants.length > 0 && active.length === 0) return { kind: 'deleted' as const };

          // This endpoint is unauthenticated: an existing candidate's profile is never
          // updated from it, only reused. Every candidate here is an exact case variant.
          const existingCandidate = active.find((v) => v.email === email) ?? active[0];
          const recipient = existingCandidate
            ? { email: existingCandidate.email, firstName: existingCandidate.firstName }
            : { email, firstName: input.firstName };
          const candidateId =
            existingCandidate?.id ??
            (
              await tx.candidate.create({
                data: {
                  organizationId: orgId,
                  firstName: input.firstName,
                  lastName: input.lastName,
                  email,
                  phone: input.phone,
                  source: input.source,
                  poolType: 'applicant',
                  linkedinUrl: input.linkedinUrl,
                  currentTitle: input.currentTitle,
                  currentCompany: input.currentCompany,
                  yearsExperience: input.yearsExperience,
                  location: input.location,
                },
                select: { id: true },
              })
            ).id;

          // Idempotent: one application per candidate per vacancy (DB enforces
          // @@unique([candidateId, vacancyId])). A duplicate writes NOTHING — in particular
          // no consent row, so re-submitting an existing candidate's email never
          // manufactures consent evidence without the new application it authorizes.
          const existing = await tx.application.findFirst({
            where: { candidateId: { in: [candidateId, ...variantIds] }, vacancyId: vacancy.id },
            select: { id: true },
          });
          if (existing) return { kind: 'duplicate' as const };

          // Record the explicit authorization together with the NEW application it covers
          // (subject = candidate id, the soft reference ai-interview consent uses).
          // INSERT-IF-ABSENT ONLY: `update: {}` leaves existing evidence (textVersion,
          // agreedAt, withdrawnAt) intact — an unauthenticated email claim never rewrites it.
          await tx.dataConsent.upsert({
            where: {
              subjectUserId_consentType: { subjectUserId: candidateId, consentType: APPLICATION_CONSENT_TYPE },
            },
            create: {
              organizationId: orgId,
              subjectUserId: candidateId,
              consentType: APPLICATION_CONSENT_TYPE,
              textVersion: input.consentTextVersion,
              agreedAt: new Date(),
            },
            update: {},
            select: { id: true },
          });

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
              candidateId,
              vacancyId: vacancy.id,
              currentStageId: stageId,
              source: input.source,
              coverLetter: input.coverLetter,
            },
            select: { id: true },
          });
          // Per-application consent evidence (#313), same transaction: every application carries
          // proof of the authorization given FOR IT — text version + hash, time, request metadata.
          // Deploy-safe: behind a savepoint, a MISSING table/column (code deployed before migration
          // 20261001120000 was applied) is logged and skipped instead of aborting every application.
          await writeConsentEvidence(
            tx,
            buildApplicationConsentEvidence({
              organizationId: orgId,
              applicationId: application.id,
              candidateId,
              textVersion: input.consentTextVersion,
              locale: input.consentLocale,
              controllerName: vacancy.organization?.name ?? '',
              agreedAt: new Date(),
              headers: ctx.headers,
              captchaVerified,
            }),
          );
          return { kind: 'new' as const, candidateId, recipient };
        });

      let outcome: ApplyOutcome;
      try {
        outcome = await attemptApply();
      } catch (err) {
        // Unique-constraint race on a concurrent submit for the same email. The losing
        // transaction rolled back; the winner committed its own rows.
        if (!isUniqueViolation(err)) throw err;
        const matchIds = (await findCandidatesByExactEmail(db, orgId, email)).map((c) => c.id);
        const app =
          matchIds.length > 0
            ? await db.application.findFirst({
                where: { vacancyId: vacancy.id, candidateId: { in: matchIds } },
                select: { id: true },
              })
            : null;
        // The winner already applied to THIS vacancy → idempotent acknowledgment.
        if (app) return APPLY_ACKNOWLEDGMENT;
        // Otherwise the race was only on the candidate row (e.g. the winner applied to a
        // different vacancy): retry once — the winner's candidate is now visible and is
        // reused. A second failure propagates.
        outcome = await attemptApply();
      }

      if (outcome.kind === 'withdrawn' || outcome.kind === 'deleted') {
        // Refused privately. No PII (no email, no candidate id) in the log line.
        logger.info(
          { component: 'portal', organizationId: orgId, vacancyId: vacancy.id },
          outcome.kind === 'withdrawn'
            ? 'Public application refused: application consent withdrawn'
            : 'Public application refused: candidate record is soft-deleted',
        );
      }

      // "Application received" confirmation — only for a NEW, committed application
      // (duplicate / withdrawn / deleted outcomes and the P2002 idempotent path never
      // send). Fire-and-forget: a mail failure (sync or async) must never fail or delay
      // the application, and — being detached — adds no response-timing signal. It is
      // dispatched before CV processing so a CV failure can never suppress it. The log
      // line carries no PII (no email, no name, no candidate id, no error message).
      // Per-recipient cap: the form chooses the address, so at most one such email per
      // address per 24h platform-wide; a capped or unavailable limiter skips the email
      // (never the application).
      if (outcome.kind === 'new') {
        const confirmation = {
          candidateEmail: outcome.recipient.email,
          candidateName: outcome.recipient.firstName,
          vacancyTitle: vacancy.title,
          companyName: vacancy.organization?.name ?? '',
          locale: vacancy.company?.language?.startsWith('en') ? ('en' as const) : ('es' as const),
        };
        void Promise.resolve()
          .then(async () => {
            let allowed = false;
            try {
              allowed = await consumeApplicationEmailQuota(confirmation.candidateEmail);
            } catch {
              allowed = false;
            }
            if (!allowed) {
              logger.info(
                { component: 'portal', vacancyId: vacancy.id },
                'Application confirmation email skipped: per-recipient cap reached or limiter unavailable',
              );
              return;
            }
            await emailService.sendApplicationReceived(confirmation);
          })
          .catch((error: unknown) => {
            logger.warn(
              { component: 'portal', vacancyId: vacancy.id, errName: error instanceof Error ? error.name : 'UnknownError' },
              'Application confirmation email failed — application unaffected',
            );
          });
      }

      // Only NEW applications get CV processing — duplicates, the P2002 race-catch and
      // withdrawn refusals intentionally skip it, so a resubmit never re-runs S3 fetch +
      // extraction + an AI call. It runs AFTER the transaction commits so a slow S3/AI
      // call never holds a DB transaction open.
      // The key must belong to THIS org's upload prefix — cvFileKey is client-supplied
      // and otherwise unvalidated, so without this check a candidate could pass an
      // arbitrary key and have the server fetch+process another org's S3 object into
      // their own CandidateDocument row (a cross-tenant leak once a future "download
      // the CV" feature generates a signed GET from fileUrl). Silently skipped, same
      // non-fatal posture as every other CV failure.
      if (outcome.kind === 'new' && input.cvFileKey && input.cvFileKey.startsWith(`cv-uploads/${orgId}/`)) {
        await portalApplicationService.processCvUpload(
          orgId,
          outcome.candidateId,
          input.cvFileKey,
          input.cvFileName ?? input.cvFileKey.split('/').pop() ?? 'cv',
        );
      }

      // New, duplicate, withdrawn- and deleted-refused submissions all get the SAME public
      // acknowledgment, so the response BODY never reveals whether an email belongs to an
      // existing candidate, already applied, or withdrew consent. (Response timing still
      // can: only a new application runs synchronous CV processing — tracked follow-up.)
      return APPLY_ACKNOWLEDGMENT;
    }),
});
