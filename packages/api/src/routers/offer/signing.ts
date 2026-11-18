import { z } from 'zod';
import { router, publicProcedure, anyPermissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import { offerApplicationLockRepository } from '../../repositories/offer-application-lock.repository';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { getAppUrl, orgSettingsTimeZone, resolveInterviewTimeZone } from '@tims/shared';
import { defaultSigningExpiry, normaliseRecipient } from './signing-link';
import crypto from 'crypto';
import { emailService } from '../../services/email.service';
import { candidateContactEmail } from '../../services/candidate-contact';
import { sendOfferResponseNotice } from '../../services/offer-response-notice.service';
import { runAfterResponse } from '../../lib/after-response';
import { sendOfferAcceptedCopy } from '../../services/offer-accepted-copy.service';
import { candidateConsentRepository } from '../../repositories/candidate-consent.repository';
import { scopeWhereFor, buildAccessForUser } from '../../access';
import { runUnscopedLogged } from '../../lib/unscoped';
import { assertNoRejectedApproval } from './rejected-approval-guard';
import { orgTimeZone } from '../../services/interview-email.service';
import { prepareOfferStageAdvance } from '../../services/offer-stage-advance.service';
import {
  assertApplicationNotRejected,
  lockAndAssertApplicationNotRejected,
  notRejectedApplication,
} from './rejected-application-guard';

// Public signing-token procedures run with NO tenant in scope (the candidate has no
// session and the org is unknown until the token resolves an offer), and `db` here is
// tenantDb, which fails closed without one. The token lookup is cross-tenant by nature,
// so these procedures opt in explicitly — same unscoped behavior as before the guard.
const signingTokenProcedure = publicProcedure.use(({ next }) => runUnscopedLogged('offer-signing-token', () => next()));

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
          AND: [{ id: input.offerId, organizationId: ctx.user.organizationId }, scopeWhere as Prisma.OfferWhereInput],
        },
        select: {
          id: true,
          status: true,
          settings: true,
          updatedAt: true,
          expiresAt: true,
          sentAt: true,
          candidate: { select: { id: true, firstName: true, lastName: true, email: true, updatedAt: true } },
          vacancyId: true,
          applicationId: true,
          candidateId: true,
          vacancy: { select: { title: true, company: { select: { timezone: true } } } },
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

      await assertNoRejectedApproval(
        db,
        ctx.user.organizationId,
        offer.id,
        'Esta oferta fue rechazada en su cadena de aprobación y no se puede enviar',
      );
      await assertApplicationNotRejected(
        db,
        ctx.user.organizationId,
        offer.id,
        'El candidato fue descartado en el proceso; esta oferta no se puede enviar',
      );

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

      if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'La URL pública de la aplicación no está configurada',
        });
      }
      let appUrl: URL;
      try {
        appUrl = new URL(getAppUrl());
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'La URL pública de la aplicación no es válida' });
      }

      const org = await db.organization.findFirst({
        where: { id: ctx.user.organizationId },
        select: { name: true, settings: true, billingEmail: true },
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
      const reusableToken =
        offer.status === 'sent' &&
        typeof existingToken === 'string' &&
        existingToken.length > 0 &&
        existingSettings.signingTokenRecipient === recipient
          ? existingToken
          : null;
      const signingToken = reusableToken ? reusableToken : crypto.randomUUID();
      // A first send (or a rotation) of an offer without an expiry gives the link OFFER_LINK_VALIDITY_DAYS;
      // a re-send of the same live link keeps whatever it already has.
      const expiresAt = reusableToken ? offer.expiresAt : (offer.expiresAt ?? defaultSigningExpiry());

      if (!reusableToken) {
        // In one transaction: lock the candidate's application(s) (FOR NO KEY UPDATE first: the send also moves
        // it to the "Oferta" stage), re-check FOR SHARE, then write.
        const transition = await offerApplicationLockRepository.inTransaction(ctx.user.organizationId, async (tx) => {
          const stage = await prepareOfferStageAdvance(tx, ctx.user.organizationId, offer);
          await lockAndAssertApplicationNotRejected(
            tx,
            ctx.user.organizationId,
            offer,
            'El candidato fue descartado en el proceso; esta oferta no se puede enviar',
          );
          const sent = await tx.offer.updateMany({
            where: {
              id: offer.id,
              organizationId: ctx.user.organizationId,
              status: offer.status,
              updatedAt: offer.updatedAt,
              // Re-checked in the same statement as the write: a rejection committed after the guard above
              // makes this match 0 rows.
              ...notRejectedApplication(offer.vacancyId),
            },
            data: {
              status: 'sent',
              sentAt: offer.sentAt ?? new Date(),
              expiresAt,
              settings: { ...existingSettings, signingToken, signingTokenRecipient: recipient },
            },
          });
          if (sent.count === 1) await stage.advance(ctx.user.id); // only a send that happened moves the stage
          return sent;
        });
        if (transition.count !== 1) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'La oferta cambió mientras se preparaba el enlace. Vuelve a intentarlo.',
          });
        }
      }

      if (reusableToken) {
        // Re-send of an existing link performs no offer write, so re-check eligibility right before the
        // email (a rejection may have committed after the guard). Even if one lands after this check, the
        // link cannot be accepted: acceptance re-checks the application in its own write.
        const stillEligible = await db.offer.count({
          where: {
            id: offer.id,
            organizationId: ctx.user.organizationId,
            status: 'sent',
            ...notRejectedApplication(offer.vacancyId),
          },
        });
        if (stillEligible !== 1) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'El candidato fue descartado en el proceso; esta oferta no se puede enviar',
          });
        }
      }

      const signingUrl = `/offers/sign/${signingToken}`;
      const emailDeliveryAccepted = await emailService.sendOfferToCandidate({
        candidateEmail: offer.candidate.email,
        candidateName: `${offer.candidate.firstName} ${offer.candidate.lastName}`,
        vacancyTitle: offer.vacancy?.title ?? '',
        companyName: org.name,
        signingUrl: new URL(signingUrl, appUrl).toString(),
        expiresAt,
        // The validity date reads in the organization's time zone, labelled (E-23).
        timeZone: resolveInterviewTimeZone(orgSettingsTimeZone(org.settings), offer.vacancy?.company?.timezone),
        // The organization's own candidate contact: contact line + Reply-To; omitted when it has none.
        contactEmail: candidateContactEmail(org),
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
            select: { name: true, logo: true, settings: true },
          },
        },
        take: 1,
      });

      const found = offers[0];

      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Enlace de firma inválido' });
      }

      // Bound disclosure to the offer's validity window — an expired link must not
      // keep exposing salary/terms/candidate PII indefinitely.
      if (found.expiresAt && found.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Este enlace de firma ha expirado' });
      }

      // Only the organization's time zone leaves the settings JSON: the signing page formats the
      // start date in it, like the candidate portal does.
      const { organization, ...offer } = found;
      return {
        ...offer,
        organization: { name: organization.name, logo: organization.logo, timeZone: orgTimeZone(organization.settings) },
      };
    }),

  // PUBLIC: Accept offer by signing token (no auth required)
  acceptByToken: signingTokenProcedure
    .input(
      z.object({
        token: z.string().min(1).max(100),
        signatureName: z.string().min(2).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const offers = await db.offer.findMany({
        where: {
          settings: {
            path: ['signingToken'],
            equals: input.token,
          },
        },
        select: {
          id: true,
          organizationId: true,
          vacancyId: true,
          applicationId: true,
          candidateId: true,
          status: true,
          settings: true,
          expiresAt: true,
        },
        take: 1,
      });

      const offer = offers[0];

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Enlace de firma inválido' });
      }

      if (offer.status !== 'sent') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esta oferta ya fue respondida o no está disponible para firma',
        });
      }

      if (offer.expiresAt && offer.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta oferta ha expirado y no puede firmarse' });
      }

      await assertNoRejectedApproval(db, offer.organizationId, offer.id, 'Esta oferta no está disponible para firma');
      await assertApplicationNotRejected(
        db,
        offer.organizationId,
        offer.id,
        'Esta oferta no está disponible para firma',
      );

      const existingSettings = (offer.settings as Record<string, unknown>) ?? {};
      const now = new Date();

      // Atomic conditional transition: only the request that still sees status
      // 'sent' wins. `updateMany` matches 0 rows for a concurrent second accept
      // (status already flipped), so two clicks can't both be accepted (TOCTOU).
      // In one transaction: lock the candidate's application(s) FOR SHARE and re-check (serializes with a
      // concurrent rejection), then the conditional write.
      const transition = await offerApplicationLockRepository.inTransaction(offer.organizationId, async (tx) => {
        await lockAndAssertApplicationNotRejected(
          tx,
          offer.organizationId,
          offer,
          'Esta oferta no está disponible para firma',
        );
        return tx.offer.updateMany({
          // The token is re-checked at the transition, not only at lookup: a re-send that rotated it in
          // between (recipient changed) must leave the superseded link unable to accept/decline.
          // The application is re-checked in the same statement too: a rejection committed after the guard
          // makes this match 0 rows (and conversion re-checks inside its own transaction regardless).
          where: {
            id: offer.id,
            status: 'sent',
            settings: { path: ['signingToken'], equals: input.token },
            ...notRejectedApplication(offer.vacancyId),
          },
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
      });
      if (transition.count !== 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esta oferta ya fue respondida o no está disponible para firma',
        });
      }

      // Notify the staff after the response (never delays or fails the candidate's answer). After the
      // response (see lib/after-response.ts): a bare call was frozen by the serverless runtime once the
      // response was sent, so HR never got the email. Recipients, link and time zone: services/offer-response-notice.service.ts.
      runAfterResponse(ctx, async () => {
        await sendOfferResponseNotice(offer.organizationId, offer.id, { kind: 'accepted', at: now });
        await sendOfferAcceptedCopy(offer.organizationId, offer.id, { at: now, signatureName: input.signatureName }); // C-31
      });

      return { success: true };
    }),

  // PUBLIC: Decline offer by signing token (no auth required)
  declineByToken: signingTokenProcedure
    .input(z.object({ token: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const offers = await db.offer.findMany({
        where: {
          settings: {
            path: ['signingToken'],
            equals: input.token,
          },
        },
        select: {
          id: true,
          organizationId: true,
          vacancyId: true,
          applicationId: true,
          candidateId: true,
          status: true,
          settings: true,
          expiresAt: true,
        },
        take: 1,
      });

      const offer = offers[0];

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Enlace de firma inválido' });
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

      await assertNoRejectedApproval(db, offer.organizationId, offer.id, 'Esta oferta no está disponible');

      const existingSettings = (offer.settings as Record<string, unknown>) ?? {};
      const now = new Date();

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

      // Notify the staff after the response (never delays or fails the candidate's answer); see above.
      runAfterResponse(ctx, () =>
        sendOfferResponseNotice(offer.organizationId, offer.id, { kind: 'declined', at: now }),
      );

      return { success: true };
    }),
});
