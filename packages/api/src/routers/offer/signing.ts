import { z } from 'zod';
import { router, publicProcedure, anyPermissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import crypto from 'crypto';
import { emailService } from '../../services/email.service';
import { candidateConsentRepository } from '../../repositories/candidate-consent.repository';
import { scopeWhereFor, buildAccessForUser } from '../../access';
import { runUnscopedLogged } from '../../lib/unscoped';

// The address a signing token was issued to, compared on re-send (see generateSigningLink).
function normaliseRecipient(email: string): string {
  return email.trim().toLowerCase();
}

// The emailed signing URL is a live bearer token (salary/terms + accept/decline), so in production it
// must never travel over plain http (#322). http is tolerated outside production, and for a loopback
// host (a local `next start` runs with NODE_ENV=production; a loopback link never leaves the machine).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
function isAllowedSigningOrigin(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return process.env.NODE_ENV !== 'production' || LOOPBACK_HOSTS.has(url.hostname);
}

// Public signing-token procedures run with NO tenant in scope (the candidate has no
// session and the org is unknown until the token resolves an offer), and `db` here is
// tenantDb, which fails closed without one. The token lookup is cross-tenant by nature,
// so these procedures opt in explicitly — same unscoped behavior as before the guard.
const signingTokenProcedure = publicProcedure.use(({ next }) =>
  runUnscopedLogged('offer-signing-token', () => next()),
);

export const offerSigningRouter = router({
  // Generate a unique signing link for an offer. offer:create (recruiters) suffices to send an APPROVED
  // offer — the body never edits terms, which stays offer:update. Re-sending an already-SENT offer (which
  // re-emails the live bearer token) stays offer:update only; see the create-only guard below.
  generateSigningLink: anyPermissionProcedure('offer', ['update', 'create'])
    .input(z.object({ offerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('offer', ctx.access, ctx.user.id);

      // Compose scope into the business findFirst — it fetches candidate email
      // and vacancy title consumed by the email send below, so we cannot replace
      // it with a bare assertScoped (would lose those fields).
      const offer = await db.offer.findFirst({
        where: {
          AND: [
            { id: input.offerId, organizationId: ctx.user.organizationId },
            scopeWhere as Prisma.OfferWhereInput,
          ],
        },
        select: {
          id: true, status: true, settings: true, updatedAt: true, expiresAt: true, sentAt: true,
          candidate: { select: { id: true, firstName: true, lastName: true, email: true, updatedAt: true } },
          vacancy: { select: { title: true } },
        },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }
      // #312: a candidate who revoked their data-processing authorization gets no further emails.
      if (await candidateConsentRepository.isRecruitmentConsentWithdrawn(ctx.user.organizationId, offer.candidate.id)) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'consent_withdrawn' });
      }

      if (offer.status !== 'approved' && offer.status !== 'sent') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden enviar ofertas aprobadas o ya enviadas',
        });
      }

      if (!offer.candidate.email) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'El candidato no tiene correo electrónico' });
      }
      if (offer.expiresAt && offer.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta oferta ha expirado' });
      }

      // The emailed URL IS the candidate's bearer token (anyone holding it can accept/decline — offer-dto.ts),
      // and the recipient is whatever candidate.email says NOW — which candidate:update (recruiters hold it
      // org-wide) can rewrite. So a caller authorized only through the offer:create widening may send an
      // offer exactly once, to the address it had when it entered the approval chain:
      //  - never re-send a SENT offer: that re-emails the LIVE token, so an edited email would hand a copy of
      //    a working link to someone other than the candidate (#304 panel, HIGH);
      //  - never send if the candidate row changed after the latest submission for approval (or if there is
      //    no approval chain to anchor on): the approvers approved an offer to the address it had then.
      // Both refusals are fail-closed; an offer:update holder (HR admin) can still send or re-send.
      const holdsOfferUpdate = (await buildAccessForUser(ctx.user, 'offer', 'update')).allowed;
      if (!holdsOfferUpdate) {
        if (offer.status === 'sent') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Solo un usuario con permiso para editar ofertas puede reenviar una oferta ya enviada',
          });
        }
        const latestSubmission = await db.offerApproval.findFirst({
          where: { offerId: offer.id, organizationId: ctx.user.organizationId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        if (!latestSubmission || offer.candidate.updatedAt > latestSubmission.createdAt) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'Los datos del candidato cambiaron después de solicitar la aprobación; un usuario con permiso para editar ofertas debe enviarla',
          });
        }
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!baseUrl) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'La URL pública de la aplicación no está configurada' });
      }
      let appUrl: URL;
      try {
        appUrl = new URL(baseUrl);
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'La URL pública de la aplicación no es válida' });
      }
      if (!isAllowedSigningOrigin(appUrl)) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'La URL pública de la aplicación no es válida' });
      }

      const org = await db.organization.findFirst({
        where: { id: ctx.user.organizationId },
        select: { name: true },
      });
      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organización no encontrada' });
      }

      const existingSettings = (offer.settings as Record<string, unknown>) ?? {};
      // A retry to the SAME recipient must reuse the same bearer link so a prior provider-accepted
      // message cannot point to a newly invalidated token. But the recipient is whatever candidate.email
      // says now: if it changed since the token was minted (e.g. a typo'd address was corrected), the
      // copy already delivered to the old address is a working bearer link to salary/terms and to
      // accept/decline. So reuse only when the token was issued to this exact (normalised) address;
      // otherwise — including legacy rows that never recorded a recipient — rotate, which kills the old
      // link. Rotation goes through the same compare-and-set as the first send.
      const recipient = normaliseRecipient(offer.candidate.email);
      const existingToken = existingSettings.signingToken;
      const reusableToken = offer.status === 'sent'
        && typeof existingToken === 'string' && existingToken.length > 0
        && existingSettings.signingTokenRecipient === recipient
        ? existingToken : null;
      const signingToken = reusableToken
        ? reusableToken
        : crypto.randomUUID();

      if (!reusableToken) {
        const transition = await db.offer.updateMany({
          where: {
            id: offer.id,
            organizationId: ctx.user.organizationId,
            status: offer.status,
            updatedAt: offer.updatedAt,
          },
          data: {
            status: 'sent',
            sentAt: offer.sentAt ?? new Date(),
            settings: { ...existingSettings, signingToken, signingTokenRecipient: recipient },
          },
        });
        if (transition.count !== 1) {
          throw new TRPCError({ code: 'CONFLICT', message: 'La oferta cambió mientras se preparaba el enlace. Vuelve a intentarlo.' });
        }
      }

      const signingUrl = `/offers/sign/${signingToken}`;
      const emailDeliveryAccepted = await emailService.sendOfferToCandidate({
        candidateEmail: offer.candidate.email,
        candidateName: `${offer.candidate.firstName} ${offer.candidate.lastName}`,
        vacancyTitle: offer.vacancy?.title ?? '',
        companyName: org.name,
        signingUrl: new URL(signingUrl, appUrl).toString(),
        expiresAt: offer.expiresAt,
      });

      // Only callers who could already generate links before the offer:create widening (offer:update)
      // get the bearer link back; a recruiter authorized via offer:create alone triggers the email but
      // never sees the token.
      return {
        signingUrl: holdsOfferUpdate ? signingUrl : null,
        emailDeliveryAccepted,
        candidateEmail: offer.candidate.email,
      };
    }),

  // PUBLIC: Get offer data by signing token (no auth required)
  getBySigningToken: signingTokenProcedure
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
  acceptByToken: signingTokenProcedure
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

      // Atomic conditional transition: only the request that still sees status
      // 'sent' wins. `updateMany` matches 0 rows for a concurrent second accept
      // (status already flipped), so two clicks can't both be accepted (TOCTOU).
      const transition = await db.offer.updateMany({
        // The token is re-checked at the transition, not only at lookup: a re-send that rotated it in
        // between (recipient changed) must leave the superseded link unable to accept/decline.
        where: { id: offer.id, status: 'sent', settings: { path: ['signingToken'], equals: input.token } },
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
      if (transition.count !== 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esta oferta ya fue respondida o no esta disponible para firma',
        });
      }

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
  declineByToken: signingTokenProcedure
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

      // Atomic conditional transition (see acceptByToken): guards against a
      // concurrent accept/decline race — only the request still seeing 'sent' wins.
      const transition = await db.offer.updateMany({
        // The token is re-checked at the transition, not only at lookup: a re-send that rotated it in
        // between (recipient changed) must leave the superseded link unable to accept/decline.
        where: { id: offer.id, status: 'sent', settings: { path: ['signingToken'], equals: input.token } },
        data: {
          status: 'declined',
          respondedAt: now,
          settings: {
            ...existingSettings,
            declinedAt: now.toISOString(),
          },
        },
      });
      if (transition.count !== 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esta oferta ya fue respondida',
        });
      }

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
