import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Codex P1 on PR #299: Prisma queries are LAZY — a PrismaPromise executes only when .then is
// called, and the tenantDb extension reads the tenant context at that moment. A synchronous
// callback like `runWithTenant(org, () => tenantDb.x.findFirst(...))` hands back an unexecuted
// query that the caller awaits AFTER the AsyncLocalStorage scope has exited → no tenant in
// scope. This test uses the REAL generated PrismaClient and the REAL tenantDb extension (no
// mock) pointed at an unreachable database: if the scope is seen, the extension lets the query
// through and it fails with a CONNECTION error; if the scope was lost, the extension throws
// MissingTenantContextError before any connection attempt. No database is needed.

const UNREACHABLE = 'postgresql://nobody:nothing@127.0.0.1:1/none?connect_timeout=1';

let mod: typeof import('../../packages/db/src/index');

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', UNREACHABLE);
  vi.stubEnv('RLS_ENFORCED', 'false'); // scoped path runs query(args) directly outside production
  vi.stubEnv('NODE_ENV', 'test');
  vi.resetModules();
  (globalThis as { prisma?: unknown }).prisma = undefined;
  mod = await import('../../packages/db/src/index');
});
afterAll(async () => {
  await mod.db.$disconnect();
  (globalThis as { prisma?: unknown }).prisma = undefined;
  vi.unstubAllEnvs();
});

async function errorOf(p: PromiseLike<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the query to fail');
}

const ORG = '11111111-1111-1111-1111-111111111111';

describe('tenant scope survives LAZY Prisma queries returned un-awaited', () => {
  it('control: awaiting a query with no scope throws MissingTenantContextError', async () => {
    const e = await errorOf(mod.tenantDb.candidate.findFirst({ select: { id: true } }));
    expect(e).toBeInstanceOf(mod.MissingTenantContextError);
  });

  it('runWithTenant(org, () => query) — sync callback, awaited by the caller outside the scope', async () => {
    const pending = mod.runWithTenant(ORG, () => mod.tenantDb.candidate.findFirst({ select: { id: true } }));
    const e = await errorOf(pending);
    expect(e).not.toBeInstanceOf(mod.MissingTenantContextError);
    expect(String(e)).toMatch(/Can't reach database server|connect/i);
  });

  it('runUnscoped(reason, () => query) — same laziness, explicit opt-in', async () => {
    const pending = mod.runUnscoped('test-lazy', () => mod.tenantDb.candidate.findFirst({ select: { id: true } }));
    const e = await errorOf(pending);
    expect(e).not.toBeInstanceOf(mod.MissingTenantContextError);
  });

  it('runWithTenant(org, () => Promise.all([query, query])) and async-return patterns', async () => {
    const all = mod.runWithTenant(ORG, () =>
      Promise.all([mod.tenantDb.candidate.findFirst({ select: { id: true } }), mod.tenantDb.vacancy.count()]),
    );
    expect(await errorOf(all)).not.toBeInstanceOf(mod.MissingTenantContextError);
    const asyncReturn = mod.runWithTenant(ORG, async () => mod.tenantDb.candidate.findFirst({ select: { id: true } }));
    expect(await errorOf(asyncReturn)).not.toBeInstanceOf(mod.MissingTenantContextError);
  });
});
