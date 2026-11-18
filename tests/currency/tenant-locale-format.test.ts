import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TENANT_LOCALE } from '../../apps/web/lib/tenant-locale';
import { formatCurrency } from '../../apps/web/lib/format-utils';
import { CANDIDATE_INTL_LOCALE } from '../../apps/web/lib/candidate-format';

// Money and dates in the web app follow ONE tenant locale (es-CR for the pilot tenant): never en-US
// ("$1,234.50") nor es-CO ("96.000.000"). es-CR groups digits with a no-break space.
const plain = (text: string) => text.replace(/[  ]/g, ' ');
const ROOT = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('tenant locale', () => {
  it('is es-CR and drives the candidate-facing Spanish locale', () => {
    expect(TENANT_LOCALE).toBe('es-CR');
    expect(CANDIDATE_INTL_LOCALE.ES).toBe(TENANT_LOCALE);
  });
});

describe('formatCurrency (staff tables and detail pages)', () => {
  it('shows colones with the ₡ symbol, es-CR grouping and no céntimos', () => {
    expect(plain(formatCurrency(1_200_000, 'CRC'))).toBe('₡1 200 000');
    expect(plain(formatCurrency(1_200_000, 'crc'))).toBe('₡1 200 000');
  });

  it('keeps an ISO code for dollars — never a bare "$" or en-US separators', () => {
    const text = formatCurrency(1_234.5, 'USD');
    expect(plain(text)).toBe('USD 1 234,50');
    expect(text).not.toContain('$');
    expect(text).not.toContain('1,234.50');
  });

  it('honours an explicit decimals override', () => {
    expect(plain(formatCurrency(99, 'USD', 0))).toBe('USD 99');
  });
});

describe('no hard-coded es-CO / en-US money or date locale in the touched helpers', () => {
  it.each([
    'apps/web/lib/format-utils.ts',
    'apps/web/lib/offer-salary.ts',
    'apps/web/app/interview/join/[token]/interview-join.tsx',
    'apps/web/app/(admin)/dashboard/dashboard-utils.tsx',
  ])('%s', (path) => {
    expect(read(path)).not.toMatch(/['"]es-CO['"]/);
  });

  it('formatCurrency no longer formats with en-US', () => {
    expect(read('apps/web/lib/format-utils.ts')).not.toMatch(/NumberFormat\(\s*['"]en-US['"]/);
  });
});
