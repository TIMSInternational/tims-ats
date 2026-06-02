import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const cursorPaginationInput = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const candidateCreateInput = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().email().max(254),
  phone: z.string().max(30).optional(),
  source: z.string().min(1).max(100),
  poolType: z.string().min(1).max(100),
  avatar: z.string().url().max(2048).optional(),
  location: z.string().max(200).optional(),
  currentTitle: z.string().max(200).optional(),
  currentCompany: z.string().max(200).optional(),
  yearsExperience: z.number().int().min(0).optional(),
  skills: z.array(z.string().max(100)).max(50).optional(),
  linkedinUrl: z.string().url().max(2048).optional(),
  notes: z.string().max(5000).optional(),
});

const candidateUpdateInput = candidateCreateInput.partial().extend({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// CRUD sub-router
// ---------------------------------------------------------------------------

export const candidateCrudRouter = router({
  // 6.1 — List candidates with filters + cursor pagination
  list: permissionProcedure('candidate', 'read')
    .input(
      cursorPaginationInput.extend({
        search: z.string().max(200).optional(),
        poolType: z.string().max(100).optional(),
        fitMin: z.number().min(0).max(100).optional(),
        fitMax: z.number().min(0).max(100).optional(),
        tags: z.array(z.string().max(100)).max(50).optional(),
        source: z.string().max(100).optional(),
        skills: z.array(z.string().max(100)).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, search, poolType, tags, source, skills, fitMin, fitMax } = input;

      // Build where clause
      const where: Prisma.CandidateWhereInput = {
        organizationId: ctx.user.organizationId,
        isActive: true,
        deletedAt: null,
      };

      if (poolType) where.poolType = poolType;
      if (source) where.source = source;

      if (search) {
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { currentTitle: { contains: search, mode: 'insensitive' } },
          { currentCompany: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (tags && tags.length > 0) {
        where.tags = { some: { tag: { in: tags } } };
      }

      if (skills && skills.length > 0) {
        // JSON array containment — assumes skills stored as JSON string array
        where.skills = { array_contains: skills };
      }

      // Fit-score range requires a sub-query on fitScores
      if (fitMin !== undefined || fitMax !== undefined) {
        where.fitScores = {
          some: {
            overallScore: {
              ...(fitMin !== undefined ? { gte: fitMin } : {}),
              ...(fitMax !== undefined ? { lte: fitMax } : {}),
            },
          },
        };
      }

      const items = await db.candidate.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          tags: true,
          fitScores: { orderBy: { calculatedAt: 'desc' }, take: 1 },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const extra = items.pop()!;
        nextCursor = extra.id;
      }

      return { items, nextCursor };
    }),

  // 6.2 — Get candidate by ID
  getById: permissionProcedure('candidate', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const candidate = await db.candidate.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.user.organizationId,
          deletedAt: null,
        },
        include: {
          tags: true,
          documents: { orderBy: { uploadedAt: 'desc' } },
          applications: {
            include: {
              vacancy: { select: { id: true, title: true } },
              currentStage: { select: { id: true, name: true } },
            },
          },
          fitScores: { orderBy: { calculatedAt: 'desc' } },
          assessmentAssignments: {
            include: {
              assessmentType: { select: { id: true, name: true, code: true } },
              result: true,
            },
          },
          createdBy: {
            select: { id: true, firstName: true, lastName: true, avatar: true },
          },
        },
      });

      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      return candidate;
    }),

  // 6.3 — Create candidate
  create: permissionProcedure('candidate', 'create')
    .input(candidateCreateInput)
    .mutation(async ({ ctx, input }) => {
      return db.candidate.create({
        data: {
          ...input,
          skills: input.skills ?? undefined,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
      });
    }),

  // 6.4 — Update candidate
  update: permissionProcedure('candidate', 'update')
    .input(candidateUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await db.candidate.findFirst({
        where: { id, organizationId: ctx.user.organizationId, deletedAt: null },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      return db.candidate.update({
        where: { id },
        data: {
          ...data,
          skills: data.skills ?? undefined,
        },
      });
    }),

  // 6.15 — Full-text search candidates
  search: permissionProcedure('candidate', 'read')
    .input(
      z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      return db.candidate.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isActive: true,
          deletedAt: null,
          OR: [
            { firstName: { contains: input.query, mode: 'insensitive' } },
            { lastName: { contains: input.query, mode: 'insensitive' } },
            { email: { contains: input.query, mode: 'insensitive' } },
            { currentTitle: { contains: input.query, mode: 'insensitive' } },
            { currentCompany: { contains: input.query, mode: 'insensitive' } },
          ],
        },
        take: input.limit,
        orderBy: { updatedAt: 'desc' },
        include: { tags: true },
      });
    }),
});
