import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pilot UX re-audit company-admin data-62 (vacancy half; proof-run F-4 suspect): a vacancy salary sent without
// a currency no longer becomes COP. It resolves to the organization's currency, then its company's, then the
// legacy fallback, and every lookup is scoped by organizationId.

const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VAC = '33333333-3333-4333-8333-333333333333';
const COMPANY = '44444444-4444-4444-8444-444444444444';

const mockDb = vi.hoisted(() => ({
  organization: { findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
  vacancy: { findFirst: vi.fn() },
}));

vi.mock('@tims/db', () => ({ tenantDb: mockDb }));

import { withResolvedCurrency } from '../../packages/api/src/routers/vacancy/vacancy-currency';
import { salarySchema } from '../../packages/api/src/routers/vacancy/crud';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.organization.findFirst.mockResolvedValue({ settings: { currency: 'CRC' } });
  mockDb.company.findFirst.mockResolvedValue({ currency: 'USD' });
  mockDb.vacancy.findFirst.mockResolvedValue({ company: { currency: 'EUR' } });
});

describe('vacancy salary schema', () => {
  it('no longer injects COP when the currency is omitted', () => {
    expect(salarySchema.parse({ min: 1 })).toEqual({ min: 1, period: 'monthly' });
  });

  it('carries no COP default in source', () => {
    const src = readFileSync(join(__dirname, '../../packages/api/src/routers/vacancy/crud.ts'), 'utf8');
    expect(src).not.toMatch(/default\(['"]COP['"]\)/);
  });
});

describe('withResolvedCurrency', () => {
  it('keeps a currency the caller sent, normalised, without a lookup', async () => {
    await expect(withResolvedCurrency(ORG, { min: 1, currency: ' crc ', period: 'monthly' }, {})).resolves.toEqual({
      min: 1,
      currency: 'CRC',
      period: 'monthly',
    });
    expect(mockDb.organization.findFirst).not.toHaveBeenCalled();
  });

  it('is undefined when no salary was sent', async () => {
    await expect(withResolvedCurrency(ORG, undefined, {})).resolves.toBeUndefined();
  });

  it('uses the organization currency first', async () => {
    const out = await withResolvedCurrency(ORG, { min: 1, period: 'monthly' }, { companyId: COMPANY });
    expect(out?.currency).toBe('CRC');
    expect(mockDb.organization.findFirst).toHaveBeenCalledWith({ where: { id: ORG }, select: { settings: true } });
    expect(mockDb.company.findFirst).toHaveBeenCalledWith({
      where: { id: COMPANY, organizationId: ORG },
      select: { currency: true },
    });
  });

  it('falls back to the company currency when the organization has none', async () => {
    mockDb.organization.findFirst.mockResolvedValue({ settings: {} });
    const out = await withResolvedCurrency(ORG, { period: 'yearly' }, { companyId: COMPANY });
    expect(out?.currency).toBe('USD');
  });

  it('on an edit that keeps the company, reads the vacancy company in this organization', async () => {
    mockDb.organization.findFirst.mockResolvedValue({ settings: null });
    const out = await withResolvedCurrency(ORG, { period: 'monthly' }, { vacancyId: VAC });
    expect(out?.currency).toBe('EUR');
    expect(mockDb.vacancy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VAC, organizationId: ORG } }),
    );
  });

  it('never resolves to COP by default (legacy fallback is USD, as for offers)', async () => {
    mockDb.organization.findFirst.mockResolvedValue(null);
    const out = await withResolvedCurrency(ORG, { period: 'monthly' }, { companyId: null });
    expect(out?.currency).toBe('USD');
    expect(mockDb.company.findFirst).not.toHaveBeenCalled();
  });
});
