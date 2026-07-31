import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context';
import { db, runWithTenant } from '@tims/db';
import { checkRateLimit, getRateLimitCategory } from './middleware/rate-limit';
import { buildAccessForUser, createAnchorLoader, type AccessContext } from './access';
import { resolveApiKeyPrincipal, buildExternalAccessUser } from './access/external-auth';
import { externalScopeSatisfied } from './access/external-scope';
import { touchApiKeyLastUsed } from './repositories/external-auth.repository';
import { observeDenial, observeExternalDenial, logSecurityEvent } from './access/security-audit';
import { isMfaEnforced, isMfaPrivileged, isMfaGateBlocking, MFA_REQUIRED } from '@tims/shared';
import type { Module, Action } from '@tims/shared';

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
    const hops = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (hops.length > 0) return `ip:${hops[hops.length - 1]}`;
  }
  return 'anonymous';
}

// Rate limiting middleware
const withRateLimit = t.middleware(async ({ ctx, next, path, type }) => {
  const category = getRateLimitCategory(path, type as 'query' | 'mutation');
  // AI calls are cost-controlled per ORGANIZATION when the caller is authenticated:
  // neither one user nor an org's users collectively may exceed the org's AI
  // throughput/budget. The org isn't known for an unauthenticated publicProcedure
  // (e.g. portal.applyToVacancy) until its input is parsed, so those fall back to
  // per-IP like everything else — the org-level `checkBudget` in packages/ai/src/invoke.ts
  // is the real backstop against IP-distributed abuse for that case.
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

// Candidate auth middleware — for the public-facing candidate portal. Candidates
// authenticate via Supabase magic-link but have NO staff `User`/org row, so the
// staff `isAuthed` gate can never serve them. This gate requires only a Supabase
// session (ctx.supabaseAuth) and narrows it to non-null downstream. It does NOT
// establish a tenant context: the org is not known until the procedure's input is
// validated, so candidate services resolve org-from-slug and call runWithTenant
// per request (see services/candidate-portal.service.ts).
const isCandidate = t.middleware(({ ctx, next }) => {
  if (!ctx.supabaseAuth) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Debes iniciar sesion para acceder a tu portal',
    });
  }
  return next({
    ctx: {
      supabaseAuth: ctx.supabaseAuth,
    },
  });
});

// Tenant-context middleware — establishes the per-request org context (read by the
// `tenantDb` RLS client via AsyncLocalStorage). Tenant routers import `tenantDb` and
// their queries are scoped to this org. Platform owners WITH an org row of their own
// flow through the SAME runWithTenant path as staff: platform routers use the
// privileged `db` (so setting the GUC costs nothing there), and on tenant routers
// this restores the RLS backstop — an empty ALS would make tenantDb short-circuit
// before SET LOCAL ROLE and run UNSCOPED on the BYPASSRLS login role. Only org-less
// owners skip tenant context entirely.
const withTenantContext = t.middleware(({ ctx, next }) => {
  let orgId: string | null | undefined;
  if (ctx.user?.isPlatformOwner) {
    const ownOrg = ctx.user.organizationId;
    if (!ownOrg) return next(); // platform routers use the privileged db; no tenant ctx needed
    // fallthrough to the same UUID validation + runWithTenant below
    orgId = ownOrg;
  } else {
    orgId = ctx.user?.organizationId;
  }

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

// Permission middleware factory — resolves a full scoped access decision
// (buildAccessForUser: privileged classes get an EXPLICIT org-scope decision,
// everyone else is DB-checked against rolePermission grants; the old hr_admin
// allowlist and silent platform/super_admin bypass are gone — see
// docs/WAVE-2.5-ACCESS-CONTROL.md) and injects it as `ctx.access` so
// repositories can apply scope filters. Anchors are request-local (never
// cached across requests — they are the team/unit/panel authorization boundary).
function requirePermission(module: string, action: string) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    const access = await buildAccessForUser(ctx.user, module, action);
    if (!access.allowed) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `No tienes permiso para ${action} en ${module}`,
      });
    }

    const anchors = ctx.user.organizationId ? createAnchorLoader(ctx.user.organizationId, ctx.user.id) : null;
    const accessContext: AccessContext = { ...access, anchors };
    // Pass `user` explicitly (narrowed non-null above) — spreading `...ctx` would
    // re-widen user to nullable and break every downstream `ctx.user.x` access.
    return next({ ctx: { user: ctx.user, access: accessContext } });
  });
}

