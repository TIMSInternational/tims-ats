import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../../apps/web/lib/i18n/en.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));

import { TalentPoolFilters } from '../../apps/web/app/(admin)/recruitment/talent-pools/talent-pool-filters';
import { TalentPoolResultsHeader } from '../../apps/web/app/(admin)/recruitment/talent-pools/talent-pool-results-header';
import type { TalentPoolFilterState } from '../../apps/web/app/(admin)/recruitment/talent-pools/page';

const FILTERS: TalentPoolFilterState = {
  search: '',
  poolTypes: [],
  fitMin: 0,
  skills: [],
  locations: [],
  experienceLevels: [],
  sort: 'fit',
};

describe('talent pools show no placeholder content', () => {
  it('filters panel has no saved-searches block with canned entries', () => {
    const { container } = render(
      <TalentPoolFilters filters={FILTERS} onFilterChange={() => undefined} onClear={() => undefined} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain(en.talentPool.savedSearches);
    expect(text).not.toContain(en.talentPool.saveCurrentSearch);
    expect(text).not.toMatch(/Sr\. Engineers LATAM|Product roles Bogota/);
  });

  it('results header has no buttons that do nothing', () => {
    const { container } = render(
      <TalentPoolResultsHeader totalCount={0} filters={FILTERS} onFilterChange={() => undefined} />,
    );
    // Every remaining control must be wired: the only one left is the sort select.
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('the hardcoded AI recommendations bar is gone', () => {
    expect(
      existsSync(resolve(__dirname, '../../apps/web/app/(admin)/recruitment/talent-pools/talent-pool-ai-bar.tsx')),
    ).toBe(false);
  });
});
