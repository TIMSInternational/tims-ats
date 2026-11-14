import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Proctoring parity with timssuite.com (owner decision 2026-11-11): HR's assessment security settings (the identity
// check held back while no approved biometric text describes it), the HR outcome notes for an auto-submitted or a
// proctoring-voided sitting (company scope only, D6), and the candidate's biometric consent shown like any other.

const mocks = vi.hoisted(() => ({
  locale: 'es' as 'en' | 'es',
  saved: [] as unknown[],
  attempts: null as unknown,
  templates: null as unknown,
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: en } = await import('../../apps/web/lib/i18n/en.json');
  const { default: es } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t: mocks.locale === 'en' ? en : es, locale: mocks.locale === 'en' ? 'EN' : 'ES' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/platform-api/assessment-provider-settings', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/assessment-provider-settings')>()),
  useSaveProctoringSettings: () => ({
    isPending: false,
    mutate: (input: unknown) => mocks.saved.push(input),
  }),
}));
vi.mock('../../apps/web/lib/platform-api/fit-engine', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/fit-engine')>()),
  isFitEngineV2Enabled: () => true,
}));
vi.mock('../../apps/web/lib/platform-api/vacancy-assessments', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/vacancy-assessments')>()),
  useVacancyAssessments: () => ({ data: null, isLoading: false, isError: false }),
}));
vi.mock('../../apps/web/lib/platform-api/assessment-providers-staff', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/assessment-providers-staff')>()),
  isProviderAssessmentsStaffEnabled: () => true,
  useCandidateProviderAttempts: () => ({ data: mocks.attempts }),
}));
vi.mock('../../apps/web/lib/platform-api/assessment-provider-portal', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/assessment-provider-portal')>()),
  useProviderConsentTemplates: () => ({ data: mocks.templates, isLoading: false, isError: false }),
}));

import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import { AssessmentSecurityForm } from '../../apps/web/app/(admin)/settings/assessment-security/assessment-security-form';
import { ProviderResultsBoard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/provider-results/provider-results-board';
import { ProviderAttemptRow } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/provider-attempt-row';
import { ProviderAssessmentConsent } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-assessment-consent';

const off = { lockdown: false, antiCheat: null, identityCheck: false, identityCheckAvailable: false, updatedAt: null };

beforeEach(() => {
  mocks.locale = 'es';
  mocks.saved = [];
  mocks.attempts = null;
  mocks.templates = null;
});

describe('assessment security settings', () => {
  it('starts all off, keeps the identity check disabled with an explanation, and saves nothing until changed', () => {
    render(<AssessmentSecurityForm settings={off} />);

    expect(screen.getByRole('switch', { name: es.assessmentSecurity.lockdownLabel })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: es.assessmentSecurity.antiCheatLabel })).not.toBeChecked();
    const identity = screen.getByRole('switch', { name: es.assessmentSecurity.identityLabel });
    expect(identity).toBeDisabled();
    expect(screen.getByTestId('identity-unavailable')).toHaveTextContent(es.assessmentSecurity.identityUnavailable);
    expect(screen.getByText(es.assessmentSecurity.appliesNote)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: es.assessmentSecurity.save })).toBeDisabled();
  });

  it('turning alert control on offers the threshold and the three consequences, and saves the whole block', async () => {
    render(<AssessmentSecurityForm settings={off} />);

    fireEvent.click(screen.getByRole('switch', { name: es.assessmentSecurity.lockdownLabel }));
    fireEvent.click(screen.getByRole('switch', { name: es.assessmentSecurity.antiCheatLabel }));
    for (const c of ['warn', 'auto_submit', 'void'] as const) {
      expect(
        screen.getByRole('radio', { name: new RegExp(es.assessmentSecurity.consequence[c].label) }),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: es.assessmentSecurity.thresholdIncrease }));
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(es.assessmentSecurity.consequence.void.label) }));
    fireEvent.click(screen.getByRole('button', { name: es.assessmentSecurity.save }));

    await waitFor(() => expect(mocks.saved).toHaveLength(1));
    expect(mocks.saved[0]).toEqual({
      lockdown: true,
      antiCheat: { threshold: 4, consequence: 'void' },
      identityCheck: false,
    });
  });

  it('the stepper never leaves 1..20', () => {
    render(<AssessmentSecurityForm settings={{ ...off, antiCheat: { threshold: 20, consequence: 'warn' } }} />);

    expect(screen.getByRole('button', { name: es.assessmentSecurity.thresholdIncrease })).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toHaveValue(20);
  });

  it('offers the identity check once it is available', () => {
    mocks.locale = 'en';
    render(<AssessmentSecurityForm settings={{ ...off, identityCheckAvailable: true }} />);

    expect(screen.getByRole('switch', { name: en.assessmentSecurity.identityLabel })).toBeEnabled();
    expect(screen.queryByTestId('identity-unavailable')).not.toBeInTheDocument();
  });
});

