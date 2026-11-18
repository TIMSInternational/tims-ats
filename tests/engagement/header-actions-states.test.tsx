import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// HIG pass (talent-engagement): a page header never offers a primary action the user cannot take, or one
// the empty state already offers (feedback.md › Best practices; buttons.md › Best practices).

type Q = { data?: unknown; isLoading: boolean; isError: boolean; isSuccess: boolean; error: unknown };
const ok = (data: unknown): Q => ({ data, isLoading: false, isError: false, isSuccess: true, error: null });
const denied: Q = { isLoading: false, isError: true, isSuccess: false, error: { status: 403 } };

const { state, stub } = vi.hoisted(() => ({
  stub: () => null,
  state: {
    enps: null as unknown,
    kpis: null as unknown,
    roles: null as unknown,
    cycles: null as unknown,
  },
}));

vi.mock('../../apps/web/lib/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../apps/web/lib/i18n')>()),
  useI18n: () => ({ t: es, locale: 'ES' }),
}));
vi.mock('../../apps/web/lib/platform-api/engagement', () => ({
  useEngagementEnps: () => ({ ...(state.enps as Q), refetch: vi.fn() }),
  useEngagementDashboardKpis: () => ({ ...(state.kpis as Q), refetch: vi.fn() }),
}));
vi.mock('../../apps/web/lib/platform-api/succession', () => {
  const empty = () => ({ ...ok([]), refetch: vi.fn() });
  return {
    useSuccessionDashboardKpis: () => ({ ...ok(undefined), refetch: vi.fn() }),
    useSuccessionCriticalRoles: () => ({ ...(state.roles as Q), refetch: vi.fn() }),
    useSuccessionCompetencyCoverage: empty,
    useSuccessionFlightRisk: empty,
    useSuccessionRolesWithoutSuccessor: empty,
    useSuccessionCompGapAlerts: empty,
  };
});
vi.mock('../../apps/web/lib/platform-api/compensation', () => ({
  useCompensationSalaryBands: () => ({ ...ok([]), refetch: vi.fn() }),
}));
vi.mock('../../apps/web/lib/platform-api/evaluation360', () => ({
  useEvaluation360ListCycles: () => ({ ...(state.cycles as Q), refetch: vi.fn() }),
}));

// The page bodies are not under test here, only the header action.
vi.mock('../../apps/web/app/(admin)/engagement/climate/climate-kpis', () => ({ ClimateKpis: stub }));
vi.mock('../../apps/web/app/(admin)/engagement/climate/climate-heatmap', () => ({ ClimateHeatmap: stub }));
vi.mock('../../apps/web/app/(admin)/engagement/climate/climate-results', () => ({ ClimateResults: stub }));
vi.mock('../../apps/web/app/(admin)/engagement/climate/climate-sidebar', () => ({
  CommentsAnalysis: stub,
  LowClimateAlerts: stub,
}));
vi.mock('../../apps/web/app/(admin)/engagement/climate/climate-bottom', () => ({
  ActionPlans: stub,
  LeaderCommitments: stub,
}));
vi.mock('../../apps/web/app/(admin)/engagement/climate/launch-survey-modal', () => ({ LaunchSurveyModal: stub }));
vi.mock('../../apps/web/app/(admin)/talent/succession/succession-kpis', () => ({ SuccessionKpis: stub }));
vi.mock('../../apps/web/app/(admin)/talent/succession/succession-pipeline', () => ({ SuccessionPipeline: stub }));
vi.mock('../../apps/web/app/(admin)/talent/succession/competency-coverage', () => ({ CompetencyCoverage: stub }));
vi.mock('../../apps/web/app/(admin)/talent/succession/flight-risk-panel', () => ({ FlightRiskPanel: stub }));
vi.mock('../../apps/web/app/(admin)/talent/succession/roles-without-successor', () => ({
  RolesWithoutSuccessor: stub,
}));
vi.mock('../../apps/web/app/(admin)/talent/succession/exit-simulator', () => ({ ExitSimulator: stub }));
vi.mock('../../apps/web/app/(admin)/talent/succession/add-successor-modal', () => ({ AddSuccessorModal: stub }));
vi.mock('../../apps/web/app/(admin)/talent/succession/suggested-successors', () => ({ SuggestedSuccessors: stub }));
vi.mock('../../apps/web/app/(admin)/talent/360/create-cycle-form', () => ({ CreateCycleForm: stub }));
vi.mock('../../apps/web/app/(admin)/talent/360/cycle-manage-modal', () => ({ CycleManageModal: stub }));

import ClimatePage from '../../apps/web/app/(admin)/engagement/climate/page';
import SuccessionPage from '../../apps/web/app/(admin)/talent/succession/page';
import Evaluation360Page from '../../apps/web/app/(admin)/talent/360/page';

const button = (name: string) => screen.queryByRole('button', { name: new RegExp(name) });

beforeEach(() => {
  state.enps = ok(null);
  state.kpis = ok(null);
  state.roles = ok([{ id: 'r1' }]);
  state.cycles = ok([]);
});

describe('climate header', () => {
  it('offers "Lanzar encuesta" when the page can be read', () => {
    render(<ClimatePage />);
    expect(button(es.climate.launchSurvey)).not.toBeNull();
  });

  it('hides "Lanzar encuesta" while the page shows its no-access state', () => {
    state.enps = denied;
    render(<ClimatePage />);
    expect(screen.getByText(es.common.errorForbidden)).toBeTruthy();
    expect(button(es.climate.launchSurvey)).toBeNull();
  });
});

describe('succession header', () => {
  it('offers "Agregar sucesor" when critical roles exist', () => {
    render(<SuccessionPage />);
    expect(button(es.succession.addSuccessor)).not.toBeNull();
  });

  it('hides "Agregar sucesor" when there are no critical roles to add one to', () => {
    state.roles = ok([]);
    render(<SuccessionPage />);
    expect(button(es.succession.addSuccessor)).toBeNull();
  });
});

describe('360 header', () => {
  it('does not repeat the empty state\'s "Nuevo ciclo"', () => {
    render(<Evaluation360Page />);
    expect(screen.getAllByRole('button', { name: es.evaluation360.createButton })).toHaveLength(1);
  });

  it('keeps "Nuevo ciclo" in the header while the list is still loading', () => {
    state.cycles = { isLoading: true, isError: false, isSuccess: false, error: null };
    render(<Evaluation360Page />);
    expect(screen.getAllByRole('button', { name: es.evaluation360.createButton })).toHaveLength(1);
  });
});
