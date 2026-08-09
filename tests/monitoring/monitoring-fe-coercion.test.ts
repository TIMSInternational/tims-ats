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
import {
  numberOrNull,
  mapActiveAlert,
  mapActionPlanAlert,
  mapExecutiveKpis,
  mapTrendPoint,
} from '../../apps/web/lib/platform-api/monitoring';

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

// ── The REAL numeric mappers ──────────────────────────────────────────────────────────────────
//
// Everything above tests the HELPER. That proves `numberOrNull` preserves null; it does NOT prove
// the wrapper calls it, and only the second fact protects the dashboard. Proven by mutation
// 2026-08-09: swapping both suppression call sites to a bare `Number()` left `apps/web` tsc at
// exit 0 and all 85 monitoring tests green while shipping a fabricated 0 for every suppressed
// value — because `number` widens silently into `number | null`, unlike the Date fields where
// `Date` vs `string` makes the compiler the enforcer. These exercise the mappers the hooks
// actually call, which is what closes that hole.

describe('mapExecutiveKpis — the wrapper must ROUTE pendingAdjustments through numberOrNull', () => {
  const base = {
    totalEmployees: '10',
    activeVacancies: '2',
    pendingAdjustments: null as number | string | null,
    pendingAdjustmentsSuppressed: true,
    activeSurveys: '1',
    openAlerts: '3',
    turnoverRate: '0',
    terminationsLast12m: '0',
  };

  it('a SUPPRESSED pendingAdjustments stays null — never a fabricated 0', () => {
    const out = mapExecutiveKpis(base);
    expect(out.pendingAdjustments).toBeNull();
    expect(out.pendingAdjustments).not.toBe(0);
    expect(out.pendingAdjustmentsSuppressed).toBe(true);
  });

  it('a real count still coerces off the contract string form', () => {
    const out = mapExecutiveKpis({ ...base, pendingAdjustments: '7', pendingAdjustmentsSuppressed: false });
    expect(out.pendingAdjustments).toBe(7);
  });

  it('a genuine 0 is preserved as 0, not confused with suppression', () => {
    // An empty bucket identifies nobody — 0 is a real answer and must not be masked.
    const out = mapExecutiveKpis({ ...base, pendingAdjustments: 0, pendingAdjustmentsSuppressed: false });
    expect(out.pendingAdjustments).toBe(0);
  });

  it('the non-suppressed numerics still coerce to numbers', () => {
    const out = mapExecutiveKpis(base);
    expect(out.totalEmployees).toBe(10);
    expect(out.openAlerts).toBe(3);
  });
});

describe('mapTrendPoint — a suppressed trend point must stay null', () => {
  it('null value survives (the all-or-nothing engagement floor)', () => {
    const out = mapTrendPoint({ month: '2026-08', value: null, suppressed: true });
    expect(out.value).toBeNull();
    expect(out.value).not.toBe(0);
    expect(out.suppressed).toBe(true);
  });

  it('an unsuppressed point coerces the contract string form', () => {
    expect(mapTrendPoint({ month: '2026-08', value: '12', suppressed: false }).value).toBe(12);
  });

  it('a real zero month stays 0', () => {
    expect(mapTrendPoint({ month: '2026-08', value: 0, suppressed: false }).value).toBe(0);
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
