import { z } from 'zod';
import { getAppUrl } from '@tims/shared';
import { router, publicProcedure } from '../../trpc';
import { db, InvitationType, InvitationStatus } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { sendEmail } from '../../lib/ses';
import { randomUUID } from 'crypto';
import { platformProcedure } from './_common';
import { logPlatformExport } from '../../access/security-audit';
import { provisionOrgDefaults, provisionOrgEntitlements } from '../../services/org-provisioning';

const INVITATION_TYPE = z.enum(['org_admin', 'user']);
const INVITATION_STATUS = z.enum(['pending', 'sent', 'accepted', 'expired', 'revoked']);

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
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
      type: INVITATION_TYPE.optional(),
      status: INVITATION_STATUS.optional(),
      search: z.string().max(100).optional(),
    }))
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
    .input(z.object({
      email: z.string().email().max(255),
      organizationName: z.string().min(2).max(100),
      organizationSlug: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
      organizationPlan: z.enum(['trial', 'starter', 'professional', 'enterprise']).default('trial'),
    }))
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
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;"><h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1></div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Has sido invitado</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">Has sido invitado a administrar <strong>${input.organizationName}</strong> en TIMS ATS.</p>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 24px;">Haz clic en el boton para configurar tu cuenta y comenzar.</p>
              <div style="text-align: center;"><a href="${appUrl}/accept-invitation?token=${token}" style="background: #1F114C; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Aceptar Invitacion</a></div>
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">Esta invitacion expira en 7 dias.</p>
          </div>
        `,
      });

      return invitation;
    }),

  createUserInvitation: platformProcedure
    .input(z.object({
      email: z.string().email().max(255),
      organizationId: z.string().uuid(),
      roleSlug: z.string().max(50).optional(),
    }))
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

      const roleLabel = input.roleSlug?.replace(/_/g, ' ') || 'usuario';
      const appUrl = getAppUrl();
      await sendEmail({
        to: input.email,
        subject: `Invitacion para unirte a ${org.name} en TIMS ATS`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;"><h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1></div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Has sido invitado</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">Has sido invitado a unirte a <strong>${org.name}</strong> en TIMS ATS como <strong>${roleLabel}</strong>.</p>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 24px;">Haz clic en el boton para aceptar la invitacion.</p>
              <div style="text-align: center;"><a href="${appUrl}/accept-invitation?token=${token}" style="background: #1F114C; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Aceptar Invitacion</a></div>
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">Esta invitacion expira en 7 dias.</p>
          </div>
        `,
      });

      return invitation;
    }),

  resendInvitation: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const invitation = await db.platformInvitation.findUnique({
        where: { id: input.id },
        select: { id: true, email: true, token: true, status: true, organizationName: true },
      });
      if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });
      if (invitation.status === 'accepted' || invitation.status === 'revoked') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot resend accepted or revoked invitation' });
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const appUrl = getAppUrl();

      await sendEmail({
        to: invitation.email,
        subject: `Recordatorio: Invitacion pendiente - ${invitation.organizationName || 'TIMS ATS'}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;"><h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1></div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Recordatorio de Invitacion</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 24px;">Tienes una invitacion pendiente para ${invitation.organizationName ? `<strong>${invitation.organizationName}</strong> en ` : ''}TIMS ATS.</p>
              <div style="text-align: center;"><a href="${appUrl}/accept-invitation?token=${invitation.token}" style="background: #1F114C; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Aceptar Invitacion</a></div>
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">Esta invitacion expira en 7 dias.</p>
          </div>
        `,
      });

      return db.platformInvitation.update({
        where: { id: input.id },
        data: { sentAt: new Date(), expiresAt, status: InvitationStatus.sent },
        select: { id: true, status: true, sentAt: true, expiresAt: true },
      });
    }),

  revokeInvitation: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const existing = await db.platformInvitation.findUnique({
        where: { id: input.id },
        select: { id: true, status: true },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });
      if (existing.status === 'accepted') throw new TRPCError({ code: 'BAD_REQUEST', message: 'No se puede revocar una invitacion aceptada' });

      return db.platformInvitation.update({
        where: { id: input.id },
        data: { status: InvitationStatus.revoked },
        select: { id: true, status: true },
      });
    }),

  exportInvitationsCsv: platformProcedure
    .input(z.object({
      type: INVITATION_TYPE.optional(),
      status: INVITATION_STATUS.optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.PlatformInvitationWhereInput = {};
      if (input.type) where.type = input.type as InvitationType;
      if (input.status) where.status = input.status as InvitationStatus;

      const invitations = await db.platformInvitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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

      const header = 'Email,Tipo,Organizacion,Rol,Estado,Enviada,Expira,Aceptada';
      const fmt = (d: Date | null | undefined) => d ? d.toISOString().split('T')[0] : '-';
      const rows = invitations.map(inv => [
        inv.email,
        inv.type,
        `"${(inv.organizationName || '').replace(/"/g, '""')}"`,
        inv.roleSlug || '-',
        inv.status,
        fmt(inv.sentAt),
        fmt(inv.expiresAt),
        fmt(inv.acceptedAt),
      ].join(','));

      logPlatformExport(ctx, { resource: 'invitations', count: invitations.length, format: 'csv' });
      return { csv: [header, ...rows].join('\n'), count: invitations.length };
    }),

  // ============ PUBLIC INVITATION ENDPOINTS ============

  getInvitationByToken: publicProcedure
    .input(z.object({ token: z.string().uuid() }))
    .query(async ({ input }) => {
      const invitation = await db.platformInvitation.findUnique({
        where: { token: input.token },
        select: {
          id: true, email: true, type: true, organizationName: true,
          organizationSlug: true, roleSlug: true, status: true, expiresAt: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
      });
      if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });

      const isExpired = invitation.expiresAt < new Date();
      if (isExpired && invitation.status !== InvitationStatus.expired) {
        await db.platformInvitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.expired } });
        invitation.status = InvitationStatus.expired;
      }

      return {
        id: invitation.id,
        email: invitation.email,
        type: invitation.type,
        organizationName: invitation.organization?.name || invitation.organizationName,
        organizationSlug: invitation.organizationSlug,
        roleSlug: invitation.roleSlug,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      };
    }),

  acceptInvitation: publicProcedure
    .input(z.object({ token: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const invitation = await db.platformInvitation.findUnique({
        where: { token: input.token },
        select: { id: true, status: true, expiresAt: true, organizationId: true, type: true },
      });
      if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitacion no encontrada' });
      if (invitation.status === InvitationStatus.accepted) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta invitacion ya fue aceptada' });
      if (invitation.status === InvitationStatus.revoked) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta invitacion fue revocada' });
      if (invitation.expiresAt < new Date()) {
        await db.platformInvitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.expired } });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta invitacion ha expirado' });
      }

      await db.platformInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.accepted, acceptedAt: new Date() },
      });

      return { accepted: true, organizationId: invitation.organizationId, type: invitation.type };
    }),

  bulkInviteUsers: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      users: z.array(z.object({
        email: z.string().email().max(255),
        firstName: z.string().max(100).optional(),
        lastName: z.string().max(100).optional(),
        roleSlug: z.string().max(50).optional(),
      })).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const org = await db.organization.findUnique({
        where: { id: input.organizationId },
        select: { name: true },
      });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });

      const results: { email: string; status: 'sent' | 'duplicate' | 'error'; message?: string }[] = [];
      const existingEmails = await db.platformInvitation.findMany({
        where: {
          organizationId: input.organizationId,
          email: { in: input.users.map(u => u.email) },
          status: { in: [InvitationStatus.sent, InvitationStatus.pending, InvitationStatus.accepted] },
        },
        select: { email: true },
      });
      const existingSet = new Set(existingEmails.map(e => e.email.toLowerCase()));

      for (const user of input.users) {
        if (existingSet.has(user.email.toLowerCase())) {
          results.push({ email: user.email, status: 'duplicate', message: 'Already invited' });
          continue;
        }
        try {
          const token = randomUUID();
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await db.platformInvitation.create({
            data: {
              email: user.email,
              type: InvitationType.user,
              organizationId: input.organizationId,
              organizationName: org.name,
              roleSlug: user.roleSlug,
              token,
              status: InvitationStatus.sent,
              invitedById: ctx.user.id,
              sentAt: new Date(),
              expiresAt,
            },
          });
          results.push({ email: user.email, status: 'sent' });
        } catch {
          results.push({ email: user.email, status: 'error', message: 'Failed to create invitation' });
        }
      }

      const sent = results.filter(r => r.status === 'sent').length;
      const duplicates = results.filter(r => r.status === 'duplicate').length;
      const errors = results.filter(r => r.status === 'error').length;

      return { results, summary: { total: input.users.length, sent, duplicates, errors } };
    }),
});
