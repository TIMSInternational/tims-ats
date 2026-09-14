import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { resolveStaffSupabaseUserId } from '../../services/staff-provisioning.service';
import { DEFAULT_ONBOARDING_TASKS } from '../../services/onboarding-defaults';
import { hirePredictionService } from '../../services/hire-prediction.service';
import { scopeWhereFor } from '../../access';

export const offerLifecycleRouter = router({
  // NOTE: offer send + e-signature live in offer/signing.ts — the REAL flow
  // (generateSigningLink emails a tokenized link; acceptByToken/declineByToken
  // are the public signing endpoints the offers UI uses). The previous `send`
  // and `generateEsignature` here were unconsumed MOCK duplicates (a fake
  // esign.mock.tims.app URL) shadowing the real flow — removed in Wave 0 to
  // eliminate the dangerous duplication (rule #4).

  // 9.17 — Convert accepted offer to employee (create User from Candidate)
  convertToEmployee: permissionProcedure('offer', 'create')
    .input(
      z.object({
        offerId: z.string().uuid(),
        jobTitle: z.string().max(200),
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('offer', ctx.access, ctx.user.id);

      // Compose scope into the business findFirst — it fetches candidate and
      // vacancy fields consumed downstream (used to create the new User record).
      // Cannot use assertScoped alone as those fields would be lost.
      const offer = await db.offer.findFirst({
        where: {
          AND: [{ id: input.offerId, organizationId: ctx.user.organizationId }, scopeWhere as Prisma.OfferWhereInput],
        },
        include: {
          candidate: true,
          vacancy: { select: { companyId: true, businessUnitId: true, teamId: true } },
        },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      if (offer.status !== 'accepted') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden convertir ofertas aceptadas',
        });
      }

      const candidate = offer.candidate;

      // Check if a user with this email already exists in the org (case-insensitive —
      // matches the resolver's lower(email) auth lookup; avoids a fresh invite +
      // duplicate when only the case differs).
      const existingUser = await db.user.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          email: { equals: candidate.email, mode: 'insensitive' },
        },
      });

      if (existingUser) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Ya existe un empleado con este correo electronico',
        });
      }

      // B2 invite-time linking: stamp the real Supabase identity now (reuses the
      // candidate's existing auth user if they applied via the portal). External
      // call, so it runs before the tx.
      const supabaseUserId = await resolveStaffSupabaseUserId(candidate.email);

      // Read the candidate's current FIT prediction BEFORE the tx (a standalone
      // tenantDb read must not run nested inside the interactive transaction).
      const fitScore = await hirePredictionService.readFitForHire(
        ctx.user.organizationId,
        offer.candidateId,
        offer.vacancyId,
      );

      // runTenantTransaction, not db.$transaction (#45 / prisma#17948): `db` is
      // `tenantDb`, so the outer wrapper never composed and this multi-write hire
      // flow (user + onboarding plan + tasks + offer status) was not atomic.
      return runTenantTransaction(ctx.user.organizationId, async (tx) => {
        // Create the user record, linked to its Supabase identity from birth.
        const newUser = await tx.user.create({
          data: {
            organizationId: ctx.user.organizationId,
            supabaseUserId,
            email: candidate.email,
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            phone: candidate.phone,
            avatar: candidate.avatar,
            jobTitle: input.jobTitle,
            companyId: input.companyId ?? offer.vacancy.companyId,
            businessUnitId: input.businessUnitId ?? offer.vacancy.businessUnitId,
            isActive: true,
          },
        });

        // Auto-create an OnboardingPlan with the default task set so new hires
        // aren't plan-less until someone manually creates one. OnboardingTask has
        // no default/cascade fill for organizationId on the nested relation write,
        // so it's set explicitly on every task.
        await tx.onboardingPlan.create({
          data: {
            organizationId: ctx.user.organizationId,
            userId: newUser.id,
            startDate: new Date(),
            phase: 'day1_30',
            createdById: ctx.user.id,
            tasks: {
              create: DEFAULT_ONBOARDING_TASKS.map((task) => ({
                organizationId: ctx.user.organizationId,
                title: task.title,
                responsible: task.responsible,
                phase: task.phase,
                order: task.order,
              })),
            },
          },
        });

        // Add to team if specified
        const teamId = input.teamId ?? offer.vacancy.teamId;
        if (teamId) {
          await tx.userTeam.create({
            data: {
              userId: newUser.id,
              teamId,
              role: 'member',
            },
          });
        }

        // Update offer status
        await tx.offer.update({
          where: { id: input.offerId },
          data: { status: 'converted' },
        });

        // Sprint 1.1.f — capture an immutable FIT-prediction snapshot at hire time
        // (Quality-of-Hire instrumentation). Always writes one row per hire; the
        // score may be null/partial. Runs inside this tx so it commits atomically
        // with the hire.
        await hirePredictionService.writeSnapshot(tx as unknown as import('@tims/db').Prisma.TransactionClient, {
          organizationId: ctx.user.organizationId,
          userId: newUser.id,
          candidateId: offer.candidateId,
          vacancyId: offer.vacancyId,
          offerId: offer.id,
          applicationId: offer.applicationId,
          hiredById: ctx.user.id,
          fitScore,
        });

        return newUser;
      });
    }),
});
