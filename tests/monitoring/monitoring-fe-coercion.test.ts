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
import { numberOrNull } from '../../apps/web/lib/platform-api/monitoring';

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
