import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import robots from '../../apps/web/app/robots';

describe('robots.txt policy', () => {
  it('allows only the public careers portal and disallows everything else', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule?.userAgent).toBe('*');
    expect(rule?.allow).toEqual(['/careers']);
    expect(rule?.disallow).toEqual(['/']);
  });

  it('is reachable without a session (listed as a public path in the middleware)', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/web/middleware.ts'), 'utf8');
    const publicPaths = /const PUBLIC_PATHS = \[([\s\S]*?)\];/.exec(src)?.[1] ?? '';
    expect(publicPaths).toMatch(/'\/robots\.txt'/);
  });
});
