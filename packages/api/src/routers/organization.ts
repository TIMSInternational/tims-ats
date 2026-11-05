import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db, runTenantTransaction } from '@tims/db';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  createCompanySchema,
  createBusinessUnitSchema,
  createTeamSchema,
} from '@tims/shared';
import { projectOrganizationProfile } from '../services/organization-profile';

// Setup-checklist widget (first-login "what to do first" prompt, Sprint 1.2
// Task 2). The 5 derived booleans are always read live — NOT cached.
// Whole-branch review found the original per-org 60s cache had no
// invalidation on any of the write paths that flip these booleans
// (organization.update's logo, vacancy create/publish, user creation), so
// a completed item could stay "incomplete" for up to 60s, directly
// contradicting the plan's "reflects it without more than the app's normal
// query invalidation" acceptance criterion. These are 1 findUnique + 3
// counts on organizationId-indexed columns — cheap enough that correctness
// beats a cache here; wiring invalidation into 3 separate write paths
// would add more surface area (and more ways to silently miss one) than a
// live read costs.
const SETUP_STATUS_REOPEN_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SetupChecklistItems {
  companyStructureReady: boolean;
  teamInvited: boolean;
  brandingSet: boolean;
  firstVacancyPosted: boolean;
  firstVacancyPublished: boolean;
}

async function loadSetupChecklistItems(organizationId: string): Promise<SetupChecklistItems> {
  const [org, companyCount, teamInvitationCount, vacancyCount, publishedVacancyCount] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { logo: true } }),
    // Live check, NOT hardcoded true: provisionOrgDefaults (Sprint 1.2 Task 1)
    // guarantees a Company for every org created from this sprint onward, but
    // any org created BEFORE Task 1 shipped (e.g. INVU, already live in prod)
    // has no such guarantee — a hardcoded true would silently misreport
    // "ready" for those orgs. This count is one more entry in the existing
    // parallel query, on an organizationId-indexed table.
    db.company.count({ where: { organizationId } }),
    // "Invita a tu equipo" means an admin of THIS organization sent a user invitation (tenant self-serve
    // /settings/users writes the same table). A second admin invited by the platform owner accepting is
    // not the org inviting its team, so a plain user count ticked this off too early (D-18).
    db.platformInvitation.count({
      where: {
        organizationId,
        type: 'user',
        status: { not: 'revoked' },
        invitedBy: { organizationId, isPlatformOwner: false },
      },
    }),
    db.vacancy.count({ where: { organizationId, deletedAt: null } }),
    db.vacancy.count({ where: { organizationId, status: 'published', deletedAt: null } }),
  ]);

  return {
    companyStructureReady: companyCount > 0,
    teamInvited: teamInvitationCount > 0,
    brandingSet: org?.logo != null,
    firstVacancyPosted: vacancyCount > 0,
    firstVacancyPublished: publishedVacancyCount > 0,
  };
}

