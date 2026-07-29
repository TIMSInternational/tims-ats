import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Static-source tripwires for the survey take/submit modal (feat/survey-take).
// Employees could SEE pending surveys ("Mis Encuestas") but not answer them. A
// "Responder" button now opens a take modal that fetches the renderable survey
// (getSurveyForResponse), renders one input per question by type, and submits
// answers keyed by question TEXT via submitSurveyResponse. Mirrors the
// static-assertion style of give-recognition-feedback-ui.test.ts (no RTL harness).

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const DASH_DIR = 'apps/web/app/(admin)/dashboard';
const TAKE_MODAL = `${DASH_DIR}/survey-take-modal.tsx`;
const QUESTION_FIELD = `${DASH_DIR}/survey-question-field.tsx`;
const QUESTION_PARSE = `${DASH_DIR}/survey-question.ts`;
const SURVEYS_PANEL = `${DASH_DIR}/employee-surveys.tsx`;
const ES = 'apps/web/lib/i18n/es.json';
const EN = 'apps/web/lib/i18n/en.json';

describe('survey-take-modal — query + mutation wiring', () => {
  const src = () => read(TAKE_MODAL);

  it('is a client component', () => {
    expect(src()).toMatch(/^'use client';/);
  });

  it('fetches the renderable survey via the useEngagementSurveyForResponse cutover wrapper', () => {
    // Cut over to the dark platform-api wrapper (apps/web/lib/platform-api/engagement.ts,
    // PR #197) — it still calls trpc.engagement.getSurveyForResponse.useQuery internally on the
    // default (non-C#) path, so this assertion follows the refactor rather than the raw call.
    expect(src()).toContain('useEngagementSurveyForResponse');
  });

  it('submits via the useEngagementSubmitSurveyResponse cutover wrapper', () => {
    // Cut over to the platform-api wrapper (apps/web/lib/platform-api/engagement.ts, Phase-5
    // Slice-16 write wrapper). As of 2026-07-29 that wrapper is C#-ONLY for this mutation —
    // trpc.engagement.submitSurveyResponse was deleted — so this assertion targets the wrapper hook
    // name rather than a raw trpc call. Contrast the getSurveyForResponse assertion above: the READ
    // wrapper is STILL dual-path, because NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP is still dark.
    expect(src()).toContain('useEngagementSubmitSurveyResponse');
  });

  it('invalidates myPendingSurveys on success', () => {
    expect(src()).toContain('myPendingSurveys.invalidate');
  });

  it('has an onError toast on the mutation', () => {
    expect(src()).toMatch(/onError[\s\S]{0,120}toast/);
  });

  it('builds the answers map keyed by question TEXT (not index/id)', () => {
    const s = src();
    // answers object keyed by q.text — the aggregator reads r.answers[q.text]
    expect(s).toMatch(/\[\s*[a-zA-Z]+\.text\s*\]/);
  });

  it('passes the questions JSON through the typed parse guard (no any-cast)', () => {
    const s = src();
    expect(s).toContain('parseSurveyQuestions');
    expect(s).not.toMatch(/:\s*any\b/);
    expect(s).not.toMatch(/as any\b/);
  });

  it('enforces required questions before submit (disabled gate + isPending)', () => {
    const s = src();
    expect(s).toMatch(/required/);
    expect(s).toContain('isPending');
    expect(s).toMatch(/disabled=\{/);
  });

  it('renders the shared Modal', () => {
    expect(src()).toContain('Modal');
  });

  it('handles loading / error / empty states', () => {
    const s = src();
    expect(s).toMatch(/isLoading/);
    expect(s).toMatch(/isError/);
  });

  it('uses i18n only (no hardcoded user-facing strings)', () => {
    const s = src();
    expect(s).toContain('useI18n');
    expect(s).toMatch(/t\.employeeHome/);
  });

  it('uses no inline styles', () => {
    expect(src()).not.toContain('style={{');
  });
});

describe('survey-question-field — per-type rendering', () => {
  const src = () => read(QUESTION_FIELD);

  it('renders all four normalized question kinds', () => {
    const s = src();
    // The field component switches on the NORMALIZED discriminant `kind`
    // (scale/text/choice/yes_no), not the raw stored `type` vocabulary.
    expect(s).toMatch(/kind === 'scale'/);
    expect(s).toMatch(/kind === 'text'/);
    expect(s).toMatch(/kind === 'choice'/);
    expect(s).toMatch(/kind === 'yes_no'/);
  });

  it('renders a numeric scale selector over the ACTUAL min..max range (not hardcoded 1-5)', () => {
    const s = src();
    // Range comes from the question's stored min/max (covers scale 1..5 and nps 0..10).
    expect(s).toMatch(/scaleValues\(question\.min,\s*question\.max\)/);
  });

  it('renders a textarea for text questions (bounded <=5000)', () => {
    const s = src();
    expect(s).toContain('textarea');
    expect(s).toMatch(/5000/);
  });

  it('renders options for choice questions from question.options', () => {
    expect(src()).toMatch(/question\.options/);
  });

  it('renders yes/no radios via i18n (surveyYes/surveyNo)', () => {
    const s = src();
    expect(s).toMatch(/surveyYes/);
    expect(s).toMatch(/surveyNo/);
  });

  it('uses no any / inline styles', () => {
    const s = src();
    expect(s).not.toMatch(/:\s*any\b/);
    expect(s).not.toContain('style={{');
  });
});

describe('survey-question — typed Zod parse guard over the JsonValue questions', () => {
  const src = () => read(QUESTION_PARSE);

  it('declares a zod schema and a safeParse-based guard (no any-cast)', () => {
    const s = src();
    expect(s).toMatch(/z\.(array|object)/);
    expect(s).toContain('safeParse');
    expect(s).toContain('parseSurveyQuestions');
    expect(s).not.toMatch(/:\s*any\b/);
    expect(s).not.toMatch(/as any\b/);
  });

  it('is per-question tolerant (parses elements independently, not all-or-nothing)', () => {
    const s = src();
    // The fix: iterate elements and safeParse each, instead of one array safeParse.
    expect(s).toMatch(/for\s*\(const/);
    expect(s).toMatch(/Array\.isArray/);
  });

  it('accepts BOTH stored vocabularies (legacy seed + authoring)', () => {
    const s = src();
    // Legacy/seed shape
    expect(s).toMatch(/'open_text'/);
    expect(s).toMatch(/'nps'/);
    // Authoring shape
    expect(s).toMatch(/'scale'/);
    expect(s).toMatch(/'text'/);
    expect(s).toMatch(/'multiple_choice'/);
    expect(s).toMatch(/'yes_no'/);
  });
});

describe('employee-surveys — Responder button opens the take modal', () => {
  const src = () => read(SURVEYS_PANEL);

  it('imports and renders the SurveyTakeModal', () => {
    expect(src()).toContain('SurveyTakeModal');
  });

  it('wires the existing respondSurvey i18n key onto a button', () => {
    expect(src()).toContain('respondSurvey');
  });

  it('drives the modal with local open-state (useState)', () => {
    expect(src()).toContain('useState');
  });
});

describe('survey-take i18n keys (both locales)', () => {
  const NEW_KEYS = [
    'surveyTakeTitle',
    'surveyYes',
    'surveyNo',
    'surveyRequiredError',
    'surveySubmit',
    'surveySubmitSuccess',
    'surveyAlreadyAnswered',
    'surveyScaleLow',
    'surveyScaleHigh',
    'surveyNotFound',
    'surveyNoQuestions',
  ];

  it('es.json employeeHome.* has all new keys', () => {
    const es = JSON.parse(read(ES));
    for (const k of NEW_KEYS) {
      expect(es.employeeHome?.[k], `es employeeHome.${k}`).toBeTruthy();
    }
  });

  it('en.json employeeHome.* has all new keys', () => {
    const en = JSON.parse(read(EN));
    for (const k of NEW_KEYS) {
      expect(en.employeeHome?.[k], `en employeeHome.${k}`).toBeTruthy();
    }
  });
});
