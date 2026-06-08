import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context';
import { db, runWithTenant } from '@tims/db';
import { checkRateLimit, getRateLimitCategory } from './middleware/rate-limit';
import { getCachedPermission, setCachedPermission } from './lib/cache';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;

// Derive a trusted client identifier for rate limiting. Authenticated requests key
// on the user id. For anonymous requests, NEVER trust the client-controlled
// left-most `x-forwarded-for` value — an attacker rotates it to get a fresh bucket
// per request, defeating the limiter entirely. Prefer `x-real-ip` (set by the
// platform edge, not client-spoofable); otherwise use the LAST hop of
// `x-forwarded-for` (the entry appended by the trusted proxy), never the first.
function anonymousIdentifier(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return `ip:${realIp}`;
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (hops.length > 0) return `ip:${hops[hops.length - 1]}`;
  }
  return 'anonymous';
}

// Rate limiting middleware
const withRateLimit = t.middleware(async ({ ctx, next, path, type }) => {
  const category = getRateLimitCategory(path, type as 'query' | 'mutation');
  // AI calls are cost-controlled per ORGANIZATION, not per user: neither one user
  // nor an org's users collectively may exceed the org's AI throughput/budget.
  // Everything else is keyed per user (or per trusted IP for anonymous requests).
  const identifier =
    category === 'ai' && ctx.user?.organizationId
      ? `org:${ctx.user.organizationId}`
      : (ctx.user?.id ?? anonymousIdentifier(ctx.headers));
  await checkRateLimit(identifier, category);
  return next();
});

// Auth middleware — requires a valid user session
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Debes iniciar sesion para acceder a este recurso',
    });
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

// Tenant-context middleware — establishes the per-request org context (read by the
// `tenantDb` RLS client via AsyncLocalStorage). Tenant routers import `tenantDb` and
// their queries are scoped to this org; platform owners run unscoped (they use the
// privileged `db` in platform routers).
const withTenantContext = t.middleware(({ ctx, next }) => {
  if (ctx.user?.isPlatformOwner) {
    return next();
  }

  const orgId = ctx.user?.organizationId;
  if (!orgId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'No se encontro contexto de organizacion',
    });
  }
  // Validate UUID format as defense-in-depth before it becomes the RLS GUC value.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid organization ID format' });
  }

  return runWithTenant(orgId, () => next());
});

// HR admin module access — explicit ALLOWLIST (fail-closed). A newly added module
// is NOT granted to hr_admin until added here, unlike the previous "everything
// except [billing, integration]" denylist which auto-granted new (possibly
// sensitive) modules. This set preserves the exact access hr_admin already had.
// REVIEW: audit / feature_flags / monitoring / organization are likely not HR
// concerns — remove once product confirms no hr_admin workflow relies on them.
const HR_ADMIN_MODULES = new Set<string>([
  'assessment', 'audit', 'candidate', 'compensation', 'dei', 'engagement',
  'feature_flags', 'interview', 'learning', 'monitoring', 'ninebox', 'offer',
  'onboarding', 'organization', 'performance', 'pipeline', 'succession',
  'team_intel', 'user', 'vacancy',
]);

// Permission middleware factory
function requirePermission(module: string, action: string) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    // Platform owner and super admin bypass all permission checks
    if (ctx.user.isPlatformOwner || ctx.user.roles.includes('platform_owner') || ctx.user.roles.includes('super_admin')) {
      return next();
    }

    // HR admin: explicit allowlist (see HR_ADMIN_MODULES above)
    if (ctx.user.roles.includes('hr_admin') && HR_ADMIN_MODULES.has(module)) {
      return next();
    }

    // Check specific permissions — cache-aside (5 min) keyed by org+roles+module+
    // action. The role→permission grants aren't mutated at runtime, so this is a
    // pure hot-path optimization; role-assignment writes invalidate the org's
    // entries defensively (see invalidatePermissionCache).
    const orgId = ctx.user.organizationId;
    let allowed = await getCachedPermission(orgId, ctx.user.roles, module, action);

    if (allowed === null) {
      const permission = await db.rolePermission.findFirst({
        where: {
          role: { slug: { in: ctx.user.roles }, organizationId: orgId },
          permission: { module, action },
        },
      });
      allowed = !!permission;
      await setCachedPermission(orgId, ctx.user.roles, module, action, allowed);
    }

    if (!allowed) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `No tienes permiso para ${action} en ${module}`,
      });
    }

    return next();
  });
}

// Audit middleware — logs access to sensitive data
const withAudit = t.middleware(async ({ ctx, next, path }) => {
  const result = await next();

  // Log after successful execution. During impersonation ctx.user IS the target,
  // so attribute the action to the real operator (impersonatorId) and record the
  // impersonated account in metadata — never misattribute it to the target.
  if (ctx.user) {
    await db.auditLog.create({
      data: {
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
        action: 'access',
        entity: path,
        ...(ctx.user.impersonatorId ? { metadata: { impersonatedUserId: ctx.user.id } } : {}),
        ipAddress: ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
        userAgent: ctx.headers.get('user-agent'),
      },
    }).catch(() => {
      // Don't fail the request if audit logging fails
    });
  }

  return result;
});

// Composed procedures — rate limit → auth → RLS
export const publicProcedure = t.procedure.use(withRateLimit);
export const protectedProcedure = publicProcedure.use(isAuthed).use(withTenantContext);
export const auditedProcedure = protectedProcedure.use(withAudit);

// Helper to create permission-gated procedures
export function permissionProcedure(module: string, action: string) {
  return protectedProcedure.use(requirePermission(module, action));
}
