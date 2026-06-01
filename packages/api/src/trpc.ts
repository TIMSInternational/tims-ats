import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context';
import { db } from '@tims/db';
import { checkRateLimit, getRateLimitCategory } from './middleware/rate-limit';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

// Rate limiting middleware
const withRateLimit = t.middleware(async ({ ctx, next, path, type }) => {
  const identifier = ctx.user?.id || ctx.headers.get('x-forwarded-for') || 'anonymous';
  const category = getRateLimitCategory(path, type as 'query' | 'mutation');
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

// RLS middleware — injects organization context for tenant isolation
// Platform owners skip RLS (they access all orgs)
const withRLS = t.middleware(async ({ ctx, next }) => {
  if (ctx.user?.isPlatformOwner) {
    return next({ ctx: { db } });
  }

  if (!ctx.user?.organizationId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'No se encontro contexto de organizacion',
    });
  }

  await db.$executeRaw`SET LOCAL app.current_org_id = ${ctx.user.organizationId}`;

  return next({ ctx: { db } });
});

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

    // HR admin has access to all HR modules
    if (ctx.user.roles.includes('hr_admin')) {
      const nonHrModules = ['billing', 'integration'];
      if (!nonHrModules.includes(module)) {
        return next();
      }
    }

    // Check specific permissions in database
    const permission = await db.rolePermission.findFirst({
      where: {
        role: {
          slug: { in: ctx.user.roles },
          organizationId: ctx.user.organizationId,
        },
        permission: {
          module,
          action,
        },
      },
    });

    if (!permission) {
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

  // Log after successful execution
  if (ctx.user) {
    await db.auditLog.create({
      data: {
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        action: 'access',
        entity: path,
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
export const protectedProcedure = publicProcedure.use(isAuthed).use(withRLS);
export const auditedProcedure = protectedProcedure.use(withAudit);

// Helper to create permission-gated procedures
export function permissionProcedure(module: string, action: string) {
  return protectedProcedure.use(requirePermission(module, action));
}
