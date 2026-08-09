import { describe, it, expect } from 'vitest';

/**
 * monitoring-fe-coercion.test.ts — Phase-5 Q0b slice 1 (issue #100).
 *
 * The C# minimal-API OpenAPI contract types every numeric field as `number | string`, so the FE
 * wrapper coerces each one back. Two of those fields are nullable BECAUSE THEY ARE K-ANONYMITY
 * SUPPRESSED — `executive-kpis.pendingAdjustments` and each trend point's `value`.
 *
 * `Number(null) === 0`, so a bare `Number()` on those would render a suppressed cell as a
 * fabricated **0**: a disclosure-shaped bug that also hides the fact that suppression happened.
 * This pins the null-preserving helper the wrapper actually uses.
 */
import { numberOrNull, mapActiveAlert, mapActionPlanAlert } from '../../apps/web/lib/platform-api/monitoring';

describe('numberOrNull — suppression must survive the OpenAPI number-as-string coercion', () => {
  it('preserves null (a SUPPRESSED value must never render as 0)', () => {
    expect(numberOrNull(null)).toBeNull();
  });

  it('preserves undefined as null rather than NaN', () => {
    expect(numberOrNull(undefined)).toBeNull();
  });

  it('coerces the string form the contract emits', () => {
    expect(numberOrNull('7')).toBe(7);
    expect(numberOrNull('0')).toBe(0);
  });

  it('passes real numbers through, including a genuine zero', () => {
    // A real 0 is NOT suppression — an empty bucket identifies nobody and must stay a 0.
    expect(numberOrNull(0)).toBe(0);
    expect(numberOrNull(42)).toBe(42);
  });

  it('is distinguishable from a bare Number() on the null input', () => {
    // The bug this guards against, stated explicitly.
    expect(Number(null)).toBe(0);
    expect(numberOrNull(null)).not.toBe(0);
  });
});

// ── Date reconstruction ───────────────────────────────────────────────────────────────────────
//
// The C# contract types every timestamp as an ISO STRING; the tRPC path returns a real `Date`
// (packages/api/src/trpc.ts sets `transformer: superjson`, so a Prisma DateTime survives as a Date
// on the client). Passing the string through would make flipping
// NEXT_PUBLIC_MONITORING_READ_VIA_CSHARP silently change `createdAt`/`dueDate` from Date to string
// — breaking the wrapper's own stated invariant ("shape-identical to the tRPC output") and any
// consumer that calls a Date method. Every other platform-api wrapper already reconstructs.
//
// These exercise the REAL ROW MAPPERS the hooks call, not the `toDate` helper in isolation: a test
// of the helper alone would prove the helper works, not that the wrapper uses it.

describe('date reconstruction — the C# path must return Date, not the raw ISO string', () => {
  it('mapActiveAlert reconstructs createdAt as a Date', () => {
    const out = mapActiveAlert({
      id: 'a1',
      severity: 'high',
      module: 'engagement',
      title: 't',
      message: 'm',
      createdAt: '2026-08-09T01:23:45.000Z',
    });
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.createdAt.toISOString()).toBe('2026-08-09T01:23:45.000Z');
  });

  it('mapActionPlanAlert reconstructs dueDate as a Date', () => {
    const out = mapActionPlanAlert({
      id: 'p1',
      title: 't',
      area: null,
      status: 'overdue',
      dueDate: '2026-08-10T00:00:00.000Z',
      responsible: { id: 'u1', firstName: 'A', lastName: 'B', avatar: null },
    });
    expect(out.dueDate).toBeInstanceOf(Date);
    expect((out.dueDate as Date).toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('a NULL dueDate stays null — never epoch 0', () => {
    // `new Date(null)` is 1970-01-01, so a bare toDate() here would invent a due date in the past
    // and light up the "overdue" surface. Same failure shape as Number(null) === 0 above.
    const out = mapActionPlanAlert({
      id: 'p2',
      title: 't',
      status: 'open',
      dueDate: null,
      responsible: { id: 'u1', firstName: 'A', lastName: 'B', avatar: null },
    });
    expect(out.dueDate).toBeNull();
    expect(new Date(null as unknown as string).getTime()).toBe(0); // the bug, stated
  });

  it('an ABSENT dueDate key is also null', () => {
    const out = mapActionPlanAlert({
      id: 'p3',
      title: 't',
      status: 'open',
      responsible: { id: 'u1', firstName: 'A', lastName: 'B', avatar: null },
    });
    expect(out.dueDate).toBeNull();
  });
});
