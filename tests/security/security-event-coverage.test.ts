/**
 * security-event-coverage.test.ts — CB-1c
 *
 * Pins the security-event audit coverage control:
 *   1. `logSecurityEvent` primitive — fail-soft, writes to audit_logs, and passes
 *      `metadata` as a RAW OBJECT (Prisma Json), NOT a JSON string. The health
 *      dashboard reads `metadata.message` back as an object (platform/system.ts:70),
 *      so stringifying would silently break it. This test bites if someone
 *      "matches the (mis-stated) design" and stringifies.
 *   2. `observeDenial` + the tRPC error-observing middleware wrapper — TRANSPARENT:
 *      a FORBIDDEN/UNAUTHORIZED denial is logged AND re-thrown UNCHANGED. A failure
 *      inside the logging path must NEVER convert a 403 into a 500, and successful
 *      calls are never logged.
 *   3. Static wiring guards — the primitive is actually invoked at the instrumented
 *      sites (authz middleware, role assignment, feature-flag change, platform
 *      exports) so a future refactor that drops a writer goes red.
 *
 * Strategy mirrors tests/access/audit.test.ts (mock @tims/db) +
 * tests/access/ai-interview-router.test.ts (static source guards).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC, TRPCError } from '@trpc/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

const createMock = vi.fn();
vi.mock('@tims/db', () => ({
  db: { auditLog: { create: (args: unknown) => createMock(args) } },
  // security-audit.ts imports { db, Prisma }; Prisma is only used for a type cast.
  Prisma: {},
}));

import {
  logSecurityEvent,
  observeDenial,
  observeExternalDenial,
  logPlatformExport,
} from '../../packages/api/src/access/security-audit';

const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => createMock.mockReset());

// ---------------------------------------------------------------------------
// 1. logSecurityEvent primitive
// ---------------------------------------------------------------------------
describe('logSecurityEvent — primitive', () => {
  it('writes an audit_logs row with the expected shape', async () => {
    createMock.mockResolvedValueOnce({});
    await logSecurityEvent({
      organizationId: 'org1',
      actorId: 'actor1',
      action: 'authz_denied',
      entity: 'trpc:candidate.list',
      entityId: 'e1',
      metadata: { code: 'FORBIDDEN' },
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({
      organizationId: 'org1',
      actorId: 'actor1',
      action: 'authz_denied',
      entity: 'trpc:candidate.list',
      entityId: 'e1',
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });
  });

  it('passes metadata as a RAW OBJECT, never a JSON string (health-dashboard reads it as an object)', async () => {
    createMock.mockResolvedValueOnce({});
    await logSecurityEvent({
      organizationId: 'org1',
      action: 'authz_denied',
      entity: 'trpc:x',
      metadata: { code: 'FORBIDDEN', module: 'candidate' },
    });
    const arg = createMock.mock.calls[0][0] as { data: { metadata: unknown } };
    expect(typeof arg.data.metadata).toBe('object');
    expect(arg.data.metadata).toEqual({ code: 'FORBIDDEN', module: 'candidate' });
  });

  it('omits metadata (undefined) when not provided — does not write null/"" ', async () => {
    createMock.mockResolvedValueOnce({});
    await logSecurityEvent({ organizationId: 'org1', action: 'x', entity: 'y' });
    const arg = createMock.mock.calls[0][0] as { data: { metadata: unknown } };
    expect(arg.data.metadata).toBeUndefined();
  });

  it('is FAIL-SOFT: a throwing create is swallowed (never blocks auth / a mutation)', async () => {
    createMock.mockRejectedValueOnce(new Error('db down'));
    await expect(logSecurityEvent({ organizationId: 'org1', action: 'x', entity: 'y' })).resolves.toBeUndefined();
  });

  it('SKIPS the insert when organizationId is empty (NOT-NULL FK guard, centralized)', async () => {
    await logSecurityEvent({ organizationId: '', action: 'x', entity: 'y' });
    expect(createMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. observeDenial + the middleware wrapper (transparency)
// ---------------------------------------------------------------------------
describe('observeDenial — decision logic', () => {
  const ctx = {
    user: { id: 'u1', organizationId: 'org1', impersonatorId: null },
    headers: new Headers({ 'x-real-ip': '9.9.9.9', 'user-agent': 'jest' }),
  };

  it('logs a FORBIDDEN denial (authz_denied) under the user org', async () => {
    createMock.mockResolvedValueOnce({});
    observeDenial({ error: new TRPCError({ code: 'FORBIDDEN' }), path: 'candidate.delete', ctx });
    await flush();
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('authz_denied');
    expect(arg.data.entity).toBe('trpc:candidate.delete');
    expect(arg.data.organizationId).toBe('org1');
    expect(arg.data.actorId).toBe('u1');
  });

  it('attributes the denial to the impersonator when impersonating', async () => {
    createMock.mockResolvedValueOnce({});
    observeDenial({
      error: new TRPCError({ code: 'FORBIDDEN' }),
      path: 'x',
      ctx: { user: { id: 'target', organizationId: 'org1', impersonatorId: 'owner1' }, headers: new Headers() },
    });
    await flush();
    const arg = createMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.actorId).toBe('owner1');
  });

  it('does NOT log non-denial TRPCErrors (e.g. TOO_MANY_REQUESTS, INTERNAL_SERVER_ERROR)', async () => {
    observeDenial({ error: new TRPCError({ code: 'TOO_MANY_REQUESTS' }), path: 'x', ctx });
    observeDenial({ error: new TRPCError({ code: 'INTERNAL_SERVER_ERROR' }), path: 'x', ctx });
    observeDenial({ error: new Error('plain'), path: 'x', ctx });
    await flush();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('SKIPS the write when there is no org (resolve-or-skip: organizationId is NOT-NULL FK)', async () => {
    observeDenial({
      error: new TRPCError({ code: 'UNAUTHORIZED' }),
      path: 'x',
      ctx: { user: null, headers: new Headers() },
    });
    observeDenial({
      error: new TRPCError({ code: 'FORBIDDEN' }),
      path: 'x',
      ctx: { user: { id: 'u1', organizationId: null, impersonatorId: null }, headers: new Headers() },
    });
    await flush();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('is NON-THROWING even if the ctx blows up while building args (transparency guard)', () => {
    // A ctx.headers whose .get throws would, unguarded, throw INTO the outermost
    // middleware and convert the denial into a 500. The safe() wrapper must absorb it.
    const throwingCtx = {
      user: { id: 'u1', organizationId: 'org1', impersonatorId: null },
      headers: {
        get: () => {
          throw new Error('boom');
        },
      } as unknown as Headers,
    };
    expect(() =>
      observeDenial({ error: new TRPCError({ code: 'FORBIDDEN' }), path: 'x', ctx: throwingCtx }),
    ).not.toThrow();
  });
});

describe('observeExternalDenial — API-key surface (org resolved from the key)', () => {
  it('logs authz_denied under the key org, actorId null, with the apiKey principal', async () => {
    createMock.mockResolvedValueOnce({});
    observeExternalDenial({
      organizationId: 'orgExt',
      apiKeyId: 'key_123',
      path: 'external.getAssessmentResults',
      reason: 'scope',
      requiredScope: 'assessment:read',
      headers: new Headers({ 'user-agent': 'curl' }),
    });
    await flush();
    const arg = createMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('authz_denied');
    expect(arg.data.organizationId).toBe('orgExt');
    expect(arg.data.actorId).toBeNull();
    expect(arg.data.entity).toBe('trpc:external.getAssessmentResults');
    expect(arg.data.metadata).toMatchObject({
      principal: 'api_key',
      apiKeyId: 'key_123',
      reason: 'scope',
      requiredScope: 'assessment:read',
    });
  });

  it('is non-throwing on a hostile headers object', () => {
    const headers = {
      get: () => {
        throw new Error('boom');
      },
    } as unknown as Headers;
    expect(() =>
      observeExternalDenial({ organizationId: 'o', apiKeyId: 'k', path: 'x', reason: 'grant', headers }),
    ).not.toThrow();
  });
});

describe('security-audit middleware — TRANSPARENT (re-throws unchanged, never 403→500)', () => {
  type TestCtx = {
    user?: { id: string; organizationId?: string | null; impersonatorId?: string | null } | null;
    headers: Headers;
  };
  const t = initTRPC.context<TestCtx>().create();
  // Replicate EXACTLY the wrapper trpc.ts uses (guarded by a static assertion below):
  // tRPC resolves next() to a MiddlewareResult; a denial is `ok:false` (it does not
  // reject). We observe it and return the result UNCHANGED.
  const audited = t.procedure.use(async ({ ctx, next, path }) => {
    const result = await next();
    if (!result.ok) observeDenial({ error: result.error, path, ctx });
    return result;
  });
  const appRouter = t.router({
    denied: audited.query(() => {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'no' });
    }),
    ok: audited.query(() => 'ok'),
  });
  const baseCtx: TestCtx = { user: { id: 'u1', organizationId: 'org1', impersonatorId: null }, headers: new Headers() };

  it('a denial is logged AND re-thrown as the SAME FORBIDDEN (not 500)', async () => {
    createMock.mockResolvedValueOnce({});
    const caller = appRouter.createCaller(baseCtx);
    await expect(caller.denied()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await flush();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('a FAILURE in the logging path still yields FORBIDDEN (never INTERNAL_SERVER_ERROR)', async () => {
    createMock.mockRejectedValueOnce(new Error('audit db down'));
    const caller = appRouter.createCaller(baseCtx);
    await expect(caller.denied()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await flush();
  });

  it('a SUCCESSFUL call is never logged', async () => {
    const caller = appRouter.createCaller(baseCtx);
    await expect(caller.ok()).resolves.toBe('ok');
    await flush();
    expect(createMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// logPlatformExport helper
// ---------------------------------------------------------------------------
describe('logPlatformExport', () => {
  const headers = new Headers({ 'user-agent': 'jest' });
  it('logs platform_export under the target org when the export is org-filtered', async () => {
    createMock.mockResolvedValueOnce({});
    logPlatformExport(
      { user: { id: 'owner1', organizationId: null, impersonatorId: null }, headers },
      { resource: 'invoices', count: 12, format: 'csv', targetOrgId: 'orgX' },
    );
    await flush();
    const arg = createMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('platform_export');
    expect(arg.data.entity).toBe('export:invoices');
    expect(arg.data.organizationId).toBe('orgX');
    expect(arg.data.metadata).toMatchObject({ resource: 'invoices', count: 12, format: 'csv', targetOrgId: 'orgX' });
  });

  it('falls back to the actor org for a global export', async () => {
    createMock.mockResolvedValueOnce({});
    logPlatformExport(
      { user: { id: 'owner1', organizationId: 'ownerOrg', impersonatorId: null }, headers },
      { resource: 'subscriptions', count: 3 },
    );
    await flush();
    const arg = createMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.organizationId).toBe('ownerOrg');
  });

  it('SKIPS a global export by an org-less platform owner (no org to satisfy the FK)', async () => {
    logPlatformExport(
      { user: { id: 'owner1', organizationId: null, impersonatorId: null }, headers },
      { resource: 'ai_agents', count: 5 },
    );
    await flush();
    expect(createMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Static wiring guards — the writers are actually invoked at each site
// ---------------------------------------------------------------------------
const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('wiring — security events are instrumented at their sites', () => {
  it('trpc.ts: publicProcedure composes the security-audit observer OUTERMOST and re-throws', () => {
    const src = read('packages/api/src/trpc.ts');
    expect(src).toMatch(/observeDenial\(/);
    // outermost = applied before withRateLimit on the base procedure
    expect(src).toMatch(/t\.procedure\.use\(withSecurityAudit\)\.use\(withRateLimit\)/);
    // the wrapper must observe on failure and return the result UNCHANGED (transparent)
    const block = blockAt(src, 'const withSecurityAudit');
    expect(block).toMatch(/if \(!result\.ok\) observeDenial/);
    expect(block).toMatch(/return result/);
  });

  it('trpc.ts: external API-key denials are observed at both requireExternalPermission throw sites', () => {
    const src = read('packages/api/src/trpc.ts');
    const block = blockAt(src, 'function requireExternalPermission');
    expect(block).toMatch(/observeExternalDenial\(\{[^}]*reason: 'scope'/);
    expect(block).toMatch(/observeExternalDenial\(\{[^}]*reason: 'grant'/);
  });

  it('system.ts: single-org feature-flag deletion logs feature_flag_changed', () => {
    const src = read('packages/api/src/routers/platform/system.ts');
    const block = blockAt(src, 'deleteFeatureFlag:');
    expect(block).toMatch(/logSecurityEvent/);
    expect(block).toMatch(/feature_flag_changed/);
  });

  it('user.ts: role assignment + creation log role_assigned', () => {
    const src = read('packages/api/src/routers/user.ts');
    expect(src).toMatch(/logSecurityEvent/);
    expect(src).toMatch(/role_assigned/);
  });

  it('featureFlag.ts: flag update logs feature_flag_changed', () => {
    const src = read('packages/api/src/routers/featureFlag.ts');
    expect(src).toMatch(/logSecurityEvent/);
    expect(src).toMatch(/feature_flag_changed/);
  });

  it('every CSV/JSON platform export endpoint logs a platform_export', () => {
    // data-requests (DSAR) is intentionally EXCLUDED — it is audited as
    // `data_subject_export` per affected subject-org (better attribution).
    // platform/system.ts is EXCLUDED too, as of 2026-07-31: its only export endpoint,
    // exportAuditLogsCsv, was deleted alongside getCrossOrgAuditLogs (both C#-only now,
    // NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP confirmed live) — system.ts has zero export
    // endpoints left, so this assertion no longer applies to it.
    const files = [
      'packages/api/src/routers/platform/ai-agents.ts',
      'packages/api/src/routers/platform/invoices.ts',
      'packages/api/src/routers/platform/invitations.ts',
      'packages/api/src/routers/platform/subscriptions.ts',
      'packages/api/src/routers/platform/users.ts',
    ];
    for (const f of files) {
      expect(read(f), `${f} must call logPlatformExport`).toMatch(/logPlatformExport\(/);
    }
  });

  it('data-requests DSAR export retains its per-subject-org data_subject_export audit', () => {
    const src = read('packages/api/src/routers/platform/data-requests.ts');
    expect(src).toMatch(/data_subject_export/);
    expect(src).not.toMatch(/logPlatformExport\(/);
  });
});
