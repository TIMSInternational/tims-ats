import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const page = () => readFileSync(
  join(ROOT, 'apps/web/app/(admin)/recruitment/candidates/[id]/page.tsx'),
  'utf8',
);

describe('candidate detail tabs', () => {
  it('routes every visible tab key to an active panel', () => {
    const src = page();
    const tabKeys = [...src.matchAll(/'tab[A-Za-z]+'/g)]
      .map((m) => m[0].slice(1, -1))
      .filter((key, index, arr) => arr.indexOf(key) === index);
    const switchCases = [...src.matchAll(/case '(tab[A-Za-z]+)'/g)].map((m) => m[1]);

    expect(tabKeys).toEqual([
      'tabProfile',
      'tabApplications',
      'tabAssessments',
      'tabInterviews',
      'tabFitGaps',
      'tabDocuments',
      'tabValidations',
      'tabTimeline',
      'tabNotes',
    ]);
    expect(switchCases).toEqual(expect.arrayContaining(tabKeys));
  });

  it('uses non-submit tab buttons so tab changes are local UI state only', () => {
    expect(page()).toContain('type="button"');
  });
});
