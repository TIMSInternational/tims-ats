import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { scopeWhereFor, assertScoped } from '../../access';
import { redactOfferSettings } from './offer-dto';

export const offerCrudRouter = router({
  // 9.1 — List offers with filters
  list: permissionProcedure('offer', 'read')
    .input(
      z.object({
        vacancyId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        status: z.string().max(50).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, ...filters } = input;
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
          candidate: {
            select: {
              id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true,
            },
          },
          vacancy: { select: { id: true, title: true } },
          application: { select: { id: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          approvals: {
            orderBy: { step: 'asc' },
            include: {
              approver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
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
        salary: z.number().positive(),
        currency: z.string().max(10).default('USD'),
        startDate: z.date(),
        contractType: z.string().max(100),
        benefits: z.record(z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
        terms: z.record(z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
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
      if (!candidate) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado en esta organizacion' });
      if (input.applicationId) {
        await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, orgId);
      }

      const { benefits, terms, ...rest } = input;
      const created = await db.offer.create({
        data: {
          ...rest,
          benefits: benefits as Prisma.InputJsonValue | undefined,
          terms: terms as Prisma.InputJsonValue | undefined,
          organizationId: orgId,
          createdById: ctx.user.id,
          status: 'draft',
        },
        include: {
          candidate: {
            select: { id: true, firstName: true, lastName: true },
          },
          vacancy: { select: { id: true, title: true } },
        },
      });
      return redactOfferSettings(created);
    }),

  // 9.4 — Update an offer (only while in draft)
  update: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        salary: z.number().positive().optional(),
        currency: z.string().max(10).optional(),
        startDate: z.date().optional(),
        contractType: z.string().max(100).optional(),
        benefits: z.record(z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
        terms: z.record(z.unknown()).refine((v) => JSON.stringify(v ?? {}).length <= 100000, 'Payload demasiado grande').optional(),
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
      const updated = await db.offer.update({
        where: { id },
        data: {
          ...rest,
          ...(benefits !== undefined && { benefits: benefits as Prisma.InputJsonValue }),
          ...(terms !== undefined && { terms: terms as Prisma.InputJsonValue }),
        },
      });
      return redactOfferSettings(updated);
    }),
});
