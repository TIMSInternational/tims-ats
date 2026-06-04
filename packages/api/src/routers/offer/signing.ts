import { z } from 'zod';
import { router, publicProcedure, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';
import crypto from 'crypto';
import { emailService } from '../../services/email.service';

export const offerSigningRouter = router({
  // Generate a unique signing link for an offer
  generateSigningLink: permissionProcedure('offer', 'update')
    .input(z.object({ offerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.offerId, organizationId: ctx.user.organizationId },
        select: {
          id: true, status: true, settings: true,
          candidate: { select: { firstName: true, lastName: true, email: true } },
          vacancy: { select: { title: true } },
        },
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

      const signingUrl = `/offers/sign/${signingToken}`;

      // Fire-and-forget: send offer email to candidate
      const org = await db.organization.findFirst({
        where: { id: ctx.user.organizationId },
        select: { name: true },
      });
      if (offer.candidate.email && org) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.tims.co';
        emailService.sendOfferToCandidate({
          candidateEmail: offer.candidate.email,
          candidateName: `${offer.candidate.firstName} ${offer.candidate.lastName}`,
          vacancyTitle: offer.vacancy?.title ?? '',
          companyName: org.name,
          signingUrl: `${baseUrl}${signingUrl}`,
        });
      }

      return { signingUrl };
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

      // Bound disclosure to the offer's validity window — an expired link must not
      // keep exposing salary/terms/candidate PII indefinitely.
      if (offer.expiresAt && offer.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Este enlace de firma ha expirado' });
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
        select: { id: true, status: true, settings: true, expiresAt: true },
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

      if (offer.expiresAt && offer.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta oferta ha expirado y no puede firmarse' });
      }

      const existingSettings = (offer.settings as Record<string, unknown>) ?? {};
      const now = new Date();

      // Fetch candidate + vacancy + org info for notification
      const fullOffer = await db.offer.findFirst({
        where: { id: offer.id },
        select: {
          organizationId: true,
          candidate: { select: { firstName: true, lastName: true } },
          vacancy: { select: { title: true } },
        },
      });

      await db.offer.update({
        where: { id: offer.id },
        data: {
          status: 'accepted',
          respondedAt: now,
          settings: {
            ...existingSettings,
            signatureName: input.signatureName,
            acceptedAt: now.toISOString(),
          },
        },
      });

      // Fire-and-forget: notify HR team
      if (fullOffer) {
        const org = await db.organization.findFirst({
          where: { id: fullOffer.organizationId },
          select: { name: true },
        });
        const hrUsers = await db.user.findMany({
          where: {
            organizationId: fullOffer.organizationId,
            isActive: true,
            userRoles: { some: { role: { slug: { in: ['hr_admin', 'super_admin'] } } } },
          },
          select: { email: true },
        });
        if (org && hrUsers.length > 0) {
          emailService.notifyOfferAccepted({
            hrEmails: hrUsers.map((u) => u.email),
            recipientName: 'Equipo de RRHH',
            candidateName: `${fullOffer.candidate.firstName} ${fullOffer.candidate.lastName}`,
            vacancyTitle: fullOffer.vacancy?.title ?? '',
            companyName: org.name,
            acceptedAt: now,
          });
        }
      }

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
        select: { id: true, status: true, settings: true, expiresAt: true },
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

      if (offer.expiresAt && offer.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta oferta ha expirado' });
      }

      const existingSettings = (offer.settings as Record<string, unknown>) ?? {};
      const now = new Date();

      // Fetch candidate + vacancy + org info for notification
      const fullOffer = await db.offer.findFirst({
        where: { id: offer.id },
        select: {
          organizationId: true,
          candidate: { select: { firstName: true, lastName: true } },
          vacancy: { select: { title: true } },
        },
      });

      await db.offer.update({
        where: { id: offer.id },
        data: {
          status: 'declined',
          respondedAt: now,
          settings: {
            ...existingSettings,
            declinedAt: now.toISOString(),
          },
        },
      });

      // Fire-and-forget: notify HR team
      if (fullOffer) {
        const org = await db.organization.findFirst({
          where: { id: fullOffer.organizationId },
          select: { name: true },
        });
        const hrUsers = await db.user.findMany({
          where: {
            organizationId: fullOffer.organizationId,
            isActive: true,
            userRoles: { some: { role: { slug: { in: ['hr_admin', 'super_admin'] } } } },
          },
          select: { email: true },
        });
        if (org && hrUsers.length > 0) {
          emailService.notifyOfferDeclined({
            hrEmails: hrUsers.map((u) => u.email),
            recipientName: 'Equipo de RRHH',
            candidateName: `${fullOffer.candidate.firstName} ${fullOffer.candidate.lastName}`,
            vacancyTitle: fullOffer.vacancy?.title ?? '',
            companyName: org.name,
            declinedAt: now,
          });
        }
      }

      return { success: true };
    }),
});