// Audit middleware — logs access to sensitive data
const withAudit = t.middleware(async ({ ctx, next, path }) => {
  const result = await next();

  // Log after successful execution. During impersonation ctx.user IS the target,
  // so attribute the action to the real operator (impersonatorId) and record the
  // impersonated account in metadata — never misattribute it to the target.
  if (ctx.user) {
    await db.auditLog
      .create({
        data: {
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.impersonatorId ?? ctx.user.id,
          action: 'access',
          entity: path,
          ...(ctx.user.impersonatorId ? { metadata: { impersonatedUserId: ctx.user.id } } : {}),
          ipAddress: ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
          userAgent: ctx.headers.get('user-agent'),
        },
      })
      .catch(() => {
        // Don't fail the request if audit logging fails
      });
  }

  return result;
});

// Security-event audit middleware (CB-1c) — a TRANSPARENT, outermost error
// observer. In tRPC a downstream error does NOT reject `next()`; it resolves to a
// MiddlewareResult with `ok:false`. So we inspect the result and, on a failed call,
// record authZ/authN DENIALS (fail-soft, fire-and-forget via observeDenial) — then
// RETURN THE RESULT UNCHANGED so tRPC propagates the ORIGINAL error verbatim. This
// structurally cannot alter a 403/401 or convert a denial into a 500 (it neither
// constructs nor swallows the error), and adds no work on the success path. Placed
// OUTERMOST (on t.procedure, before withRateLimit) so it observes denials from every
// downstream middleware — rate-limit, auth, tenant context, and the permission gates.
const withSecurityAudit = t.middleware(async ({ ctx, next, path }) => {
  const result = await next();
  if (!result.ok) observeDenial({ error: result.error, path, ctx });
  return result;
});

// MFA enforcement middleware (CB-2a) — closes the page-only bypass. Runs AFTER auth +
// tenant context. When MFA_ENFORCED is on AND the principal is privileged (mirrors the
// (admin) page gate + the trpc.ts privileged set via the SHARED isMfaPrivileged) AND
// the session is not stepped up to aal2, it audits an `mfa_step_up_required` event and
// throws a FORBIDDEN carrying the MFA_REQUIRED marker (the web client maps it → /mfa;
// the CB-1c denial observer skips it). Fail-OPEN on the flag: an unset MFA_ENFORCED is
// a no-op, so this can never lock privileged users out until Federico flips it. The
// /mfa step-up flow uses the Supabase client directly (not tRPC), so there is no loop.
const withMfaEnforcement = t.middleware(({ ctx, next }) => {
  if (
    ctx.user &&
    isMfaGateBlocking({
      enforced: isMfaEnforced(process.env.MFA_ENFORCED),
      // During impersonation ctx.user is the (possibly non-privileged) TARGET, but the
      // REAL operator is always a platform owner (only owners can impersonate — enforced
      // at context build) and ctx.aal is still the operator's OWN session level
      // (impersonation is a signed cookie, not a Supabase session swap). So an active
      // impersonation is treated as privileged and gated against the operator's aal —
      // otherwise an aal1 owner could step DOWN into a target and escape MFA.
      isPrivileged:
        isMfaPrivileged({ roles: ctx.user.roles, isPlatformOwner: ctx.user.isPlatformOwner }) ||
        Boolean(ctx.user.impersonatorId),
      currentLevel: ctx.aal,
    })
  ) {
    void logSecurityEvent({
      organizationId: ctx.user.organizationId,
      actorId: ctx.user.impersonatorId ?? ctx.user.id,
      action: 'mfa_step_up_required',
      entity: 'mfa',
      metadata: { currentLevel: ctx.aal ?? null },
      ipAddress: ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
      userAgent: ctx.headers.get('user-agent'),
    });
    throw new TRPCError({ code: 'FORBIDDEN', message: MFA_REQUIRED });
  }
  return next();
});

// Composed procedures — security observer → rate limit → auth → RLS → MFA
export const publicProcedure = t.procedure.use(withSecurityAudit).use(withRateLimit);
export const protectedProcedure = publicProcedure.use(isAuthed).use(withTenantContext).use(withMfaEnforcement);
export const auditedProcedure = protectedProcedure.use(withAudit);

