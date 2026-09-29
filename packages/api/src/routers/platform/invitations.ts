import { z } from 'zod';
import { csvRow, getAppUrl } from '@tims/shared';
import { router, publicProcedure } from '../../trpc';
import { db, InvitationType, InvitationStatus } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { sendEmail } from '../../lib/ses';
import { randomUUID } from 'crypto';
import { bulkInviteUsers, resendInvitation } from '../../services/bulk-invitation.service';
import { platformProcedure } from './_common';
import { logPlatformExport } from '../../access/security-audit';
import { provisionOrgDefaults, provisionOrgEntitlements } from '../../services/org-provisioning';
import { renderInvitationEmail } from '../../services/invitation-email';

const INVITATION_TYPE = z.enum(['org_admin', 'user']);
const INVITATION_STATUS = z.enum(['pending', 'sent', 'accepted', 'expired', 'revoked']);

// The CSV export row cap, matching audit.service.ts:13 so the two platform exports bound egress the
// same way. exportInvitationsCsv was unbounded until 2026-08-13 (GHSA-6759-h69h-m739): one call
// returned every invitation across every tenant, and the whole set was materialised into a string.
const EXPORT_LIMIT = 10_000;

const invitationListSelect = {
  id: true,
  email: true,
  type: true,
  organizationId: true,
  organizationName: true,
  roleSlug: true,
  status: true,
  sentAt: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true } },
  invitedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export const invitationsRouter = router({
  getInvitationKpis: platformProcedure.query(async () => {
    const [total, pending, accepted, expired] = await Promise.all([
      db.platformInvitation.count(),
      db.platformInvitation.count({ where: { status: { in: [InvitationStatus.pending, InvitationStatus.sent] } } }),
      db.platformInvitation.count({ where: { status: InvitationStatus.accepted } }),
      db.platformInvitation.count({ where: { status: InvitationStatus.expired } }),
    ]);
    return { total, pending, accepted, expired };
  }),

  listInvitations: platformProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
        type: INVITATION_TYPE.optional(),
        status: INVITATION_STATUS.optional(),
        search: z.string().max(100).optional(),
      }),
    )
    .query(async ({ input }) => {
      const { page, limit, type, status, search } = input;
      const where: Prisma.PlatformInvitationWhereInput = {};
      if (type) where.type = type as InvitationType;
      if (status) where.status = status as InvitationStatus;
      if (search?.trim()) where.email = { contains: search.trim(), mode: 'insensitive' };

      const [invitations, total] = await Promise.all([
        db.platformInvitation.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy: { createdAt: 'desc' },
          select: invitationListSelect,
        }),
        db.platformInvitation.count({ where }),
      ]);

      return { invitations, total };
    }),

  createOrgInvitation: platformProcedure
    .input(
      z.object({
        // 254, not 255 (#207): RFC 5321 §4.5.3.1.3 caps the Path at 256 octets INCLUDING the angle
        // brackets, so the address itself is <= 254. This procedure writes `input.email` straight into
        // `organizations.billing_email` (below) — the same column `platform.createOrganization` writes.
        // Leaving 255 here would let a 255-octet address in through one platform-owner writer and be
        // rejected by the other. The other two `.max(255)` emails in this file write
        // `platform_invitations.email`, a different column, and are deliberately untouched.
        //
        // NOT "the only other writer" — corrected 2026-08-11. `organizations.billing_email` has FOUR
        // writers and TWO are still unbounded: `routers/organization.ts` update (via
        // `updateOrganizationSchema`, at the lower `organization:update` privilege bar) and the
        // self-serve signup in `apps/web/app/auth/callback/route.ts`. See the corresponding comment on
        // `platform.createOrganization` for the full list, and #213 for the fix. #207 bounded the
        // platform-owner paths only.
        email: z.string().email().max(254),
        organizationName: z.string().min(2).max(100),
        organizationSlug: z
          .string()
          .min(2)
          .max(63)
          .regex(/^[a-z0-9-]+$/),
        organizationPlan: z.enum(['trial', 'starter', 'professional', 'enterprise']).default('trial'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const org = await db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: input.organizationName,
            slug: input.organizationSlug,
            plan: input.organizationPlan,
            billingEmail: input.email,
          },
        });

        // Sprint 1.2 onboarding automation: this is a THIRD org-creation path
        // (alongside self-serve signup and platform.createOrganization) that
        // Codex's whole-branch adversarial review caught missing this entirely
        // — the org exists in the DB the instant this mutation runs (before
        // the invitee ever accepts), so it needs the same default Company/
        // BusinessUnit/Team + starter entitlements bundle or it's an empty
        // shell exactly like the two paths this sprint fixed.
        await provisionOrgDefaults(tx, org.id, input.organizationName);
        await provisionOrgEntitlements(tx, org.id);

        await tx.role.create({
          data: { organizationId: org.id, name: 'Super Administrador', slug: 'super_admin', isSystem: true },
        });
        await tx.subscription.create({
          data: {
            organizationId: org.id,
            plan: input.organizationPlan,
            status: input.organizationPlan === 'trial' ? 'trialing' : 'active',
            trialEndsAt: input.organizationPlan === 'trial' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
          },
        });
        return org;
      });

      const invitation = await db.platformInvitation.create({
        data: {
          email: input.email,
          type: InvitationType.org_admin,
          organizationId: org.id,
          organizationName: input.organizationName,
          organizationSlug: input.organizationSlug,
          organizationPlan: input.organizationPlan,
          token,
          status: InvitationStatus.sent,
          invitedById: ctx.user.id,
          sentAt: new Date(),
          expiresAt,
        },
        select: invitationListSelect,
      });

      const appUrl = getAppUrl();
      await sendEmail({
        to: input.email,
        subject: `Invitacion para administrar ${input.organizationName} en TIMS ATS`,
        html: renderInvitationEmail({ organization: input.organizationName, role: 'Administrador', url: `${appUrl}/accept-invitation?token=${token}`, expiresAt }),
      });

      return invitation;
    }),

  createUserInvitation: platformProcedure
    .input(
      z.object({
        email: z.string().email().max(255),
        organizationId: z.string().uuid(),
        roleSlug: z.string().max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });

      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const invitation = await db.platformInvitation.create({
        data: {
          email: input.email,
          type: InvitationType.user,
          organizationId: input.organizationId,
          organizationName: org.name,
          roleSlug: input.roleSlug,
          token,
          status: InvitationStatus.sent,
          invitedById: ctx.user.id,
          sentAt: new Date(),
          expiresAt,
        },
        select: invitationListSelect,
      });

      const appUrl = getAppUrl();
      await sendEmail({
        to: input.email,
        subject: `Invitacion para unirte a ${org.name} en TIMS ATS`,
        html: renderInvitationEmail({ organization: org.name, role: input.roleSlug, url: `${appUrl}/accept-invitation?token=${token}`, expiresAt }),
      });

      return invitation;
    }),

  resendInvitation: platformProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const result = await resendInvitation(input.id);
    if ('error' in result) {
      if (result.error === 'not_found') throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });
      if (result.error === 'delivery_failed')
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Email delivery unconfirmed; invitation was not marked sent',
        });
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot resend accepted or revoked invitation' });
    }
    return result;
  }),

  revokeInvitation: platformProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const existing = await db.platformInvitation.findUnique({
      where: { id: input.id },
      select: { id: true, status: true },
    });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });
    if (existing.status === 'accepted')
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'No se puede revocar una invitacion aceptada' });

    return db.platformInvitation.update({
      where: { id: input.id },
      data: { status: InvitationStatus.revoked },
      select: { id: true, status: true },
    });
  }),

  exportInvitationsCsv: platformProcedure
    .input(
      z.object({
        type: INVITATION_TYPE.optional(),
        status: INVITATION_STATUS.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.PlatformInvitationWhereInput = {};
      if (input.type) where.type = input.type as InvitationType;
      if (input.status) where.status = input.status as InvitationStatus;

      // Capped, mirroring audit.service.ts (EXPORT_LIMIT / take LIMIT+1 / truncated). Before this, the
      // export was unbounded: one platform-owner call returned EVERY invitation across EVERY tenant in a
      // single response (GHSA-6759-h69h-m739). Fetch one MORE than the cap so `truncated` can be reported
      // without a second count query, then trim to the cap. The C# port applies the identical cap in the
      // same change — a one-sided cap would fail `verify invitation`.
      const rawInvitations = await db.platformInvitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: EXPORT_LIMIT + 1,
        select: {
          email: true,
          type: true,
          organizationName: true,
          roleSlug: true,
          status: true,
          sentAt: true,
          expiresAt: true,
          acceptedAt: true,
        },
      });
      const truncated = rawInvitations.length > EXPORT_LIMIT;
      const invitations = truncated ? rawInvitations.slice(0, EXPORT_LIMIT) : rawInvitations;

      // Every cell goes through csvRow (packages/shared/src/csv.ts), matching audit.service.ts.
      // This export previously hand-rolled its CSV and quoted ONLY organizationName, so it had no
      // formula-injection defence (CWE-1236) and a comma in any other field shifted the row's later
      // columns. organizationName is z.string().min(2).max(100) with no character restriction, so a
      // leading =/+/-/@ was reachable through the ordinary invite flow. The C# port
      // (PlatformInvitationsReadUseCase.BuildCsv) is changed in the SAME commit to keep the two
      // stacks byte-identical — a one-sided fix would fail `verify invitation` on every row.
      const header = csvRow(['Email', 'Tipo', 'Organizacion', 'Rol', 'Estado', 'Enviada', 'Expira', 'Aceptada']);
      const fmt = (d: Date | null | undefined) => (d ? d.toISOString().split('T')[0] : '-');
      const rows = invitations.map((inv) =>
        csvRow([
          inv.email,
          inv.type,
          inv.organizationName,
          inv.roleSlug || '-',
          inv.status,
          fmt(inv.sentAt),
          fmt(inv.expiresAt),
          fmt(inv.acceptedAt),
        ]),
      );

      logPlatformExport(ctx, { resource: 'invitations', count: invitations.length, format: 'csv', truncated });
      return { csv: [header, ...rows].join('\n'), count: invitations.length, truncated };
    }),

  // ============ PUBLIC INVITATION ENDPOINTS ============

  getInvitationByToken: publicProcedure.input(z.object({ token: z.string().uuid() })).query(async ({ input }) => {
    const invitation = await db.platformInvitation.findUnique({
      where: { token: input.token },
      select: {
        id: true,
        email: true,
        type: true,
        organizationName: true,
        organizationSlug: true,
        roleSlug: true,
        status: true,
        expiresAt: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });

    // A public read must not race a revoke or resend and overwrite its terminal/new expiry state.
    // Expiry is derived for this response; administrative writers persist lifecycle transitions.
    const status =
      invitation.expiresAt < new Date() &&
      (invitation.status === InvitationStatus.pending || invitation.status === InvitationStatus.sent)
        ? InvitationStatus.expired
        : invitation.status;

    return {
      id: invitation.id,
      email: invitation.email,
      type: invitation.type,
      organizationName: invitation.organization?.name || invitation.organizationName,
      organizationSlug: invitation.organizationSlug,
      roleSlug: invitation.roleSlug,
      status,
      expiresAt: invitation.expiresAt,
    };
  }),

  acceptInvitation: publicProcedure.input(z.object({ token: z.string().uuid() })).mutation(async ({ input }) => {
    void input;
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Completa la configuracion de tu cuenta desde el enlace de invitacion.',
    });
  }),

  bulkInviteUsers: platformProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        users: z
          .array(
            z.object({
              email: z.string().email().max(255),
              firstName: z.string().max(100).optional(),
              lastName: z.string().max(100).optional(),
              roleSlug: z.string().max(50).optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await bulkInviteUsers(input.organizationId, ctx.user.id, input.users);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });
      return result;
    }),
});
