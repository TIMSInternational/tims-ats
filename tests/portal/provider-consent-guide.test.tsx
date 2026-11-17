import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// Round 3 (owner direction 2026-11-14): the candidate's consent is a step-by-step guide. One screen per step (the ATS
// notice, each required consent, the optional ones, then "Empezar"), each with its title, one neutral line, an UNCHECKED
// checkbox and "Leer el texto completo", which opens the complete approved text in a full-screen sheet. Legal
// guardrails pinned here: required steps gate, optional ones never block, nothing is pre-checked, the full text is the
// served text word for word, and the decision sent to the launch is exactly the one the old one-page form sent.

const mocks = vi.hoisted(() => ({ locale: 'en' as 'en' | 'es', templates: null as unknown }));

vi.mock('../../apps/web/lib/i18n', async (original) => {
  const { default: en } = await import('../../apps/web/lib/i18n/en.json');
  const { default: es } = await import('../../apps/web/lib/i18n/es.json');
  return {
    ...(await original<typeof import('../../apps/web/lib/i18n')>()),
    useI18n: () => ({ t: mocks.locale === 'en' ? en : es, locale: mocks.locale === 'en' ? 'EN' : 'ES' }),
  };
});
vi.mock('../../apps/web/lib/platform-api/assessment-provider-portal', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/assessment-provider-portal')>()),
  useProviderConsentTemplates: () => ({ data: mocks.templates, isLoading: false, isError: false }),
}));

import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';
import type { ConsentDecision } from '../../apps/web/lib/platform-api/assessment-provider-portal';
import { ProviderAssessmentConsent } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-assessment-consent';
import { ProviderAssessmentNoticeStep } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-assessment-notice-step';

const m = en.portalDashboard;
const n = en.assessmentConsentNotice;
const NOTICE = { orgName: 'Acme Corp', vacancyTitle: 'Data Analyst', instrumentName: 'English' };

interface Template {
  purpose: string;
  textVersion: string;
  locale: string;
  title: string;
  blocks: Array<Record<string, unknown>>;
  disclosures: string[];
}

const template = (purpose: string, title: string): Template => ({
  purpose,
  textVersion: `2026-11-09-${purpose}-v1`,
  locale: 'en',
  title,
  blocks: [
    { type: 'heading', text: `${title}: what it covers`, level: 2 },
    { type: 'paragraph', text: `The approved ${purpose} wording, <b>plain</b>.` },
    { type: 'list', text: null, ordered: true, items: [`${purpose} first point`, `${purpose} second point`] },
    { type: 'callout', text: `${purpose} closing note.`, tone: 'warning' },
  ],
  disclosures: ['purpose'],
});

// The provider's order, on purpose not the guide's: optional first, a required one last.
const VOICE = template('voice', 'Consent to recording your voice');
const ASSESSMENT = template('assessment', 'Consent to the assessments');
const AI = template('ai_scoring', 'Consent to scoring by artificial intelligence');
const BIOMETRIC = template('biometric', 'Biometric consent');
const ALL = { templates: [VOICE, ASSESSMENT, AI, BIOMETRIC], optionalPurposes: ['voice', 'ai_scoring'] };

/** The decision the one-page consent form built before the guide (provider-assessment-consent.tsx at ab2acce2). */
function legacyDecision(
  set: { templates: Template[]; optionalPurposes: string[] },
  accepted: Set<string>,
  locale: 'es' | 'en',
): ConsentDecision {
  const optional = new Set(set.optionalPurposes);
  const offered = set.templates.filter((t) => optional.has(t.purpose));
  return {
    accepted: set.templates
      .filter((t) => accepted.has(t.purpose))
      .map((t) => ({ purpose: t.purpose, textVersion: t.textVersion, locale: t.locale })),
    declined: offered.filter((t) => !accepted.has(t.purpose)).map((t) => t.purpose),
    notice: { textVersion: '2026-11-09-ats-notice-v1', locale },
  } as ConsentDecision;
}

