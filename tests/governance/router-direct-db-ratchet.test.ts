import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// #39 — THE ROUTER DIRECT-DB RATCHET.
//
// CLAUDE.md: "Routers never import `db` directly. Always go through repositories." Issue #39 counted 34
// router files that query `tenantDb` directly. It asked for all of them to be refactored behind
// repositories. That refactor is NOT being done, on purpose: under the survival rule (see
// tests/governance/trpc-procedure-ratchet.test.ts) every one of these routers is deleted by its C#
// port and `packages/api` itself is deleted in Phase 7. Moving their queries into new TS repositories
// would be paying for the same code twice.
//
// What must not happen is the violation SPREADING while those routers wait to be ported. So this file
// pins today's offenders by path:
//   - a NEW router file importing a Prisma client from @tims/db fails, by name;
//   - an existing offender that starts importing an ADDITIONAL client (e.g. raw `db` next to
//     `tenantDb`) fails, by name;
//   - a router that stops importing one (ported, deleted, or moved behind a repository) fails until its
//     entry is removed below. That is the ratchet: the allowlist can only shrink.
//
// Scope: "client" means a VALUE import of `db`, `tenantDb` or `runTenantTransaction` from '@tims/db'.
// Type imports (`import type { Prisma }`, `type X` specifiers) and enums (`InvoiceStatus`, ...) are not
// data access and are ignored. A dynamic `import('@tims/db')` / `require('@tims/db')` that is not
// a type position, and any deep import of the db package, also fail.
//
// Measured on 2026-10-01 at origin/main 5f36edad: 47 router files, of which 31 use `tenantDb` and 16
// use only the unscoped `db` (platform-owner routers, auth, portal). #39 listed 34 tenantDb routers;
// compensation, ninebox, succession and teamIntel have since been removed, and vacancy/org-placement.ts
// (#310) was added after #39 was filed.

const ROUTERS_DIR = join(__dirname, '../../packages/api/src/routers');
const CLIENTS = new Set(['db', 'tenantDb', 'runTenantTransaction']);

/** MAY ONLY SHRINK. Path relative to packages/api/src/routers → the clients it imports today. */
const ALLOWED: Record<string, readonly string[]> = {
  'ai-interview.ts': ['db', 'tenantDb'],
  'assessment.ts': ['tenantDb'],
  'auth.ts': ['db'],
  'billing.ts': ['tenantDb'],
  'consent.ts': ['tenantDb'],
  'engagement.ts': ['tenantDb'],
  'featureFlag.ts': ['tenantDb'],
  'integration.ts': ['tenantDb'],
  'interview/crud.ts': ['runTenantTransaction', 'tenantDb'],
  'interview/media.ts': ['tenantDb'],
  'interview/scorecards.ts': ['tenantDb'],
  'learning.ts': ['tenantDb'],
  'monitoring.ts': ['tenantDb'],
  'notification.ts': ['tenantDb'],
  'offer/approvals.ts': ['runTenantTransaction', 'tenantDb'],
  'offer/crud.ts': ['tenantDb'],
  'offer/lifecycle.ts': ['runTenantTransaction', 'tenantDb'],
  'offer/signing.ts': ['tenantDb'],
  'offer/validations.ts': ['tenantDb'],
  'onboarding.ts': ['tenantDb'],
  'organization.ts': ['runTenantTransaction', 'tenantDb'],
  'performance/coaching.ts': ['tenantDb'],
  'performance/dashboard.ts': ['tenantDb'],
  'performance/feedback.ts': ['tenantDb'],
  'performance/okrs.ts': ['tenantDb'],
  'platform/ai-agents.ts': ['db'],
  'platform/dashboard-churn.ts': ['db'],
  'platform/dashboard-forecast.ts': ['db'],
  'platform/dashboard-upsell.ts': ['db'],
  'platform/dashboard.ts': ['db'],
  'platform/data-requests.ts': ['db'],
  'platform/entitlements.ts': ['db'],
  'platform/invitations.ts': ['db'],
  'platform/invoices.ts': ['db'],
  'platform/organizations.ts': ['db'],
  'platform/subscriptions.ts': ['db'],
  'platform/system.ts': ['db'],
  'platform/usage-billing.ts': ['db'],
  'platform/users.ts': ['db'],
  'portal.ts': ['db'],
  'user.ts': ['runTenantTransaction', 'tenantDb'],
  'vacancy/approvals.ts': ['runTenantTransaction', 'tenantDb'],
  'vacancy/channels.ts': ['runTenantTransaction', 'tenantDb'],
  'vacancy/crud.ts': ['runTenantTransaction', 'tenantDb'],
  'vacancy/job-profile.ts': ['tenantDb'],
  'vacancy/org-placement.ts': ['tenantDb'],
  'vacancy/stats.ts': ['tenantDb'],
};

