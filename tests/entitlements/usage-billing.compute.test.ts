import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../packages/api/src/services/entitlement.service', () => ({ getOrgEntitlementsAdmin: vi.fn() }));
vi.mock('../../packages/api/src/services/usage-metering.service', async (orig) => ({
  ...(await orig()), getModuleUsage: vi.fn(),
}));
import * as ent from '../../packages/api/src/services/entitlement.service';
import * as meter from '../../packages/api/src/services/usage-metering.service';
import { computeUsageBilling, buildUsageInvoiceLines } from '../../packages/api/src/services/usage-billing.service';

const start = new Date('2026-07-01'); const end = new Date('2026-07-31');
function ent1(over: Partial<Record<string, unknown>> = {}) {
  return { moduleCode: 'ai_screening', name: 'Filtro IA', kind: 'core', metered: true, unit: 'screenings',
           enabled: true, source: 'plan', limit: 5000, unitPrice: null, effectiveUnitPrice: 0.5, ...over };
}
beforeEach(() => { vi.clearAllMocks(); });

it('bills only overage for a module with a limit', async () => {
  vi.mocked(ent.getOrgEntitlementsAdmin).mockResolvedValue([ent1()] as never);
  vi.mocked(meter.getModuleUsage).mockResolvedValue({ quantity: 6000, unit: 'screenings' });
  const p = await computeUsageBilling('org-1', start, end);
  expect(p.lines[0]).toMatchObject({ quantity: 6000, includedQty: 5000, billableQty: 1000, unitPrice: 0.5, amountUsd: 500 });
  expect(p.subtotalUsd).toBe(500);
});

it('bills all usage when limit is null (voice minutes)', async () => {
  vi.mocked(ent.getOrgEntitlementsAdmin).mockResolvedValue([
    { moduleCode: 'ai_voice_interview', name: 'Voz', kind: 'addon', metered: true, unit: 'minutes',
      enabled: true, source: 'addon', limit: null, unitPrice: 0.15, effectiveUnitPrice: 0.15 },
  ] as never);
  vi.mocked(meter.getModuleUsage).mockResolvedValue({ quantity: 120, unit: 'minutes' });
  const p = await computeUsageBilling('org-1', start, end);
  expect(p.lines[0]).toMatchObject({ billableQty: 120, amountUsd: 18 });
});

it('skips disabled / non-metered / unmapped modules', async () => {
  vi.mocked(ent.getOrgEntitlementsAdmin).mockResolvedValue([
    ent1({ enabled: false }),
    { moduleCode: 'vacancies', name: 'Vac', kind: 'core', metered: false, unit: null, enabled: true, source: 'plan', limit: null, unitPrice: null, effectiveUnitPrice: null },
  ] as never);
  vi.mocked(meter.getModuleUsage).mockResolvedValue({ quantity: 100, unit: 'x' });
  const p = await computeUsageBilling('org-1', start, end);
  expect(p.lines).toHaveLength(0);
});

it('buildUsageInvoiceLines drops zero-amount lines, quantity always 1', () => {
  const lines = buildUsageInvoiceLines({ subtotalUsd: 18, lines: [
    { moduleCode: 'ai_voice_interview', name: 'Voz', unit: 'minutes', quantity: 120, includedQty: 0, billableQty: 120, unitPrice: 0.15, amountUsd: 18 },
    { moduleCode: 'ai_screening', name: 'Filtro', unit: 'screenings', quantity: 10, includedQty: 5000, billableQty: 0, unitPrice: 0.5, amountUsd: 0 },
  ] });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ quantity: 1, unitPrice: 18 });
  expect(lines[0].description).toContain('120');
});
