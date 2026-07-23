import {
  convertMoneyWithRate,
  DEFAULT_CURRENCY,
  normalizeCurrencyCode,
  PLATFORM_BILLING_CURRENCY,
  roundMoney as roundMoneyShared,
  sumMoneyWithRates,
} from '@tims/shared';

const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev';
const RATE_TTL_MS = 6 * 60 * 60 * 1000;

export interface FxRate {
  base: string;
  quote: string;
  rate: number;
  provider: 'frankfurter' | 'identity';
  asOf: string;
  fetchedAt: string;
}

export interface ConvertedMoney {
  originalAmount: number;
  originalCurrency: string;
  amount: number;
  currency: string;
  rate: number;
  provider: FxRate['provider'];
  asOf: string;
}

const rateCache = new Map<string, FxRate>();

export function clearFxRateCacheForTest(): void {
  rateCache.clear();
}

function cacheKey(base: string, quote: string): string {
  return `${base}:${quote}`;
}

// roundMoney lives in @tims/shared now (the SINGLE source the C# port mirrors, golden-fixtured both stacks);
// re-exported here so existing importers are unchanged. Definition is byte-identical to the prior local one.
export const roundMoney = roundMoneyShared;

export async function getFxRate(baseInput: string, quoteInput: string, now = new Date()): Promise<FxRate> {
  const base = normalizeCurrencyCode(baseInput);
  const quote = normalizeCurrencyCode(quoteInput);
  if (base === quote) {
    return {
      base,
      quote,
      rate: 1,
      provider: 'identity',
      asOf: now.toISOString().slice(0, 10),
      fetchedAt: now.toISOString(),
    };
  }

  const key = cacheKey(base, quote);
  const cached = rateCache.get(key);
  if (cached && now.getTime() - new Date(cached.fetchedAt).getTime() < RATE_TTL_MS) {
    return cached;
  }

  const response = await fetch(`${FRANKFURTER_BASE_URL}/v2/rate/${base}/${quote}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`fx_rate_unavailable:${base}:${quote}:${response.status}`);
  }

  const payload = await response.json() as {
    date?: string;
    base?: string;
    quote?: string;
    rate?: number;
  };
  const rate = Number(payload.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`fx_rate_invalid:${base}:${quote}`);
  }

  const fxRate: FxRate = {
    base,
    quote,
    rate,
    provider: 'frankfurter',
    asOf: payload.date ?? now.toISOString().slice(0, 10),
    fetchedAt: now.toISOString(),
  };
  rateCache.set(key, fxRate);
  return fxRate;
}

export async function convertMoney(
  amountInput: number,
  fromInput: string | null | undefined,
  toInput: string | null | undefined,
): Promise<ConvertedMoney> {
  const originalCurrency = normalizeCurrencyCode(fromInput, DEFAULT_CURRENCY);
  const currency = normalizeCurrencyCode(toInput, PLATFORM_BILLING_CURRENCY);
  const fx = await getFxRate(originalCurrency, currency);
  // The deterministic money shaping is the shared PURE kernel (Slice 11c, golden-fixtured both stacks); this
  // wrapper only resolves the live FX rate + threads the pin provenance (provider/asOf), which are never fixtured.
  const money = convertMoneyWithRate(Number(amountInput) || 0, originalCurrency, currency, fx.rate);
  return { ...money, provider: fx.provider, asOf: fx.asOf };
}

export async function sumMoney(
  rows: Array<{ amount: number; currency: string | null | undefined }>,
  displayCurrency: string | null | undefined,
): Promise<{ amount: number; currency: string; converted: boolean; ratesAsOf: string | null }> {
  const currency = normalizeCurrencyCode(displayCurrency, PLATFORM_BILLING_CURRENCY);
  // Resolve each row's live FX rate, then fold the arithmetic through the shared PURE kernel (Slice 11c). The
  // rate DATES stay here (pin/provider-derived, never fixtured); the total + `converted` are the pure kernel's.
  const resolved: Array<{ amount: number; from: string; rate: number }> = [];
  const rateDates: string[] = [];
  for (const row of rows) {
    const from = normalizeCurrencyCode(row.currency, DEFAULT_CURRENCY);
    const fx = await getFxRate(from, currency);
    resolved.push({ amount: Number(row.amount) || 0, from, rate: fx.rate });
    if (fx.provider !== 'identity') {
      rateDates.push(fx.asOf);
    }
  }

  const summed = sumMoneyWithRates(resolved, currency);
  const ratesAsOf = rateDates.sort()[0] ?? null;
  return { amount: summed.amount, currency, converted: summed.converted, ratesAsOf };
}
