import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));

import { FitBreakdown } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/fit-breakdown';

describe('AI suggestion label on fit scores', () => {
  it('labels the fit breakdown as an AI suggestion that leaves the decision to the recruiter', () => {
    render(
      <FitBreakdown
        fitScores={[
          {
            id: 'f1',
            overallScore: 72,
            breakdown: { assessment: 80, interview: null, experience: 60, education: 70, languages: 50 },
            calculatedAt: new Date('2026-10-01T00:00:00Z'),
          },
        ]}
      />,
    );
    expect(screen.getByTestId('ai-suggestion-notice').textContent).toBe(en.common.aiSuggestionNotice);
  });

  it('has natural copy in both locales', () => {
    expect(en.common.aiSuggestionNotice).toMatch(/AI suggestion/i);
    expect(en.common.aiSuggestionNotice).toMatch(/decision is yours/i);
    expect(es.common.aiSuggestionNotice).toMatch(/Sugerencia de IA/);
    expect(es.common.aiSuggestionNotice).toMatch(/la decisión es tuya/);
  });
});
