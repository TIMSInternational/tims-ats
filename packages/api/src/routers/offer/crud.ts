import { z } from 'zod';
import { router, permissionProcedure, anyPermissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { isZeroDecimalCurrency } from '@tims/shared';
import { scopeWhereFor, assertScoped } from '../../access';
import { redactOfferSettings } from './offer-dto';
import { assertNoOpenOffer, openOfferStatusWhere } from './open-offer-guard';
import { closedApplicationReason, WITHDRAWN_APPLICATION_MESSAGE } from './rejected-application-guard';
import { offerApplicationLockRepository } from '../../repositories/offer-application-lock.repository';
import { resolveDefaultOfferCurrency } from './offer-currency';
import { offerDraftRepository } from '../../repositories/offer-draft.repository';

// ISO-4217-shaped: trimmed and upper-cased so 'cop ' is stored as 'COP'; anything else is rejected
// instead of being stored and later mis-rendered.
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Moneda inválida (código ISO de 3 letras)');
// Annual base salary. Finite and capped so Infinity/1e300 never reach the DB or the rendered letter;
// 1e12 comfortably covers any annual salary in a zero-decimal currency such as COP.
const MAX_OFFER_SALARY = 1_000_000_000_000;
const offerSalary = z.number().finite().positive().max(MAX_OFFER_SALARY, 'Salario fuera de rango');
/** A zero-decimal currency (CRC, COP…) stores whole amounts: 12 000 000.12 colones was an input-step accident. */
const wholeIfZeroDecimal = (salary: number, currency: string) => (isZeroDecimalCurrency(currency) ? Math.round(salary) : salary);

async function defaultCurrencyFor(organizationId: string, vacancyId: string): Promise<string> {
  const { orgSettings, companyCurrency } = await offerDraftRepository.currencySources(organizationId, vacancyId);
  return resolveDefaultOfferCurrency(orgSettings, companyCurrency);
}

export const offerCrudRouter = router({
  // 9.1 — List offers with filters
  list: permissionProcedure('offer', 'read')
    .input(
      z.object({
        vacancyId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        status: z.string().max(50).optional(),
        // Only offers that still occupy their application (the one-open-offer rule of offer.create), so the
        // candidate profile can decide "Crear oferta" vs "Ver oferta" from a short, complete list (A-15).
        openOnly: z.boolean().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, openOnly, ...filters } = input;
      const scopeWhere = await scopeWhereFor('offer', ctx.access, ctx.user.id);

      const where: Prisma.OfferWhereInput = {
        AND: [
          { organizationId: ctx.user.organizationId },
          scopeWhere as Prisma.OfferWhereInput,
          {
            ...(filters.vacancyId && { vacancyId: filters.vacancyId }),
            ...(filters.candidateId && { candidateId: filters.candidateId }),
            ...(filters.status && { status: filters.status }),
          },
          ...(openOnly ? [openOfferStatusWhere(new Date())] : []),
        ],
      };

      const [items, total] = await Promise.all([
        db.offer.findMany({
          where,
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            },
            vacancy: { select: { id: true, title: true } },
            creator: { select: { id: true, firstName: true, lastName: true } },
            approvals: {
              orderBy: { step: 'asc' },
              include: {
                approver: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.offer.count({ where }),
      ]);

      return { items: items.map((o) => redactOfferSettings(o)), total, page, pageSize };
    }),

  // 9.2 — Get offer by ID
  getById: permissionProcedure('offer', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Probe first — the subsequent findFirst uses `include` (no `select`),
      // and Prisma does not support mixing AND scope fragments with `include` in
      // a type-safe way; the two-query pattern keeps the full include block
      // intact while still enforcing scope.
      await assertScoped('offer', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const offer = await db.offer.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          organization: { select: { name: true } },
          candidate: {
            select: {
              id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true,
            },
          },
          // salary/contractType/remotePolicy prefill "Editar borrador" and "Crear nueva oferta"; positions and
          // the converted-offer count let the hire button explain a filled vacancy (F-15) before a click.
          vacancy: {
            select: {
              id: true,
              title: true,
              salary: true,
              contractType: true,
              remotePolicy: true,
              positions: true,
              _count: { select: { offers: { where: { status: 'converted' } } } },
            },
          },
          application: { select: { id: true, status: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          approvals: {
            orderBy: { step: 'asc' },
            include: {
              approver: { select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true } },
            },
          },
          // Who registered the hire and when (offer history, B-19).
          hirePrediction: {
            select: { createdAt: true, hiredBy: { select: { firstName: true, lastName: true } } },
          },
          validations: {
            include: {
              completedByUser: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          legalChecks: {
            include: {
              completedByUser: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      return redactOfferSettings(offer);
    }),

  // 9.3 — Create a new offer
  create: permissionProcedure('offer', 'create')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        vacancyId: z.string().uuid(),
        applicationId: z.string().uuid().optional(),
        salary: offerSalary,
        // Omitted → the organization's currency (resolveDefaultOfferCurrency), never a blind 'USD'.
        currency: currencyCode.optional(),
        startDate: z.date(),
        contractType: z.string().max(100),
        benefits: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
        terms: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.user.organizationId;

      // Probe parent vacancy through scope — ensures the creating user can reach
      // the vacancy under their current scope, not just org-wide.
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, orgId);

      // Candidate and optional application get plain org-checks (not scope-filtered:
      // users are permitted to create offers for any org candidate once the vacancy
      // is in scope).
      const candidate = await db.candidate.findFirst({
        where: { id: input.candidateId, organizationId: orgId },
        select: { id: true },
      });
      if (!candidate) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado en esta organización' });
      if (input.applicationId) {
        await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, orgId);
        const application = await db.application.findFirst({
          where: { id: input.applicationId, organizationId: orgId },
          select: { candidateId: true, vacancyId: true, status: true },
        });
        if (!application || application.candidateId !== input.candidateId || application.vacancyId !== input.vacancyId || application.status !== 'active') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'La postulación no corresponde al candidato y la vacante activos' });
        }
      } else {
        // An offer without the link falls back to the candidate's applications for the vacancy. When the
        // candidate withdrew (C-33) and has no other open application for it, an unlinked offer would re-open a
        // process they left; refuse it here (send/accept/hire refuse it too, see rejected-application-guard).
        const applications = await db.application.findMany({
          where: { organizationId: orgId, candidateId: input.candidateId, vacancyId: input.vacancyId },
          select: { status: true },
        });
        if (closedApplicationReason(applications.map((application) => application.status)) === 'withdrawn') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: WITHDRAWN_APPLICATION_MESSAGE });
        }
      }

      const { benefits, terms, currency, ...rest } = input;
      const resolvedCurrency = currency ?? (await defaultCurrencyFor(orgId, input.vacancyId));
      // One open offer per candidate and vacancy (B-04): checked under a lock on the candidate row, in the
      // same transaction as the insert, so two concurrent creates cannot both pass.
      const created = await offerApplicationLockRepository.inTransaction(orgId, async (tx) => {
        await assertNoOpenOffer(tx, { organizationId: orgId, candidateId: input.candidateId, vacancyId: input.vacancyId });
        return offerDraftRepository.createDraft(tx, {
          ...rest,
          salary: wholeIfZeroDecimal(rest.salary, resolvedCurrency),
          currency: resolvedCurrency,
          benefits: benefits as Prisma.InputJsonValue | undefined,
          terms: terms as Prisma.InputJsonValue | undefined,
          organizationId: orgId,
          createdById: ctx.user.id,
          status: 'draft',
        });
      });
      return redactOfferSettings(created);
    }),

  // 9.4 — Update an offer (only while in draft). offer:create (recruiters) suffices, like submitForApproval
  // and withdraw: a draft has not been approved, so editing it grants nothing that creating a new draft (after
  // withdrawing this one) does not already allow, and any change still needs approval before it can be sent.
  // Approved, sent and later offers stay frozen for everyone.
  update: anyPermissionProcedure('offer', ['update', 'create'])
    .input(
      z.object({
        id: z.string().uuid(),
        salary: offerSalary.optional(),
        currency: currencyCode.optional(),
        startDate: z.date().optional(),
        contractType: z.string().max(100).optional(),
        benefits: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
        terms: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const scopeWhere = await scopeWhereFor('offer', ctx.access, ctx.user.id);

      // Compose scope into the business findFirst — it also fetches the `status`
      // field used by the draft-guard below, so we cannot replace it with a
      // bare assertScoped (would lose that field).
      const existing = await db.offer.findFirst({
        where: {
          AND: [
            { id, organizationId: ctx.user.organizationId },
            scopeWhere as Prisma.OfferWhereInput,
          ],
        },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      if (existing.status !== 'draft') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden editar ofertas en estado borrador',
        });
      }

      const { benefits, terms, ...rest } = data;
      // Compare-and-set on draft: a submission for approval that lands between the check above and this
      // write must not let the approvers see terms other than the ones they are asked to approve.
      const applied = await offerDraftRepository.updateDraft(ctx.user.organizationId, id, {
        ...rest,
        ...(rest.salary !== undefined && rest.currency !== undefined && { salary: wholeIfZeroDecimal(rest.salary, rest.currency) }),
        ...(benefits !== undefined && { benefits: benefits as Prisma.InputJsonValue }),
        ...(terms !== undefined && { terms: terms as Prisma.InputJsonValue }),
      });
      if (!applied) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'La oferta ya no está en borrador; recarga la página para ver su estado actual',
        });
      }
      return offerDraftRepository.findEdited(ctx.user.organizationId, id);
    }),
});
