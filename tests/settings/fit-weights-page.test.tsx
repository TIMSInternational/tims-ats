import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// D-17: "Pesos FIT" asked for an assessment weight although assessments are hidden in the pilot, never
// said what the weights do, showed an empty header-only table and raw decimals.
const { profiles, upsert } = vi.hoisted(() => ({
  profiles: { data: [] as Array<{ id: string; name: string; weights: Record<string, number> }> },
  upsert: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ fitEngine: { listRoleFamilyWeightProfiles: { invalidate: vi.fn() } } }),
    fitEngine: {
      listRoleFamilyWeightProfiles: { useQuery: () => ({ isLoading: false, isError: false, data: profiles.data, refetch: vi.fn() }) },
      upsertRoleFamilyWeightProfile: { useMutation: () => ({ mutate: upsert, isPending: false }) },
    },
  },
}));

async function loadPage(scope: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', scope);
  return (await import('../../apps/web/app/(admin)/settings/fit-weights/page')).default;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  upsert.mockReset();
  profiles.data = [];
});

describe('FIT weights settings', () => {
  it('explains the weights and shows an empty state instead of a header-only table', async () => {
    const Page = await loadPage('pilot');
    render(<Page />);
    expect(screen.getByText(es.fitWeights.explainer)).toBeTruthy();
    expect(screen.getByText(es.fitWeights.empty)).toBeTruthy();
  });

  it('under the pilot, does not ask for an assessment weight and saves it as 0', async () => {
    const Page = await loadPage('pilot');
    render(<Page />);
    expect(screen.queryAllByText(es.fitWeights.weightAssessment)).toHaveLength(0);
    fireEvent.click(screen.getByText(es.fitWeights.createButton));
    fireEvent.change(screen.getByPlaceholderText(es.fitWeights.profileNamePlaceholder), { target: { value: 'ventas' } });
    fireEvent.click(screen.getByText(es.fitWeights.saveButton));
    expect(upsert).toHaveBeenCalledWith({
      name: 'ventas',
      weights: { assessment: 0, interview: 0.25, experience: 0.25, education: 0.25, languages: 0.25 },
    });
  });

  it('shows weights as percentages, and keeps the assessment column in the full product', async () => {
    profiles.data = [
      { id: 'p1', name: 'Default', weights: { assessment: 0.2, interview: 0.2, experience: 0.2, education: 0.2, languages: 0.2 } },
    ];
    const Page = await loadPage('');
    render(<Page />);
    expect(screen.getAllByText('20 %')).toHaveLength(5);
    expect(screen.getByText(es.fitWeights.weightAssessment)).toBeTruthy();
  });
});