export const organizationRouter = router({
  // Current organization — an explicit, non-sensitive projection any staff session may read: the branding
  // logo, the audit-log export day boundaries and the read-only "Datos de la organización" card (D-11). It
  // used to return the full row (settings, billingEmail) plus every active company (taxId, legalName) to
  // every role, committee and employee included (D-20). Now only the locale profile leaves the server:
  // country, currency, time zone and language as the product resolves them, and the candidate contact
  // mailbox — the address every candidate email already prints. Never the raw settings or billing data.
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    const org = await db.organization.findUnique({
      where: { id: ctx.user.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        settings: true,
        billingEmail: true,
        companies: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { name: true, country: true, currency: true, timezone: true, language: true },
        },
      },
    });
    return org ? projectOrganizationProfile(org) : null;
  }),

  // Update organization
  update: permissionProcedure('organization', 'update')
    .input(updateOrganizationSchema)
    .mutation(async ({ ctx, input }) => {
      return db.organization.update({
        where: { id: ctx.user.organizationId },
        data: input,
      });
    }),

  // Company CRUD
  listCompanies: permissionProcedure('organization', 'read').query(async ({ ctx }) => {
    return db.company.findMany({
      where: { organizationId: ctx.user.organizationId, isActive: true },
      include: { businessUnits: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    });
  }),

  createCompany: permissionProcedure('organization', 'create')
    .input(createCompanySchema)
    .mutation(async ({ ctx, input }) => {
      return db.company.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // Business Unit CRUD
  listBusinessUnits: permissionProcedure('organization', 'read')
    .input(z.object({ companyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.businessUnit.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          companyId: input.companyId,
          isActive: true,
        },
        include: { teams: { where: { isActive: true } } },
        orderBy: { name: 'asc' },
      });
    }),

  createBusinessUnit: permissionProcedure('organization', 'create')
    .input(createBusinessUnitSchema)
    .mutation(async ({ ctx, input }) => {
      return db.businessUnit.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // Team CRUD
  listTeams: permissionProcedure('organization', 'read')
    .input(z.object({ businessUnitId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.team.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          businessUnitId: input.businessUnitId,
          isActive: true,
        },
        include: {
          leader: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          members: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
      });
    }),

  createTeam: permissionProcedure('organization', 'create')
    .input(createTeamSchema)
    .mutation(async ({ ctx, input }) => {
      return db.team.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  // ── hrbp ↔ business-unit assignment (Wave 2.5 slice 7a) ──────────────
  // Populates UserBusinessUnit, the anchor that unitIds()/unitMemberIds() read.
  // People-management act → user:create/delete (hr_admin holds user:* at org
  // scope; super_admin too). IDOR: both the unit and the target user are
  // org-verified before writing.
  listUnitMembers: permissionProcedure('user', 'read')
    .input(z.object({ businessUnitId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const unit = await db.businessUnit.findFirst({
        where: { id: input.businessUnitId, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
      if (!unit) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unidad de negocio no encontrada' });
      return db.userBusinessUnit.findMany({
        where: { businessUnitId: input.businessUnitId, organizationId: ctx.user.organizationId },
        select: {
          id: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  assignUserToUnit: permissionProcedure('user', 'create')
    .input(z.object({ userId: z.string().uuid(), businessUnitId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        // runTenantTransaction, not db.$transaction (#45 / prisma#17948) — the
        // tenantDb extension makes an outer $transaction a no-op wrapper.
        return await runTenantTransaction(ctx.user.organizationId, async (tx) => {
          const [unit, user] = await Promise.all([
            tx.businessUnit.findFirst({
              where: { id: input.businessUnitId, organizationId: ctx.user.organizationId },
              select: { id: true },
            }),
            tx.user.findFirst({
              where: { id: input.userId, organizationId: ctx.user.organizationId },
              select: { id: true },
            }),
          ]);
          if (!unit) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unidad de negocio no encontrada' });
          if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
          return tx.userBusinessUnit.create({
            data: {
              organizationId: ctx.user.organizationId,
              userId: input.userId,
              businessUnitId: input.businessUnitId,
            },
            select: { id: true },
          });
        });
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'El usuario ya está asignado a esta unidad' });
        }
        throw err;
      }
    }),

  unassignUserFromUnit: permissionProcedure('user', 'delete')
    .input(z.object({ userId: z.string().uuid(), businessUnitId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.userBusinessUnit.deleteMany({
        where: {
          organizationId: ctx.user.organizationId,
          userId: input.userId,
          businessUnitId: input.businessUnitId,
        },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignación no encontrada' });
      }
      return { success: true };
    }),

  // ── First-login "Setup Checklist" widget (Sprint 1.2 Task 2) ─────────────
  getSetupStatus: permissionProcedure('organization', 'read').query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;
    const [items, currentUser] = await Promise.all([
      loadSetupChecklistItems(organizationId),
      db.user.findUnique({
        where: { id: ctx.user.id },
        select: { setupChecklistDismissedAt: true },
      }),
    ]);

    const allComplete = Object.values(items).every(Boolean);
    const dismissedAt = currentUser?.setupChecklistDismissedAt ?? null;

    // Auto re-show after 7 days if the checklist is still incomplete — a
    // read-time projection only, never mutates the stored dismissal.
    const isStale =
      dismissedAt !== null && !allComplete && Date.now() - dismissedAt.getTime() > SETUP_STATUS_REOPEN_AFTER_MS;

    return {
      items,
      allComplete,
      dismissedAt: isStale ? null : (dismissedAt?.toISOString() ?? null),
    };
  }),

  dismissSetupChecklist: protectedProcedure.mutation(async ({ ctx }) => {
    // Own-record write, NOT gated on organization:update — this is a per-user
    // UI preference (dismiss my own checklist), not an org-level mutation.
    // Whole-branch review caught that gating it on organization:update broke
    // "Hide for now" for hr_admin, who the widget is explicitly shown to but
    // who holds organization:read only (org-config is read-only for hr_admin
    // by deliberate product design — see seed-access-matrix.ts). Matches the
    // same protectedProcedure "own record" convention already used by
    // user.ts's updateProfile. ctx.user.id is the authenticated caller (never
    // input-driven), scoped by tenantDb's RLS to ctx.user.organizationId.
    await db.user.update({
      where: { id: ctx.user.id },
      data: { setupChecklistDismissedAt: new Date() },
      select: { id: true },
    });
    return { success: true };
  }),
});
