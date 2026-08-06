/**
 * residual-procedures.test.ts — #60. Pins the DEI domain's remaining TypeScript surface after the
 * residual-procedure resolution, in BOTH directions:
 *
 *   DELETED — getEthnicityDistribution / getDisabilityDistribution. Ported in Slice 11b, zero TS-path
 *   consumers (no wrapper hook in apps/web/lib/platform-api/dei.ts, no FE call site), and their live
 *   C# replacements carry both of the tRPC guards — the `dei:read` grant (DeiStaffGate.cs:42,
 *   fail-closed at :50, reached from DeiReadEndpoints.cs:110/:131) and the min-5 k-anonymity floor
 *   (DeiReadUseCase.cs:160/:171 -> DeiKernels.cs:80 KAnonymity.SuppressBelowMin5). Re-adding either
 *   procedure would put a SECOND live implementation of a k-anonymity-sensitive demographic
 *   aggregate on the platform, which is what the cutover removed.
 *
 *   RETAINED — generateReport. Never ported to C# (DeiReadEndpoints.cs:14, DeiReadUseCase.cs:10,
 *   PlatformOptions.cs:249 all record the exclusion), so there is no replacement guard to delete it
 *   in favour of. Its port is blocked on closed #1's five legal/compliance questions plus .NET
 *   ExcelJS/PDFKit equivalents. Deleting it would remove capability, not dead code — so this suite
 *   fails if it disappears.
 *
 * Pinned BY NAME, never auto-discovered: with auto-discovery, deleting the last procedure would be a
 * green change. The RBAC gate and the min-5 suppression of the generated document itself are asserted
 * behaviorally in report-generation.test.ts (:151 renders a sub-floor section as a k-anonymity note,
 * not rows) — not duplicated here.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tims/db', () => ({
  tenantDb: { employeeDemographics: { groupBy: vi.fn() } },
  db: { auditLog: { create: vi.fn() } },
  runWithTenant: (_orgId: string | null, fn: () => unknown) => fn(),
}));

import { deiRouter } from '../../packages/api/src/routers/dei';
import { deiService } from '../../packages/api/src/services/dei.service';

// tRPC v11 introspection, same shape used by tests/external-validation/external-router-wiring.test.ts:
// router._def.procedures is the flat Record<string, Procedure>; the procedure kind is at _def.type.
const procedures = (deiRouter as unknown as { _def: { procedures: Record<string, { _def: { type?: string } }> } })._def
  .procedures;

describe('dei router — residual TS surface (#60)', () => {
  it('exposes EXACTLY one procedure: generateReport', () => {
    expect(Object.keys(procedures).sort()).toEqual(['generateReport']);
  });

  it('generateReport is RETAINED and is a mutation (never ported to C# — deleting it removes capability)', () => {
    const proc = procedures['generateReport'];
    expect(proc, 'generateReport was deleted — there is no C# replacement to delete it in favour of').toBeDefined();
    expect(proc._def.type).toBe('mutation');
  });

  it.each(['getEthnicityDistribution', 'getDisabilityDistribution'])(
    'the Slice-11b read %s is gone from the TS router (C# is the sole implementation)',
    (name) => {
      expect(procedures[name]).toBeUndefined();
    },
  );
});

describe('dei service — the two reads survive as generateReport data sources, unexposed (#60)', () => {
  // The router procedures went; the SERVICE methods did not, because generateReport reads them and
  // nothing else does. If a cleanup deletes these as "dead code" the export silently loses a section.
  it.each(['getEthnicityDistribution', 'getDisabilityDistribution'])('deiService.%s is still callable', (name) => {
    expect(typeof (deiService as unknown as Record<string, unknown>)[name]).toBe('function');
  });
});
