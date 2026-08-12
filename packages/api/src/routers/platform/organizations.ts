import { z } from 'zod';
import { router } from '../../trpc';
import { db, SubscriptionStatus, OrgPlan, InvitationStatus, InvoiceStatus } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { notify } from '../../lib/notify';
import { platformProcedure } from './_common';
import { provisionOrgDefaults, provisionOrgEntitlements } from '../../services/org-provisioning';

// ─────────────────────────────────────────────────────────────────────────────
// REFORMATTED 2026-08-11. This file did not satisfy `prettier --check` before that date, so the #207
// edit reflowed the whole file — legitimate in itself, but it moved every line below ~29 and thereby
// invalidated 111 of the 113 `organizations.ts:NNN` citations that the C#, parity and docs trees hold
// against it. On a DARK surface those `file:line` pointers ARE the verification record: they are how a
// reviewer checks that the C# port matches the TS it claims to port, and there is no running system to
// fall back on. All 113 were re-derived and rewritten in the same change, by aligning the pre- and
// post-reformat files line-by-line rather than by re-reading each citation's intent.
//
// IF YOU REFLOW THIS FILE AGAIN, RE-DERIVE THEM AGAIN:
//   git grep -c 'organizations\.ts:[0-9]' -- services scripts docs tests packages apps
// A partially-updated citation set is WORSE than a wholly stale one, because a reader cannot tell which
// pointers to trust.
// ─────────────────────────────────────────────────────────────────────────────
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
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        page: z.number().int().min(0).default(0),
        limit: z.number().min(1).max(50).default(20),
        search: z.string().max(200).optional(),
        plan: z.string().max(50).optional(),
        status: z.string().max(50).optional(),
        sortBy: z.enum(['name', 'plan', 'createdAt', 'users']).optional(),
        sortDir: z.enum(['asc', 'desc']).optional(),
      }),
    )
    .query(async ({ input }) => {
      const { cursor, page, limit, search, plan, status } = input;

      const where: Record<string, unknown> = {};
      if (search)
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
        ];
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
          // `orderBy` added 2026-08-11 (#211): NEITHER stack ordered this array, so any org with two
          // or more pending invoices could diff on row order alone once the C# `pendingInvoices` key
          // was renamed to `invoices` and the two became comparable. Fixed on both sides rather than
          // with `sortArraysBy: 'id'` on this surface, which normalize.ts applies at EVERY array depth
          // and would therefore also sort the top-level `organizations[]` — silently retiring the
          // createdAt-desc ordering and pagination comparison. The C# counterpart is
          // PlatformOrganizationsReadRepository.cs's ordinal-string OrderBy over the same ids.
          invoices: {
            where: { status: InvoiceStatus.pending },
            orderBy: { id: 'asc' },
            select: { id: true, dueDate: true },
          },
        },
      });

      const total = await db.organization.count({ where });

      return { organizations: orgs, total };
    }),

  getOrganization: platformProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const org = await db.organization.findUnique({
      where: { id: input.id },
      include: {
        companies: { include: { businessUnits: { include: { teams: true } } } },
        users: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            jobTitle: true,
            isActive: true,
            lastLoginAt: true,
            isPlatformOwner: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        subscription: true,
        featureFlags: true,
        billingProfile: true,
        _count: {
          select: {
            users: true,
            vacancies: true,
            invoices: true,
            invitations: { where: { status: { in: [InvitationStatus.pending, InvitationStatus.sent] } } },
          },
        },
      },
    });
    if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
    return org;
  }),

  createOrganization: platformProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
        slug: z
          .string()
          .min(2)
          .max(50)
          .regex(/^[a-z0-9-]+$/),
        plan: z.enum(['trial', 'starter', 'professional', 'enterprise']),
        // BOUNDED 2026-08-11 (#207). RFC 5321 §4.5.3.1.3 caps the Path (`<address>`) at 256 octets
        // INCLUDING the angle brackets, so a deliverable address itself is <= 254. Both fields were
        // previously unbounded, which violates `.claude/rules/api-security.md` ("no unbounded
        // z.string()"). BEHAVIOUR CHANGE: an address longer than 254 was accepted before and is now
        // rejected with a 400. 254 rather than the repo's more common `.max(255)` because 255 is not
        // derived from any standard.
        //
        // WHAT THIS DOES *NOT* CLOSE — corrected 2026-08-11, an earlier version of this comment called
        // `createOrgInvitation` "the OTHER writer" (singular). `organizations.billing_email` has FOUR
        // writers, and after #207 they carry bounds 254 / 254 / UNBOUNDED / UNBOUNDED:
        //   1. this procedure                                            — 254
        //   2. `platform/invitations.ts` createOrgInvitation             — 254 (lowered from 255 here)
        //   3. `routers/organization.ts` update, via `updateOrganizationSchema`
        //      (`packages/shared/src/validators/organization.ts`)         — UNBOUNDED, and behind
        //      `permissionProcedure('organization','update')`, a LOWER privilege bar than this one.
        //      Its `domain` is unbounded too, on a @unique column. Filed as #213.
        //   4. `apps/web/app/auth/callback/route.ts` self-serve company signup, which writes
        //      `supabaseUser.email` with no Zod schema anywhere in the request path — UNBOUNDED.
        // So this change narrows the platform-owner paths only. Do not restate it as "one column, one
        // bound".
        adminEmail: z.string().email().max(254),
        billingEmail: z.string().email().max(254).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: input.name,
            slug: input.slug,
            plan: input.plan,
            billingEmail: input.billingEmail || input.adminEmail,
          },
        });

        // Default Company + BusinessUnit + Team + starter entitlements bundle,
        // so a platform-owner-provisioned org is immediately usable instead of
        // an empty shell that needs manual setup first (Sprint 1.2 onboarding
        // automation). Applies regardless of the legacy OrgPlan value, same
        // precedent as INVU's `provisionInvu` (professional plan, full ats-base
        // bundle) — this is a sane starter default, fully operator-editable
        // afterward via the platform entitlements admin UI.
        await provisionOrgDefaults(tx, org.id, input.name);
        await provisionOrgEntitlements(tx, org.id);

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

      await db.auditLog
        .create({
          data: {
            organizationId: org.id,
            actorId: ctx.user.id,
            action: 'org_created',
            entity: 'organization',
            entityId: org.id,
            changes: JSON.stringify({ name: input.name, slug: input.slug, plan: input.plan }),
          },
        })
        .catch(() => {});

      return org;
    }),

  updateOrganization: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().max(100).optional(),
        plan: z.nativeEnum(OrgPlan).optional(),
        isActive: z.boolean().optional(),
        settings: z
          .object({
            locale: z.string().max(10).optional(),
            timezone: z.string().max(50).optional(),
            currency: z.string().max(10).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const updateData: {
        name?: string;
        plan?: OrgPlan;
        isActive?: boolean;
        settings?: { locale?: string; timezone?: string; currency?: string };
      } = {};
      if (rest.name !== undefined) updateData.name = rest.name;
      if (rest.plan !== undefined) updateData.plan = rest.plan;
      if (rest.isActive !== undefined) updateData.isActive = rest.isActive;
      if (rest.settings !== undefined) updateData.settings = rest.settings;

      const org = await db.organization.update({ where: { id }, data: updateData });

      await db.auditLog
        .create({
          data: {
            organizationId: id,
            actorId: ctx.user.id,
            action: 'org_updated',
            entity: 'organization',
            entityId: id,
            changes: JSON.stringify(rest),
          },
        })
        .catch(() => {});

      return org;
    }),

  suspendOrganization: platformProcedure
    .input(z.object({ id: z.string().uuid(), suspend: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
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

      await db.auditLog
        .create({
          data: {
            organizationId: org.id,
            actorId: ctx.user.id,
            action: input.suspend ? 'org_suspended' : 'org_activated',
            entity: 'organization',
            entityId: org.id,
          },
        })
        .catch(() => {});

      return org;
    }),
});
