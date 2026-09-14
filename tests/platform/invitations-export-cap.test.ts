/**
 * invitations-export-cap.test.ts — GHSA-6759-h69h-m739.
 *
 * WHY THIS FILE EXISTS: exportInvitationsCsv was UNBOUNDED — one platform-owner call returned every
 * platform_invitations row across every tenant (each carrying an invitee email) in a single response,
 * materialised whole into a string. This pins the cap in the RUNNING layer: it asserts the Prisma query
 * the procedure actually builds (`take: EXPORT_LIMIT + 1`) and the `truncated` flag it computes. The C#
 * half is pinned separately by ExportAsync_capsAtExportLimit_andReportsTruncated (a unit test with a stub
 * repository) — both sides changed in one commit, so both are pinned in one commit.
 *
 * Mock strategy mirrors tests/platform/list-organizations-query-shape.test.ts: mock `../../trpc` so the
 * procedure builders are pass-throughs while the REAL platformProcedure owner gate (from ./_common) still
 * runs, and mock `@tims/db` to capture the findMany arguments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

const EXPORT_LIMIT = 10_000;
const invitationFindMany = vi.fn();

vi.mock('@tims/db', () => ({
  db: { platformInvitation: { findMany: (...a: unknown[]) => invitationFindMany(...a) } },
  InvitationType: { org_admin: 'org_admin', user: 'user' },
  InvitationStatus: { pending: 'pending', sent: 'sent', accepted: 'accepted', expired: 'expired', revoked: 'revoked' },
}));

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
    .create();
  return { router: t.router, publicProcedure: t.procedure, protectedProcedure: t.procedure };
});

import { invitationsRouter } from '../../packages/api/src/routers/platform/invitations';

const t = initTRPC
  .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
  .create();
const createCaller = t.createCallerFactory(invitationsRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

interface ExportCaller {
  exportInvitationsCsv(input: Record<string, unknown>): Promise<{ csv: string; count: number; truncated: boolean }>;
}

const caller = () =>
  createCaller({
    user: { id: 'owner-1', organizationId: '99999999-9999-4999-8999-999999999999', isPlatformOwner: true },
    headers: new Headers(),
  }) as unknown as ExportCaller;

/** A minimal export row; only the 8 selected fields matter to the CSV. */
const row = (i: number) => ({
  email: `u${i}@b.test`,
  type: 'user',
  organizationName: 'Acme',
  roleSlug: 'hr_admin',
  status: 'sent',
  sentAt: null,
  expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  acceptedAt: null,
});

beforeEach(() => vi.clearAllMocks());

describe('platform.exportInvitationsCsv is capped (GHSA-6759-h69h-m739)', () => {
  it('fetches EXPORT_LIMIT + 1 rows — the +1 is how truncation is detected without a second query', async () => {
    invitationFindMany.mockResolvedValue([]);

    await caller().exportInvitationsCsv({});

    expect(invitationFindMany, 'export no longer calls platformInvitation.findMany').toHaveBeenCalledTimes(1);
    const args = invitationFindMany.mock.calls[0][0] as { take: number };
    expect(args.take).toBe(EXPORT_LIMIT + 1);
  });

  it('reports truncated=true and returns exactly EXPORT_LIMIT rows when more exist', async () => {
    // The DB (via take: LIMIT+1) hands back LIMIT+1 rows — the signal that more exist.
    invitationFindMany.mockResolvedValue(Array.from({ length: EXPORT_LIMIT + 1 }, (_, i) => row(i)));

    const res = await caller().exportInvitationsCsv({});

    expect(res.truncated).toBe(true);
    expect(res.count).toBe(EXPORT_LIMIT);
    // header + EXPORT_LIMIT data rows, and no more — proves the slice happened, not just the count.
    expect(res.csv.split('\n').length).toBe(EXPORT_LIMIT + 1);
  });

  it('reports truncated=false at exactly EXPORT_LIMIT (boundary is >, not >=)', async () => {
    invitationFindMany.mockResolvedValue(Array.from({ length: EXPORT_LIMIT }, (_, i) => row(i)));

    const res = await caller().exportInvitationsCsv({});

    expect(res.truncated).toBe(false);
    expect(res.count).toBe(EXPORT_LIMIT);
  });

  it('reports truncated=false for a small export', async () => {
    invitationFindMany.mockResolvedValue([row(0), row(1), row(2)]);

    const res = await caller().exportInvitationsCsv({});

    expect(res.truncated).toBe(false);
    expect(res.count).toBe(3);
    expect(res.csv.split('\n').length).toBe(4); // header + 3
  });
});
