import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// Codex P2 on #398: under the pilot launch scope (NEXT_PUBLIC_LAUNCH_SCOPE=pilot) the role dashboards
// that survive must not render OR QUERY any out-of-scope module (performance, engagement, learning,
// compensation, 9-box). Every tRPC useQuery and every C# platform-api hook is recorded here; a query
// counts as "run" unless it was explicitly passed `enabled: false`.

const { calls, hook, stub } = vi.hoisted(() => {
  const calls: string[] = [];
  const hook = (name: string) => () => {
    calls.push(`platform.${name}`);
    return { isLoading: false, isError: false, data: undefined, refetch: () => undefined };
  };
  const stub = (name: string) => ({ [name]: () => <div data-testid={name} /> });
  return { calls, hook, stub };
});

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));

vi.mock('../../apps/web/lib/trpc', () => {
  const result = { isLoading: false, isError: false, data: undefined, refetch: () => undefined };
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'useQuery')
          return (_input?: unknown, opts?: { enabled?: boolean }) => {
            if (opts?.enabled !== false) calls.push(`trpc.${path.join('.')}`);
            return result;
          };
        if (prop === 'useMutation') return () => ({ mutate: () => undefined, isPending: false });
        return node([...path, prop]);
      },
    });
  return { trpc: node([]) };
});

vi.mock('../../apps/web/lib/platform-api/engagement', () => ({
  useEngagementListActionPlans: hook('engagement.listActionPlans'),
  useEngagementListLeaderCommitments: hook('engagement.listLeaderCommitments'),
  useEngagementMyPendingSurveys: hook('engagement.myPendingSurveys'),
  useEngagementSurveyForResponse: hook('engagement.surveyForResponse'),
  useEngagementSubmitSurveyResponse: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('../../apps/web/lib/platform-api/compensation', () => ({
  useCompensationMyCompensation: hook('compensation.myCompensation'),
}));
vi.mock('../../apps/web/lib/platform-api/ninebox', () => ({
  useNineBoxMyCalibrations: hook('ninebox.myCalibrations'),
}));

// Dashboards these roles must never reach are stubbed so a wrong landing is visible, not crashing.
vi.mock('../../apps/web/app/(admin)/dashboard/org-command-center', () => stub('OrgCommandCenter'));
vi.mock('../../apps/web/app/(admin)/dashboard/hr-exec-dashboard', () => stub('HrExecDashboard'));
vi.mock('../../apps/web/app/(admin)/dashboard/unit-health-dashboard', () => stub('UnitHealthDashboard'));
vi.mock('../../apps/web/app/(admin)/dashboard/setup-checklist', () => stub('SetupChecklist'));
vi.mock('../../apps/web/app/(admin)/dashboard/recruiting-kpi-strip', () => stub('RecruitingKpiStrip'));
vi.mock('../../apps/web/app/(admin)/dashboard/pipeline-funnel', () => ({
  ...stub('PipelineFunnel'),
  ...stub('PipelineFunnelSkeleton'),
}));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-sla-panel', () => stub('AlertsSlaPanel'));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-pending-panel', () => stub('AlertsPendingPanel'));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-risk-panel', () => stub('AlertsRiskPanel'));

import { RecruitmentDashboard } from '../../apps/web/app/(admin)/dashboard/recruitment-dashboard';

const OUT_OF_SCOPE =
  /^(trpc\.(performance|learning|engagement|compensation|ninebox|talent|assessment)\.|platform\.(engagement|compensation|ninebox)\.)/;

function renderFor(role: string): string[] {
  calls.length = 0;
  render(<RecruitmentDashboard roleSlugs={[role]} />);
  return [...calls];
}

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('pilot scope: role dashboards run no out-of-scope query', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot'));

  it('hrbp lands on the recruiter dashboard, not Unit Health', () => {
    const ran = renderFor('hrbp');
    expect(screen.queryByTestId('UnitHealthDashboard')).toBeNull();
    expect(screen.getByTestId('RecruitingKpiStrip')).toBeTruthy();
    expect(ran.filter((c) => OUT_OF_SCOPE.test(c))).toEqual([]);
  });

  it('leader keeps hiring (vacancies, offer approvals, scorecards) and drops My Team', () => {
    const ran = renderFor('leader');
    expect(ran.filter((c) => OUT_OF_SCOPE.test(c))).toEqual([]);
    expect(ran).toEqual(
      expect.arrayContaining([
        'trpc.vacancy.getDashboardKpis',
        'trpc.offer.getPending',
        'trpc.interview.getPendingScorecards',
      ]),
    );
    expect(screen.getByText(en.managerDashboard.myHiring)).toBeTruthy();
    expect(screen.queryByText(en.managerDashboard.myTeam)).toBeNull();
  });

  it('employee keeps only My Onboarding', () => {
    const ran = renderFor('employee');
    expect(ran).toEqual(['trpc.onboarding.list']);
    expect(screen.getByText(en.employeeHome.onboarding)).toBeTruthy();
    expect(screen.queryByText(en.employeeHome.performance)).toBeNull();
    expect(screen.queryByText(en.employeeHome.learning)).toBeNull();
  });

  it('committee keeps its panels and drops 9-box calibrations', () => {
    const ran = renderFor('committee');
    // Pending scorecards plus, listed apart, the member's upcoming panels (B-29) — both in the pilot.
    expect(ran).toEqual(['trpc.interview.getPendingScorecards', 'trpc.interview.list']);
    expect(screen.queryByText(en.committeeTasks.calibrationsTitle)).toBeNull();
  });
});

describe('full scope: behaviour unchanged', () => {
  it('hrbp still lands on Unit Health', () => {
    renderFor('hrbp');
    expect(screen.getByTestId('UnitHealthDashboard')).toBeTruthy();
  });

  it('leader still loads My Team (performance + engagement)', () => {
    const ran = renderFor('leader');
    expect(ran).toEqual(
      expect.arrayContaining([
        'trpc.performance.listOkrs',
        'platform.engagement.listActionPlans',
        'platform.engagement.listLeaderCommitments',
      ]),
    );
    expect(screen.getByText(en.managerDashboard.myTeam)).toBeTruthy();
  });

  it('employee still loads performance, learning, surveys, compensation and recognition', () => {
    const ran = renderFor('employee');
    expect(ran).toEqual(
      expect.arrayContaining([
        'trpc.performance.listOkrs',
        'trpc.performance.listCoachingSessions',
        'trpc.performance.listFeedback',
        'trpc.learning.getPrePostTestResults',
        'trpc.onboarding.list',
        'platform.engagement.myPendingSurveys',
        'platform.compensation.myCompensation',
        'trpc.performance.myRecognitions',
        'trpc.performance.myCommitments',
        'trpc.consent.myConsents',
      ]),
    );
  });

  it('committee still loads its calibrations', () => {
    const ran = renderFor('committee');
    expect(ran).toContain('platform.ninebox.myCalibrations');
  });
});