/** Ceilings stated as numbers too, so a reviewer sees a raised one in the diff. MAY ONLY DECREASE. */
const FILE_CEILING = 47;
const TENANT_DB_CEILING = 31;

function routerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routerFiles(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Value-imported db clients, plus a marker for any import shape this scanner cannot classify. */
function dbClientsIn(source: string): string[] {
  const found = new Set<string>();
  const named = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@tims\/db['"]/g;
  for (const m of source.matchAll(named)) {
    if (m[1]) continue;
    for (const raw of m[2].split(',')) {
      const spec = raw.trim();
      if (!spec || spec.startsWith('type ')) continue;
      const name = spec.split(/\s+as\s+/)[0].trim();
      if (CLIENTS.has(name)) found.add(name);
    }
  }
  // Namespace / default imports expose every client.
  if (/import\s+(\*\s+as\s+\w+|\w+)\s+from\s*['"]@tims\/db['"]/.test(source)) found.add('<namespace import>');
  // Deep imports of the db package (client.ts, tenant-client.ts, ...).
  if (/from\s*['"](@tims\/db\/|[./]+(packages\/)?db\/src)/.test(source)) found.add('<deep import>');
  // Runtime dynamic import / require. `import('@tims/db').Prisma...` in a type position is allowed.
  if (/(await\s+import|require)\s*\(\s*['"]@tims\/db['"]\s*\)/.test(source)) found.add('<dynamic import>');
  return [...found].sort();
}

describe('#39 router direct-db ratchet', () => {
  const actual = new Map<string, string[]>();
  for (const file of routerFiles(ROUTERS_DIR)) {
    const clients = dbClientsIn(readFileSync(file, 'utf8'));
    if (clients.length > 0) actual.set(relative(ROUTERS_DIR, file).split('\\').join('/'), clients);
  }

  it('no router outside the allowlist imports a db client (a new offender fails by name)', () => {
    const newOffenders = [...actual.keys()].filter((f) => !(f in ALLOWED)).sort();
    expect(
      newOffenders,
      'Route new data access through a repository (or, per the survival rule, build it in C#). Do NOT add the file to ALLOWED.',
    ).toEqual([]);
  });

  it('no allowlisted router starts importing an additional db client', () => {
    const widened = [...actual.entries()]
      .filter(([f]) => f in ALLOWED)
      .flatMap(([f, clients]) => clients.filter((c) => !ALLOWED[f].includes(c)).map((c) => `${f}: ${c}`));
    expect(widened).toEqual([]);
  });

  it('the allowlist has no stale entries (it may only shrink: remove a router once it stops importing)', () => {
    const stale = Object.entries(ALLOWED).flatMap(([f, clients]) => {
      const now = actual.get(f) ?? [];
      return clients.filter((c) => !now.includes(c)).map((c) => `${f}: ${c}`);
    });
    expect(stale, 'Remove these from ALLOWED and lower the ceilings in the same PR.').toEqual([]);
  });

  it('the ceilings match the allowlist and have not been raised', () => {
    const files = Object.keys(ALLOWED).length;
    const tenantDbFiles = Object.values(ALLOWED).filter((c) => c.includes('tenantDb')).length;
    expect(files).toBe(FILE_CEILING);
    expect(tenantDbFiles).toBe(TENANT_DB_CEILING);
    expect(FILE_CEILING).toBeLessThanOrEqual(47);
    expect(TENANT_DB_CEILING).toBeLessThanOrEqual(31);
  });

  it('the scanner sees every client import shape (self-test, so the ratchet cannot pass vacuously)', () => {
    expect(dbClientsIn("import { tenantDb as db } from '@tims/db';")).toEqual(['tenantDb']);
    expect(dbClientsIn("import {\n  db,\n  SubscriptionStatus,\n} from '@tims/db';")).toEqual(['db']);
    expect(dbClientsIn('import { tenantDb as db, runTenantTransaction } from "@tims/db";')).toEqual([
      'runTenantTransaction',
      'tenantDb',
    ]);
    expect(dbClientsIn("import * as dbm from '@tims/db';")).toEqual(['<namespace import>']);
    expect(dbClientsIn("import { tenantDb } from '@tims/db/src/tenant-client';")).toEqual(['<deep import>']);
    expect(dbClientsIn("const { db } = await import('@tims/db');")).toEqual(['<dynamic import>']);
    // Not data access:
    expect(dbClientsIn("import type { Prisma } from '@tims/db';")).toEqual([]);
    expect(dbClientsIn("import { type TenantDb, InvoiceStatus } from '@tims/db';")).toEqual([]);
    expect(dbClientsIn("type T = import('@tims/db').Prisma.TransactionClient;")).toEqual([]);
    // And it actually found today's offenders — a scanner that matched nothing would pass the first test.
    expect(actual.size).toBe(FILE_CEILING);
  });
});