// Candidate portal procedure — rate-limited + Supabase-session-gated. Built from
// publicProcedure (NOT protectedProcedure): candidates have no staff `user`. Org
// scope is per-call (resolved from input), so tenant RLS is applied inside the
// service via runWithTenant, not by withTenantContext.
export const candidateProcedure = publicProcedure.use(isCandidate);

// ── External API-key surface (Wave 2.5 slice 7b) ──────────────────────────────
// API-key-authenticated, results-only read surface for the `external` role. There
// is NO staff `user` and NO Supabase session — the KEY is the principal. Built from
// publicProcedure (rate-limited), mirroring candidateProcedure. requireApiKey both
// authenticates AND establishes tenant context (the org is known from the key at
// auth time, like staff withTenantContext), so downstream repos use tenantDb under
// the key's org RLS GUC only.
const requireApiKey = t.middleware(async ({ ctx, next, path, type }) => {
  const principal = await resolveApiKeyPrincipal(ctx.headers, new Date());
  if (!principal) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Clave de API invalida o expirada' });
  }
  // Per-KEY rate limit. publicProcedure's withRateLimit runs BEFORE this middleware
  // and keys on source IP (no apiKeyId yet); a paid integration surface needs per-key
  // quotas too, so we add a second limit keyed on the resolved key id (defense in
  // depth — IP flood protection AND per-key throughput).
  await checkRateLimit(`apikey:${principal.apiKeyId}`, getRateLimitCategory(path, type as 'query' | 'mutation'));
  // Fire-and-forget: must not block or change the timing of the request.
  touchApiKeyLastUsed(principal.apiKeyId);
  return runWithTenant(principal.organizationId, () =>
    next({
      ctx: {
        externalAuth: {
          apiKeyId: principal.apiKeyId,
          organizationId: principal.organizationId,
          scopes: principal.scopes,
        },
      },
    }),
  );
});

export const externalProcedure = publicProcedure.use(requireApiKey);

// Permission gate for external endpoints. Resolves a scoped ctx.access through the
// SAME buildAccessForUser kernel as staff (the `external` role's seeded grants), and
// honors ApiKey.scopes[] as a NARROWING filter: a non-empty scopes[] that omits the
// endpoint's requiredScope denies even though the role grant would allow it. anchors
// is null — external is org-scoped only (scopeWhereFor early-returns {} at org scope).
function requireExternalPermission(module: string, action: string, requiredScope?: string, alwaysEnforceScope = false) {
  return t.middleware(async ({ ctx, next, path }) => {
    const ext = ctx.externalAuth;
    if (!ext) throw new TRPCError({ code: 'UNAUTHORIZED' });
    // CB-1c: log denials on the paid external API-key surface — the org is known here
    // (from the key), unlike the base-context observer which only sees ctx.user.
    if (!externalScopeSatisfied(requiredScope, ext.scopes, alwaysEnforceScope)) {
      observeExternalDenial({
        organizationId: ext.organizationId,
        apiKeyId: ext.apiKeyId,
        path,
        reason: 'scope',
        requiredScope,
        headers: ctx.headers,
      });
      throw new TRPCError({ code: 'FORBIDDEN', message: 'La clave de API no incluye este alcance' });
    }
    const access = await buildAccessForUser(buildExternalAccessUser(ext), module, action);
    if (!access.allowed) {
      observeExternalDenial({
        organizationId: ext.organizationId,
        apiKeyId: ext.apiKeyId,
        path,
        reason: 'grant',
        requiredScope,
        headers: ctx.headers,
      });
      throw new TRPCError({ code: 'FORBIDDEN', message: `Sin permiso para ${action} en ${module}` });
    }
    const accessContext: AccessContext = { ...access, anchors: null };
    return next({ ctx: { externalAuth: ext, access: accessContext } });
  });
}

export function externalPermissionProcedure(
  module: Module,
  action: Action,
  requiredScope?: string,
  alwaysEnforceScope = false,
) {
  return externalProcedure.use(requireExternalPermission(module, action, requiredScope, alwaysEnforceScope));
}

// Helper to create permission-gated procedures
export function permissionProcedure(module: Module, action: Action) {
  return protectedProcedure.use(requirePermission(module, action));
}
