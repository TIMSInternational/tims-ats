import { z } from 'zod';
import { router } from '../../trpc';
import { db } from '@tims/db';
import { platformProcedure } from './_common';

export const usersRouter = router({
  getUserKpis: platformProcedure.query(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const [total, activeToday, platformOwners, inactive] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { lastLoginAt: { gte: todayStart } } }),
      db.user.count({ where: { isPlatformOwner: true } }),
      db.user.count({ where: { OR: [{ isActive: false }, { lastLoginAt: { lt: thirtyDaysAgo } }] } }),
    ]);

    return { total, activeToday, platformOwners, inactive };
  }),

  listAllUsers: platformProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().min(1).max(50).default(20),
      search: z.string().optional(),
      organizationId: z.string().uuid().optional(),
      roleSlug: z.string().optional(),
      isPlatformOwner: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const { page, limit, search, organizationId, roleSlug, isPlatformOwner, isActive } = input;

      const where: any = {};
      if (search) where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
      if (organizationId) where.organizationId = organizationId;
      if (isPlatformOwner !== undefined) where.isPlatformOwner = isPlatformOwner;
      if (isActive !== undefined) where.isActive = isActive;
      if (roleSlug) where.userRoles = { some: { role: { slug: roleSlug } } };

      const [users, total] = await Promise.all([
        db.user.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy: { createdAt: 'desc' },
          include: {
            organization: { select: { id: true, name: true } },
            userRoles: { include: { role: { select: { name: true, slug: true } } } },
          },
        }),
        db.user.count({ where }),
      ]);

      return { users, total };
    }),

  listPlatformOwnerEmails: platformProcedure.query(async () => {
    return db.platformOwnerEmail.findMany({ orderBy: { createdAt: 'desc' } });
  }),

  addPlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      return db.platformOwnerEmail.create({ data: { email: input.email } });
    }),

  removePlatformOwnerEmail: platformProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      return db.platformOwnerEmail.delete({ where: { email: input.email } });
    }),
});
