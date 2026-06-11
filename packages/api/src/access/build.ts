import { TRPCError } from '@trpc/server';
import { db } from '@tims/db';
import { cacheGet, cacheSet } from '../lib/cache';
import { resolveAccess } from './resolve';
import type { AccessDecision, Grant } from './types';

const TTL = 300; // same 5-min policy as the old permission cache

export interface AccessUser {
  id: string;
  organizationId: string | null;
  roles: string[];
  isPlatformOwner: boolean;
}

export async function buildAccessForUser(
  user: AccessUser, module: string, action: string,
): Promise<AccessDecision> {
  // Privileged classes get an EXPLICIT decision — repos must never see undefined
  // access and must never silently run unscoped (design doc, codex F2).
  if (user.isPlatformOwner || user.roles.includes('platform_owner') || user.roles.includes('super_admin')) {
    if (!user.organizationId) {
      // Platform owner hitting a TENANT module without an org of their own. Note:
      // impersonation does NOT land here — it sets isPlatformOwner:false on ctx.user
      // (route.ts:150), so impersonating owners take the DB-checked path below with
      // the TARGET's roles. The org id in this branch is the owner's OWN User row
      // org. Refuse rather than run on the privileged unscoped client.
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Selecciona o impersona una organizacion para operar datos de tenant',
      });
    }
    // super_admin returns roles as-is (may include non-contributing roles, unlike
    // the DB path below which returns contributing-only roles).
    const roles = user.isPlatformOwner ? ['platform_owner'] : user.roles;
    return { allowed: true, scope: 'organization', roles };
  }

  const orgId = user.organizationId;
  if (!orgId) return { allowed: false };

  const key = `tims:access:${orgId}:${[...user.roles].sort().join(',')}:${module}:${action}`;
  const cached = await cacheGet<AccessDecision>(key);
  if (cached) return cached;

  const rows = await db.rolePermission.findMany({
    where: {
      role: { slug: { in: user.roles }, organizationId: orgId },
      permission: { module, action },
    },
    select: { scope: true, role: { select: { slug: true } }, permission: { select: { module: true, action: true } } },
  });
  // LEGACY COMPAT (remove after seed-access --apply runs in prod): pre-wave rows
  // carry scope 'all'; old middleware ignored scope entirely (= org-wide), so 'all'
  // maps to 'organization' to keep code-only deploys behavior-neutral. The kernel
  // itself stays strict — this mapping is the ONLY tolerated alias.
  const grants: Grant[] = rows.map((r) => ({
    role: r.role.slug, module: r.permission.module, action: r.permission.action,
    scope: (r.scope === 'all' ? 'organization' : r.scope) as Grant['scope'], // cast tolerated: resolveAccess re-validates via isAccessScope (never trust DB strings)
  }));
  const decision = resolveAccess(grants, module, action);
  await cacheSet(key, decision, TTL);
  return decision;
}
