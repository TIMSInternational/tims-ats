import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';

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

      const where: Prisma.OfferWhereInput = {
        organizationId: ctx.user.organizationId,
        ...(filters.vacancyId && { vacancyId: filters.vacancyId }),
        ...(filters.candidateId && { candidateId: filters.candidateId }),
        ...(filters.status && { status: filters.status }),
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

      return { items, total, page, pageSize };
    }),

  // 9.2 — Get offer by ID
  getById: permissionProcedure('offer', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
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

      return offer;
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
        benefits: z.record(z.unknown()).optional(),
        terms: z.record(z.unknown()).optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { benefits, terms, ...rest } = input;
      return db.offer.create({
        data: {
          ...rest,
          benefits: benefits as Prisma.InputJsonValue | undefined,
          terms: terms as Prisma.InputJsonValue | undefined,
          organizationId: ctx.user.organizationId,
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
        benefits: z.record(z.unknown()).optional(),
        terms: z.record(z.unknown()).optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await db.offer.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
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
      return db.offer.update({
        where: { id },
        data: {
          ...rest,
          ...(benefits !== undefined && { benefits: benefits as Prisma.InputJsonValue }),
          ...(terms !== undefined && { terms: terms as Prisma.InputJsonValue }),
        },
      });
    }),
});
