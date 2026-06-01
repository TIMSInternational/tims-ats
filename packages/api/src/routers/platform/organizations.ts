import { z } from 'zod';
import { router } from '../../trpc';
import { db, SubscriptionStatus, OrgPlan, InvitationStatus, InvoiceStatus } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { notify } from '../../lib/notify';
import { platformProcedure } from './_common';

export const organizationsRouter = router({
  getOrganizationKpis: platformProcedure.query(async () => {
    const [total, active, suspended, trialing] = await Promise.all([
      db.organization.count(),
      db.organization.count({ where: { isActive: true } }),
      db.organization.count({ where: { isActive: false } }),
      db.subscription.count({ where: { status: SubscriptionStatus.trialing } }),
    ]);

    const expiringThisWeek = await db.subscription.count({
      where: {
        status: SubscriptionStatus.trialing,
        trialEndsAt: {
          gte: new Date(),
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    });

    return { total, active, suspended, trialing, expiringThisWeek };
  }),

  listOrganizations: platformProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      page: z.number().int().min(0).default(0),
      limit: z.number().min(1).max(50).default(20),
      search: z.string().max(200).optional(),
      plan: z.string().max(50).optional(),
      status: z.string().max(50).optional(),
      sortBy: z.enum(['name', 'plan', 'createdAt', 'users']).optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
    }))
    .query(async ({ input }) => {
      const { cursor, page, limit, search, plan, status } = input;

      const where: Record<string, unknown> = {};
      if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }];
      if (plan) where.plan = plan;
      if (status === 'active') where.isActive = true;
      if (status === 'suspended') where.isActive = false;

      const sortMap: Record<string, Record<string, unknown>> = {
        name: { name: input.sortDir || 'asc' },
        plan: { plan: input.sortDir || 'asc' },
        createdAt: { createdAt: input.sortDir || 'desc' },
        users: { users: { _count: input.sortDir || 'desc' } },
      };
      const orderBy = input.sortBy ? sortMap[input.sortBy] : { createdAt: 'desc' as const };

      const orgs = await db.organization.findMany({
        where,
        take: limit,
        skip: cursor ? 1 : page * limit,
        ...(cursor ? { cursor: { id: cursor } } : {}),
        orderBy,
        include: {
          _count: { select: { users: true, vacancies: true, invoices: true } },
          subscription: { select: { plan: true, status: true, trialEndsAt: true } },
          users: {
            select: { lastLoginAt: true },
            where: { lastLoginAt: { not: null } },
            orderBy: { lastLoginAt: 'desc' },
            take: 1,
          },
          invoices: {
            where: { status: InvoiceStatus.pending },
            select: { id: true, dueDate: true },
          },
        },
      });

      const total = await db.organization.count({ where });

      return { organizations: orgs, total };
    }),

  getOrganization: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const org = await db.organization.findUnique({
        where: { id: input.id },
        include: {
          companies: { include: { businessUnits: { include: { teams: true } } } },
          users: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, isActive: true, lastLoginAt: true, isPlatformOwner: true }, orderBy: { createdAt: 'desc' } },
          subscription: true,
          featureFlags: true,
          billingProfile: true,
          _count: { select: { users: true, vacancies: true, invoices: true, invitations: { where: { status: { in: [InvitationStatus.pending, InvitationStatus.sent] } } } } },
        },
      });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
      return org;
    }),

  createOrganization: platformProcedure
    .input(z.object({
      name: z.string().min(2),
      slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
      plan: z.enum(['trial', 'starter', 'professional', 'enterprise']),
      adminEmail: z.string().email(),
      billingEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      const org = await db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: input.name,
            slug: input.slug,
            plan: input.plan,
            billingEmail: input.billingEmail || input.adminEmail,
          },
        });

        const role = await tx.role.create({
          data: { organizationId: org.id, name: 'Super Administrador', slug: 'super_admin', isSystem: true },
        });

        await tx.subscription.create({
          data: {
            organizationId: org.id,
            plan: input.plan,
            status: input.plan === 'trial' ? 'trialing' : 'active',
            trialEndsAt: input.plan === 'trial' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
          },
        });

        return org;
      });

      await notify({
        type: 'success',
        title: `Nueva organizacion creada: ${org.name}`,
        module: 'platform',
        actionUrl: '/platform/organizations',
        organizationId: org.id,
      });

      return org;
    }),

  updateOrganization: platformProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().max(100).optional(),
      plan: z.nativeEnum(OrgPlan).optional(),
      isActive: z.boolean().optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.organization.update({ where: { id }, data: data as any });
    }),

  suspendOrganization: platformProcedure
    .input(z.object({ id: z.string().uuid(), suspend: z.boolean() }))
    .mutation(async ({ input }) => {
      const org = await db.organization.update({
        where: { id: input.id },
        data: { isActive: !input.suspend },
      });

      if (input.suspend) {
        await notify({
          type: 'warning',
          title: `Organizacion suspendida: ${org.name}`,
          module: 'platform',
          actionUrl: '/platform/organizations',
          organizationId: org.id,
        });
      }

      return org;
    }),
});
