import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';

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
        jobTitle: z.string(),
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.offerId, organizationId: ctx.user.organizationId },
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

      // Check if a user with this email already exists in the org
      const existingUser = await db.user.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          email: candidate.email,
        },
      });

      if (existingUser) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Ya existe un empleado con este correo electronico',
        });
      }

      return db.$transaction(async (tx) => {
        // Create the user record (supabaseUserId will be set when they first log in)
        const newUser = await tx.user.create({
          data: {
            organizationId: ctx.user.organizationId,
            supabaseUserId: `pending-${candidate.id}`,
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

        return newUser;
      });
    }),
});
