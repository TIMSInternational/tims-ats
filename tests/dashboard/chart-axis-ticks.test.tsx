import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatCurrencyTick } from '../../apps/web/app/(admin)/dashboard/dashboard-utils';

// The platform dashboard's money axes were clipped to "mil US$" in Spanish: the full compact currency
// is wider than the axis column. Ticks now read "$14,5 mil" / "$14.5K", the number always first.
const plain = (text: string) => text.replace(/[  ]/g, ' ');
const ROOT = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const CHARTS = 'apps/web/app/(admin)/dashboard/charts';

describe('formatCurrencyTick', () => {
  it('keeps the number and drops the wide "US$" suffix in Spanish', () => {
    expect(plain(formatCurrencyTick(14500, 'ES'))).toBe('$14,5 mil');
    expect(plain(formatCurrencyTick(0, 'ES'))).toBe('$0');
  });

  it('reads as a compact dollar amount in English', () => {
    expect(formatCurrencyTick(14500, 'EN')).toBe('$14.5K');
    expect(formatCurrencyTick(1_200_000, 'EN')).toBe('$1.2M');
  });

  it('fits the 64 px axis at both locales (at most 9 characters at 11 px)', () => {
    for (const v of [0, 950, 14500, 120000, 999000, 1_200_000]) {
      expect(plain(formatCurrencyTick(v, 'ES')).length).toBeLessThanOrEqual(9);
      expect(formatCurrencyTick(v, 'EN').length).toBeLessThanOrEqual(9);
    }
  });
});

describe('dashboard chart axes', () => {
  it.each(['mrr-trend-chart.tsx', 'mrr-forecast-chart.tsx', 'revenue-by-customer.tsx'])(
    '%s formats money ticks with the short formatter',
    (file) => {
      const src = read(`${CHARTS}/${file}`);
      expect(src).toContain('formatCurrencyTick(v, locale)');
      expect(src).not.toContain('formatCurrency(v, locale, true)');
    },
  );

  it('the forecast month axis drops colliding labels instead of forcing every third one', () => {
    const src = read(`${CHARTS}/mrr-forecast-chart.tsx`);
    expect(src).toContain('interval="preserveStartEnd"');
    expect(src).not.toContain('interval={2}');
  });

  it('revenue by customer names every bar and grows with the row count', () => {
    const src = read(`${CHARTS}/revenue-by-customer.tsx`);
    expect(src).toContain('interval={0}');
    expect(src).toContain('height={chartData.length * ROW_HEIGHT + AXIS_HEIGHT}');
  });
});
