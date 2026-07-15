import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFxRateCacheForTest, convertMoney, sumMoney } from '../../packages/api/src/lib/currency';

describe('currency conversion helpers', () => {
  beforeEach(() => {
    clearFxRateCacheForTest();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call the FX provider for same-currency conversion', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const converted = await convertMoney(123.45, 'cop', 'COP');

    expect(converted).toMatchObject({
      originalAmount: 123.45,
      originalCurrency: 'COP',
      amount: 123.45,
      currency: 'COP',
      rate: 1,
      provider: 'identity',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('converts and sums mixed-currency rows in the requested display currency', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ date: '2026-07-15', base: 'COP', quote: 'USD', rate: 0.00025 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const total = await sumMoney(
      [
        { amount: 100, currency: 'USD' },
        { amount: 400_000, currency: 'COP' },
      ],
      'USD',
    );

    expect(total).toEqual({
      amount: 200,
      currency: 'USD',
      converted: true,
      ratesAsOf: '2026-07-15',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v2/rate/COP/USD',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