function renderConsent() {
  const decisions: ConsentDecision[] = [];
  const onCancel = vi.fn();
  render(
    <ProviderAssessmentConsent
      attemptId="a"
      busy={false}
      notice={NOTICE}
      onAccept={(decision) => decisions.push(decision)}
      onCancel={onCancel}
    />,
  );
  return { decisions, onCancel };
}

const step = () => screen.getByTestId('consent-step');
const stepTitle = () => within(step()).getByRole('heading', { level: 3 }).textContent;
const box = () => within(step()).getByRole('checkbox');
const continueButton = () => screen.getByRole('button', { name: m.providerGuideContinue });
const finish = () => screen.getByRole('button', { name: m.providerAcceptAndStart });
const position = (text: string) =>
  screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text);

beforeEach(() => {
  mocks.locale = 'en';
  mocks.templates = ALL;
});

describe('candidate consent guide', () => {
  it('shows one step at a time, in order: the notice, the required consents, the optional ones, then Start', () => {
    renderConsent();

    const titles: string[] = [];
    const steps = 6;
    for (let index = 0; index < steps - 1; index += 1) {
      expect(screen.getAllByTestId('consent-step')).toHaveLength(1);
      titles.push(stepTitle() ?? '');
      fireEvent.click(box());
      fireEvent.click(continueButton());
    }
    expect(titles).toEqual([n.title, ASSESSMENT.title, BIOMETRIC.title, VOICE.title, AI.title]);
    // The last step lists every text by its title with what was chosen, before anything is recorded.
    const review = screen.getByTestId('consent-review');
    expect(review).toHaveTextContent(m.providerGuideReviewTitle);
    for (const title of titles) expect(review).toHaveTextContent(title);
    expect(position(`Step 6 of 6 · ${m.providerGuideStepStart}`)).toBeInTheDocument();
    expect(screen.queryByTestId('consent-step')).not.toBeInTheDocument();
  });

  it('says "Paso n de N" with the foundation Stepper, in Spanish by the portal language', () => {
    mocks.locale = 'es';
    renderConsent();

    expect(position(`Paso 1 de 6 · ${es.portalDashboard.providerGuideStepNotice}`)).toBeInTheDocument();
    const current = screen.getByRole('navigation', { name: es.common.steps }).querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent(es.portalDashboard.providerGuideStepNotice);
  });

  it('gates Continue on the required boxes only: an optional box never blocks', () => {
    renderConsent();

    // The notice and each required consent: Continue waits for the box, and says why.
    for (const title of [n.title, ASSESSMENT.title, BIOMETRIC.title]) {
      expect(stepTitle()).toBe(title);
      expect(continueButton()).toBeDisabled();
      expect(screen.getByText(m.providerGuideCheckToContinue)).toBeInTheDocument();
      fireEvent.click(box());
      expect(continueButton()).toBeEnabled();
      expect(screen.queryByText(m.providerGuideCheckToContinue)).not.toBeInTheDocument();
      fireEvent.click(continueButton());
    }
    // The optional ones say "Optional" and let the candidate go on unticked.
    for (const title of [VOICE.title, AI.title]) {
      expect(stepTitle()).toBe(title);
      expect(within(step()).getByText(m.providerGuideOptional)).toBeInTheDocument();
      expect(within(step()).getByText(m.providerGuideOptionalLine)).toBeInTheDocument();
      expect(box()).not.toBeChecked();
      expect(continueButton()).toBeEnabled();
      fireEvent.click(continueButton());
    }
    expect(finish()).toBeEnabled();
  });

  it('pre-checks nothing, and keeps each box as the candidate left it when going back', () => {
    renderConsent();

    fireEvent.click(box()); // the notice
    fireEvent.click(continueButton());
    expect(box()).not.toBeChecked(); // assessment: a fresh step starts unticked
    fireEvent.click(box());
    fireEvent.click(continueButton());
    expect(box()).not.toBeChecked(); // biometric
    fireEvent.click(box());
    fireEvent.click(continueButton());
    expect(box()).not.toBeChecked(); // voice (optional)
    fireEvent.click(continueButton());
    expect(box()).not.toBeChecked(); // ai_scoring (optional)

    fireEvent.click(screen.getByRole('button', { name: en.common.back }));
    expect(stepTitle()).toBe(VOICE.title);
    expect(box()).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: en.common.back }));
    expect(stepTitle()).toBe(BIOMETRIC.title);
    expect(box()).toBeChecked();
    // Unticking a required box on the way back blocks Continue again: the gating is never bypassed.
    fireEvent.click(box());
    expect(continueButton()).toBeDisabled();
  });

  it('keeps the step short: the approved wording is never on the step, only in "Read the full text"', () => {
    renderConsent();
    fireEvent.click(box());
    fireEvent.click(continueButton());

    const onStep = step().textContent ?? '';
    expect(onStep).toContain(ASSESSMENT.title);
    expect(onStep).toContain(m.providerGuideConsentLine);
    expect(onStep).toContain(m.providerConsentAccept);
    expect(onStep).not.toContain('approved assessment wording');
    expect(onStep).not.toContain('assessment first point');
  });

  it('opens each complete approved text verbatim in the full-text sheet, and closes it back to the step', () => {
    renderConsent();

    // The notice: every section of the versioned ATS notice, filled in, with its version.
    fireEvent.click(within(step()).getByRole('button', { name: m.providerGuideReadFull }));
    let sheet = screen.getByRole('dialog', { name: n.title });
    const fill = (text: string) => text.replaceAll('{org}', 'Acme Corp').replaceAll('{vacancy}', 'Data Analyst');
    const noticeText = within(sheet).getByTestId('assessment-consent-notice');
    for (const part of [n.intro, n.purpose, n.decision, n.withdraw, n.providerConsents].map(fill))
      expect(noticeText).toHaveTextContent(part);
    for (const heading of [n.testsTitle, n.purposeTitle, n.decisionTitle, n.withdrawTitle])
      expect(within(noticeText).getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(noticeText).toHaveTextContent('English');
    expect(noticeText).toHaveTextContent(n.versionLabel.replace('{version}', '2026-11-09-ats-notice-v1'));
    // The PCA bottom sheet (on phones up to 85% of the screen, scrolling), closable, and reading only: no checkbox in it.
    expect(sheet).toHaveClass('max-h-[85dvh]');
    expect(within(sheet).queryByRole('checkbox')).not.toBeInTheDocument();
    const closeButtons = within(sheet).getAllByRole('button', { name: en.common.close });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(box()).not.toBeChecked(); // reading accepts nothing

    // Each provider text: every block, in order, as plain text (markup shown, never parsed).
    fireEvent.click(box());
    fireEvent.click(continueButton());
    for (const served of [ASSESSMENT, BIOMETRIC, VOICE, AI]) {
      expect(stepTitle()).toBe(served.title);
      fireEvent.click(within(step()).getByRole('button', { name: m.providerGuideReadFull }));
      sheet = screen.getByRole('dialog', { name: served.title });
      const text = within(sheet).getByTestId('consent-full-text');
      const expected = served.blocks.flatMap((block) =>
        block.type === 'list' ? (block.items as string[]) : [block.text as string],
      );
      expect(Array.from(text.querySelectorAll('h3, p, li')).map((node) => node.textContent)).toEqual(expected);
      expect(text.querySelector('b')).toBeNull();
      expect(text.closest('[lang]')).toHaveAttribute('lang', 'en');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      if (served !== VOICE && served !== AI) fireEvent.click(box());
      fireEvent.click(continueButton());
    }
  });

  it.each([
    ['no optional consent', []],
    ['the voice consent only', ['voice']],
    ['AI scoring only', ['ai_scoring']],
    ['both optional consents', ['voice', 'ai_scoring']],
  ])('sends the same decision as the one-page form did, for %s', (_label, optionalChoices) => {
    const { decisions } = renderConsent();

    fireEvent.click(box()); // notice
    fireEvent.click(continueButton());
    fireEvent.click(box()); // assessment
    fireEvent.click(continueButton());
    fireEvent.click(box()); // biometric
    fireEvent.click(continueButton());
    for (const purpose of ['voice', 'ai_scoring']) {
      if (optionalChoices.includes(purpose)) fireEvent.click(box());
      fireEvent.click(continueButton());
    }
    fireEvent.click(finish());

    expect(decisions).toEqual([legacyDecision(ALL, new Set(['assessment', 'biometric', ...optionalChoices]), 'en')]);
  });

  it('records an optional consent ticked then unticked on the way back as declined, like the old form', () => {
    const { decisions } = renderConsent();
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(box());
      fireEvent.click(continueButton());
    }
    fireEvent.click(box()); // voice yes …
    fireEvent.click(continueButton());
    fireEvent.click(screen.getByRole('button', { name: en.common.back }));
    fireEvent.click(box()); // … then no
    fireEvent.click(continueButton());
    fireEvent.click(continueButton()); // ai_scoring left unticked
    fireEvent.click(finish());

    expect(decisions).toEqual([legacyDecision(ALL, new Set(['assessment', 'biometric']), 'en')]);
  });

  it('acknowledges the notice in the language it was shown in', () => {
    mocks.locale = 'es';
    mocks.templates = { templates: [{ ...ASSESSMENT, locale: 'es' }], optionalPurposes: [] };
    const { decisions } = renderConsent();
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('button', { name: es.portalDashboard.providerGuideContinue }));
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('button', { name: es.portalDashboard.providerGuideContinue }));
    fireEvent.click(screen.getByRole('button', { name: es.portalDashboard.providerAcceptAndStart }));

    expect(decisions).toEqual([
      legacyDecision(
        { templates: [{ ...ASSESSMENT, locale: 'es' }], optionalPurposes: [] },
        new Set(['assessment']),
        'es',
      ),
    ]);
  });

  it('cancels from the first step only; later steps go back instead (never Cancel and Back together)', () => {
    const { onCancel } = renderConsent();
    expect(screen.queryByRole('button', { name: en.common.back })).not.toBeInTheDocument();
    fireEvent.click(box());
    fireEvent.click(continueButton());
    expect(screen.queryByRole('button', { name: m.providerCancel })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.common.back }));
    fireEvent.click(screen.getByRole('button', { name: m.providerCancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('candidate notice step (a sitting that needs no new consent)', () => {
  it('is one step: no step indicator, Start waits for "I have read this notice.", unchecked, and sends the acknowledgment', () => {
    const started: unknown[] = [];
    render(
      <ProviderAssessmentNoticeStep
        notice={NOTICE}
        busy={false}
        onStart={(acknowledged) => started.push(acknowledged)}
        onCancel={() => undefined}
      />,
    );

    expect(screen.queryByRole('navigation', { name: en.common.steps })).not.toBeInTheDocument();
    expect(stepTitle()).toBe(n.title);
    const start = screen.getByRole('button', { name: m.providerStart });
    expect(box()).not.toBeChecked();
    expect(start).toBeDisabled();
    fireEvent.click(within(step()).getByRole('button', { name: m.providerGuideReadFull }));
    expect(
      within(screen.getByRole('dialog', { name: n.title })).getByTestId('assessment-consent-notice'),
    ).toHaveTextContent('Data Analyst');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByLabelText(n.readAck));
    fireEvent.click(start);

    expect(started).toEqual([{ textVersion: '2026-11-09-ats-notice-v1', locale: 'en' }]);
  });
});
