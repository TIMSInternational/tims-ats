import { describe, it, expect } from 'vitest';
import {
  currencyCodeSchema,
  salaryAmountSchema,
  vacancySalarySchema,
  vacancySalaryObjectSchema,
  MAX_SALARY_AMOUNT,
} from '@tims/shared';

// WP-09 PR-1. Findings: company-admin-spec-38 / recruiter-spec-52 (the server silently
// defaults the vacancy salary to COP) and platform-owner-data-69 / company-admin-data-64
// (free-text currency, no min <= max, no cap). The schema below is what PR-3 wires into
// the vacancy router, so it must require a real ISO-4217 code and bound the amounts.
//
// Written to run on zod 3 (main) and zod 4 (#382): messages use `{ message }`, and the
// refined schema is exported next to an unrefined object schema so callers can `.extend`.

const base = { currency: 'CRC', period: 'monthly' as const };

describe('currencyCodeSchema', () => {
  it('normalises case and whitespace', () => {
    expect(currencyCodeSchema.parse(' crc ')).toBe('CRC');
    expect(currencyCodeSchema.parse('clf')).toBe('CLF');
  });

  it.each(['colones', '₡', '', 'ZZZ'])('rejects %j', (raw) => {
    expect(currencyCodeSchema.safeParse(raw).success).toBe(false);
  });
});

describe('salaryAmountSchema', () => {
  it('caps at MAX_SALARY_AMOUNT (1e12)', () => {
    expect(MAX_SALARY_AMOUNT).toBe(1_000_000_000_000);
    expect(salaryAmountSchema.safeParse(MAX_SALARY_AMOUNT).success).toBe(true);
    expect(salaryAmountSchema.safeParse(1e13).success).toBe(false);
  });

  it('rejects negatives', () => {
    expect(salaryAmountSchema.safeParse(-1).success).toBe(false);
  });

  it('keeps decimals', () => {
    expect(salaryAmountSchema.parse(1500000.5)).toBe(1500000.5);
  });
});

describe('vacancySalarySchema', () => {
  it('rejects a missing currency (no silent COP default)', () => {
    const r = vacancySalarySchema.safeParse({ min: 100, max: 200, period: 'monthly' });
    expect(r.success).toBe(false);
  });

  it('rejects a non-ISO currency such as "colones"', () => {
    const r = vacancySalarySchema.safeParse({ ...base, currency: 'colones', min: 1 });
    expect(r.success).toBe(false);
  });

  it('rejects min greater than max, reported on the max path', () => {
    const r = vacancySalarySchema.safeParse({ ...base, min: 2_000_000, max: 1_000_000 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.join('.') === 'max');
      expect(issue?.message).toBe('salary_min_gt_max');
    }
  });

  it('rejects an amount above the cap', () => {
    expect(vacancySalarySchema.safeParse({ ...base, max: 1e13 }).success).toBe(false);
  });

  it.each([Infinity, -Infinity, NaN])('rejects the non-finite amount %s', (v) => {
    const r = vacancySalarySchema.safeParse({ ...base, min: v });
    expect(r.success).toBe(false);
    // Rejected AS non-finite, not only by the bounds: zod 3 reports `not_finite` via
    // `.finite()`, zod 4 rejects ±Infinity and NaN as `invalid_type`.
    if (!r.success) {
      const codes = r.error.issues.filter((i) => i.path.join('.') === 'min').map((i) => String(i.code));
      expect(codes.some((c) => c === 'not_finite' || c === 'invalid_type')).toBe(true);
    }
  });

  it('rejects a missing or unknown period', () => {
    expect(vacancySalarySchema.safeParse({ currency: 'CRC', min: 1 }).success).toBe(false);
    expect(vacancySalarySchema.safeParse({ ...base, period: 'weekly' }).success).toBe(false);
  });

  it('accepts min only, max only, and min equal to max', () => {
    expect(vacancySalarySchema.safeParse({ ...base, min: 850_000 }).success).toBe(true);
    expect(vacancySalarySchema.safeParse({ ...base, max: 850_000 }).success).toBe(true);
    expect(vacancySalarySchema.safeParse({ ...base, min: 850_000, max: 850_000 }).success).toBe(true);
  });

  it('normalises the currency in the parsed output', () => {
    const r = vacancySalarySchema.parse({ ...base, currency: 'crc', min: 850_000 });
    expect(r.currency).toBe('CRC');
  });
});

describe('vacancySalaryObjectSchema', () => {
  it('is extendable (unrefined object, for PR-3 callers on zod 3)', () => {
    const extended = vacancySalaryObjectSchema.extend({ note: salaryAmountSchema.optional() });
    expect(extended.safeParse({ ...base, min: 1 }).success).toBe(true);
  });
});
