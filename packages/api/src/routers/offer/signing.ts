import { z } from 'zod';
import { router, publicProcedure, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';
import crypto from 'crypto';

export const offerSigningRouter = router({
  // Generate a unique signing link for an offer
  generateSigningLink: permissionProcedure('offer', 'update')
    .input(z.object({ offerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.offerId, organizationId: ctx.user.organizationId },
        select: { id: true, status: true, settings: true },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      if (offer.status !== 'approved' && offer.status !== 'sent') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden enviar ofertas aprobadas o ya enviadas',
        });
      }

      const signingToken = crypto.randomUUID();
      const existingSettings = (offer.settings as Record<string, unknown>) ?? {};

      await db.offer.update({
        where: { id: input.offerId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          settings: { ...existingSettings, signingToken },
        },
      });

      return {
        signingUrl: `/offers/sign/${signingToken}`,
      };
    }),

  // PUBLIC: Get offer data by signing token (no auth required)
  getBySigningToken: publicProcedure
    .input(z.object({ token: z.string().min(1).max(100) }))
    .query(async ({ input }) => {
      const offers = await db.offer.findMany({
        where: {
          settings: {
            path: ['signingToken'],
            equals: input.token,
          },
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
          sentAt: true,
          expiresAt: true,
          candidate: {
            select: { firstName: true, lastName: true, email: true },
          },
          vacancy: {
            select: { title: true },
          },
          organization: {
            select: { name: true, logo: true },
          },
        },
        take: 1,
      });

      const offer = offers[0];

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Enlace de firma invalido' });
      }

      return offer;
    }),

  // PUBLIC: Accept offer by signing token (no auth required)
  acceptByToken: publicProcedure
    .input(
      z.object({
        token: z.string().min(1).max(100),
        signatureName: z.string().min(2).max(200),
      })
    )
    .mutation(async ({ input }) => {
      const offers = await db.offer.findMany({
        where: {
          settings: {
            path: ['signingToken'],
            equals: input.token,
          },
        },
        select: { id: true, status: true, settings: true },
        take: 1,
      });

      const offer = offers[0];

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Enlace de firma invalido' });
      }

      if (offer.status !== 'sent') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esta oferta ya fue respondida o no esta disponible para firma',
        });
      }

      const existingSettings = (offer.settings as Record<string, unknown>) ?? {};

      await db.offer.update({
        where: { id: offer.id },
        data: {
          status: 'accepted',
          respondedAt: new Date(),
          settings: {
            ...existingSettings,
            signatureName: input.signatureName,
            acceptedAt: new Date().toISOString(),
          },
        },
      });

      return { success: true };
    }),

  // PUBLIC: Decline offer by signing token (no auth required)
  declineByToken: publicProcedure
    .input(z.object({ token: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const offers = await db.offer.findMany({
        where: {
          settings: {
            path: ['signingToken'],
            equals: input.token,
          },
        },
        select: { id: true, status: true, settings: true },
        take: 1,
      });

      const offer = offers[0];

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Enlace de firma invalido' });
      }

      if (offer.status !== 'sent') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esta oferta ya fue respondida',
        });
      }

      const existingSettings = (offer.settings as Record<string, unknown>) ?? {};

      await db.offer.update({
        where: { id: offer.id },
        data: {
          status: 'declined',
          respondedAt: new Date(),
          settings: {
            ...existingSettings,
            declinedAt: new Date().toISOString(),
          },
        },
      });

      return { success: true };
    }),
});
