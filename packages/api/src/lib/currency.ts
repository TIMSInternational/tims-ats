import {
  DEFAULT_CURRENCY,
  normalizeCurrencyCode,
  PLATFORM_BILLING_CURRENCY,
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

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

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
  const originalAmount = Number(amountInput) || 0;
  const originalCurrency = normalizeCurrencyCode(fromInput, DEFAULT_CURRENCY);
  const currency = normalizeCurrencyCode(toInput, PLATFORM_BILLING_CURRENCY);
  const fx = await getFxRate(originalCurrency, currency);
  return {
    originalAmount,
    originalCurrency,
    amount: roundMoney(originalAmount * fx.rate),
    currency,
    rate: fx.rate,
    provider: fx.provider,
    asOf: fx.asOf,
  };
}

export async function sumMoney(
  rows: Array<{ amount: number; currency: string | null | undefined }>,
  displayCurrency: string | null | undefined,
): Promise<{ amount: number; currency: string; converted: boolean; ratesAsOf: string | null }> {
  const currency = normalizeCurrencyCode(displayCurrency, PLATFORM_BILLING_CURRENCY);
  let total = 0;
  let converted = false;
  const rateDates: string[] = [];

  for (const row of rows) {
    const convertedMoney = await convertMoney(row.amount, row.currency, currency);
    total += convertedMoney.amount;
    converted ||= convertedMoney.originalCurrency !== currency;
    if (convertedMoney.provider !== 'identity') {
      rateDates.push(convertedMoney.asOf);
    }
  }

  const ratesAsOf = rateDates.sort()[0] ?? null;
  return { amount: roundMoney(total), currency, converted, ratesAsOf };
}