const VACANCY = '11111111-1111-4111-8111-111111111111';
const flagged = {
  validity: 'needs_review',
  validityReasons: ['proctoring_flagged'],
  requiresHumanReview: true,
  reviewPending: true,
  minimum: null,
  globalPercentile: 48,
  cefr: null,
  level: null,
  instrumentVersion: '1.0',
  normVersion: null,
  completedAt: '2026-11-11T15:00:00.000Z',
};
const staffAttempt = (overrides: Record<string, unknown>) => ({
  attemptId: '00000001-0000-4000-8000-000000000000',
  vacancyId: VACANCY,
  instrument: 'lia',
  status: 'needs_review',
  instrumentVersion: '1.0',
  missingConsents: [],
  expiresAt: null,
  createdAt: '2026-11-11T14:00:00.000Z',
  completedAt: '2026-11-11T15:00:00.000Z',
  lastErrorCode: null,
  timeMultiplier: 1,
  aids: [],
  countsIn: 'gate',
  result: flagged,
  proctoringOutcome: null,
  ...overrides,
});

describe('HR outcome of a proctored sitting', () => {
  it('an auto-submitted result says a person must review it and never shows the level as a verdict', () => {
    mocks.attempts = { consentWithdrawn: false, attempts: [staffAttempt({ proctoringOutcome: 'auto_submitted' })] };
    render(<ProviderResultsBoard candidateId="c" />);

    const note = screen.getByTestId('provider-proctoring-note');
    expect(note).toHaveTextContent(es.providerAssessments.proctoring.autoSubmittedTitle);
    expect(note).toHaveTextContent(es.providerAssessments.proctoring.autoSubmitted);
    expect(note).toHaveTextContent(es.providerAssessments.proctoring.reasons.proctoring_flagged);
    expect(screen.queryByText('48')).not.toBeInTheDocument();
  });

  it('a proctoring-voided sitting says the attempt is used and a retake is a new assignment', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [staffAttempt({ result: null, completedAt: null, proctoringOutcome: 'voided' })],
    };
    render(<ProviderResultsBoard candidateId="c" />);

    expect(screen.getByTestId('provider-proctoring-note')).toHaveTextContent(es.providerAssessments.proctoring.voided);
  });

  it('a narrow reader (no outcome, no reasons: D6) sees only the generic review state', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [staffAttempt({ result: { ...flagged, validityReasons: null, globalPercentile: null } })],
    };
    render(<ProviderResultsBoard candidateId="c" />);

    expect(screen.queryByTestId('provider-proctoring-note')).not.toBeInTheDocument();
    expect(screen.getByText(es.providerAssessments.results.underReview)).toBeInTheDocument();
  });

  it('the attempt row carries the same note', () => {
    mocks.locale = 'en';
    render(
      <ul>
        <ProviderAttemptRow
          attempt={staffAttempt({ proctoringOutcome: 'auto_submitted' }) as never}
          dateFormat={new Intl.DateTimeFormat('en')}
          canCancel={false}
          cancelling={false}
          onCancel={() => undefined}
        />
      </ul>,
    );

    expect(screen.getByTestId('provider-proctoring-note')).toHaveTextContent(
      en.providerAssessments.proctoring.autoSubmittedTitle,
    );
  });
});

describe('candidate portal: the biometric consent', () => {
  const template = (purpose: string, title: string) => ({
    purpose,
    textVersion: `2026-11-09-${purpose}-v1`,
    locale: 'es',
    title,
    blocks: [{ type: 'paragraph', text: `Texto de ${purpose}` }],
    disclosures: [],
  });

  it('is shown in full like the others and must be accepted before starting', () => {
    mocks.templates = {
      templates: [
        template('assessment', 'Consentimiento de evaluación'),
        template('biometric', 'Consentimiento biométrico'),
      ],
      optionalPurposes: [],
    };
    const accepted: unknown[] = [];
    render(
      <ProviderAssessmentConsent
        attemptId="a"
        busy={false}
        notice={{ orgName: 'Org', vacancyTitle: 'Analista', instrumentName: 'LIA' }}
        onAccept={(decision) => accepted.push(decision)}
        onCancel={() => undefined}
      />,
    );

    const biometric = screen.getByRole('heading', { name: 'Consentimiento biométrico' }).closest('section')!;
    expect(within(biometric).getByText('Texto de biometric')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: es.portalDashboard.providerAcceptAndStart });

    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(start).toBeEnabled();
    fireEvent.click(start);

    expect(accepted).toHaveLength(1);
    expect((accepted[0] as { accepted: { purpose: string }[] }).accepted.map((a) => a.purpose)).toEqual([
      'assessment',
      'biometric',
    ]);
  });
});
