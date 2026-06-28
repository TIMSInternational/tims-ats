// tests/access/ai-interview-billing.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  computeInterviewBillableUsd,
  buildAiInterviewInvoiceLines,
} from '../../packages/api/src/services/ai-interview-billing';

describe('computeInterviewBillableUsd', () => {
  it('prorates per second and rounds up to 2 decimals', () => {
    // 90s @ $0.20/min = $0.30
    expect(computeInterviewBillableUsd(90, 0.2)).toBe(0.3);
    // 61s @ $0.15/min = 0.1525 → ceil to 0.16
    expect(computeInterviewBillableUsd(61, 0.15)).toBe(0.16);
  });
  it('returns 0 for null/zero/negative rate or non-positive duration', () => {
    expect(computeInterviewBillableUsd(600, null)).toBe(0);
    expect(computeInterviewBillableUsd(600, 0)).toBe(0);
    expect(computeInterviewBillableUsd(600, -1)).toBe(0);
    expect(computeInterviewBillableUsd(0, 0.2)).toBe(0);
    expect(computeInterviewBillableUsd(-5, 0.2)).toBe(0);
  });
});

describe('buildAiInterviewInvoiceLines', () => {
  it('includes an add-on line when fee > 0', () => {
    const lines = buildAiInterviewInvoiceLines({ addonMonthlyFeeUsd: 199, usageUsd: 0, addonLabel: 'Add-on', usageLabel: 'Usage' });
    expect(lines).toEqual([{ description: 'Add-on', quantity: 1, unitPrice: 199 }]);
  });
  it('includes a usage line when usage > 0', () => {
    const lines = buildAiInterviewInvoiceLines({ addonMonthlyFeeUsd: null, usageUsd: 12.5, addonLabel: 'Add-on', usageLabel: 'Usage' });
    expect(lines).toEqual([{ description: 'Usage', quantity: 1, unitPrice: 12.5 }]);
  });
  it('includes both, add-on first', () => {
    const lines = buildAiInterviewInvoiceLines({ addonMonthlyFeeUsd: 199, usageUsd: 12.5, addonLabel: 'Add-on', usageLabel: 'Usage' });
    expect(lines.map((l) => l.description)).toEqual(['Add-on', 'Usage']);
  });
  it('is empty when neither applies', () => {
    expect(buildAiInterviewInvoiceLines({ addonMonthlyFeeUsd: 0, usageUsd: 0, addonLabel: 'Add-on', usageLabel: 'Usage' })).toEqual([]);
  });
  it('applies ceilUsd guard to noisy DB SUM (0.1+0.2 → 0.3 not 0.31)', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754; without the guard,
    // Math.ceil(0.30000000000000004 * 100) / 100 = 0.31 (wrong).
    const lines = buildAiInterviewInvoiceLines({
      addonMonthlyFeeUsd: null,
      usageUsd: 0.1 + 0.2,
      addonLabel: 'A',
      usageLabel: 'Usage',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.unitPrice).toBe(0.3);
  });
});

describe('webhook freezes billable usage', () => {
  const src = readFileSync(resolve(__dirname, '../../packages/api/src/services/ai-interview.service.ts'), 'utf8');
  it('computes + stores billableUsd from the org config rate', () => {
    expect(src).toContain('computeInterviewBillableUsd');
    expect(src).toContain('loadAiInterviewConfig');
    expect(src).toContain('billableUsd');
  });
});
