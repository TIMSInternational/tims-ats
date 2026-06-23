import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Static-source tripwires for the interview-room AI wire-up. Three LIVE
// interview-AI mutations (generateGuide / generateSummary / detectBias) that
// had ZERO UI consumers are now surfaced as button-triggered actions in the
// interview room, replacing the placeholder "AI Coach" tab + the hardcoded
// "Deteccion de Sesgo" mock alert. Mirrors the static-assertion style of
// give-recognition-feedback-ui.test.ts (the repo has no RTL component harness).

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const ROOM_DIR = 'apps/web/app/(admin)/recruitment/interviews/[id]/room';
const AI_PANEL = `${ROOM_DIR}/interview-ai-panel.tsx`;
const SCORECARD = `${ROOM_DIR}/scorecard-panel.tsx`;
const ROOM_PAGE = `${ROOM_DIR}/page.tsx`;
const ES = 'apps/web/lib/i18n/es.json';
const EN = 'apps/web/lib/i18n/en.json';

describe('interview-ai-panel — mutation wiring', () => {
  const src = () => read(AI_PANEL);

  it('is a client component', () => {
    expect(src()).toMatch(/^'use client';/);
  });

  it('calls all three AI endpoints as MUTATIONS (budget-spending, never auto-query)', () => {
    const s = src();
    expect(s).toContain('interview.generateGuide.useMutation');
    expect(s).toContain('interview.generateSummary.useMutation');
    expect(s).toContain('interview.detectBias.useMutation');
  });

  it('does NOT auto-fetch any AI endpoint via useQuery (would spend budget on mount)', () => {
    const s = src();
    expect(s).not.toContain('generateGuide.useQuery');
    expect(s).not.toContain('generateSummary.useQuery');
    expect(s).not.toContain('detectBias.useQuery');
  });

  it('passes the interviewId into every mutation', () => {
    const s = src();
    // each mutate call carries the interviewId
    expect(s).toMatch(/\.mutate\(\{\s*interviewId\s*\}\)/);
    // and the component takes interviewId as a prop
    expect(s).toMatch(/interviewId\s*:\s*string/);
  });

  it('has an onError handler on every mutation, all routed through toast', () => {
    const s = src();
    // one onError per mutation (3 total), and errors surface via toast()
    const onErrorCount = (s.match(/onError\s*:/g) ?? []).length;
    expect(onErrorCount).toBeGreaterThanOrEqual(3);
    expect(s).toContain('toast(');
    // the shared error handler must feed toast()
    expect(s).toMatch(/onError[\s\S]{0,200}toast\(/);
  });

  it('renders guide result fields (sections: title, duration, questions)', () => {
    const s = src();
    expect(s).toMatch(/\.sections/);
    expect(s).toMatch(/\.title/);
    expect(s).toMatch(/\.duration/);
    expect(s).toMatch(/\.questions/);
  });

  it('renders summary result fields (summary, keyPoints, strengths, concerns)', () => {
    const s = src();
    expect(s).toMatch(/\.summary/);
    expect(s).toMatch(/\.keyPoints/);
    expect(s).toMatch(/\.strengths/);
    expect(s).toMatch(/\.concerns/);
  });

  it('renders bias result fields (overallRisk, biasIndicators, recommendations)', () => {
    const s = src();
    expect(s).toMatch(/\.overallRisk/);
    expect(s).toMatch(/\.biasIndicators/);
    expect(s).toMatch(/severity/);
    expect(s).toMatch(/\.recommendations/);
  });

  it('gates each button while its mutation is pending (disabled + isPending)', () => {
    const s = src();
    expect(s).toContain('isPending');
    expect(s).toMatch(/disabled=\{/);
  });

  it('uses i18n only (no hardcoded user-facing AI strings)', () => {
    const s = src();
    expect(s).toContain('useI18n');
    expect(s).toContain('t.interviews');
  });

  it('does not use the banned no-any / inline-style patterns', () => {
    const s = src();
    expect(s).not.toMatch(/:\s*any\b/);
    expect(s).not.toContain('style={{');
  });

  it('types the mutation outputs via inferRouterOutputs / trpc-types (no any-cast)', () => {
    const s = src();
    expect(s).toMatch(/inferRouterOutputs|trpc-types/);
  });
});

describe('scorecard-panel — placeholder/mock AI UI removed', () => {
  const src = () => read(SCORECARD);

  it('no longer renders the hardcoded "Deteccion de Sesgo" mock alert', () => {
    const s = src();
    expect(s).not.toContain('Deteccion de Sesgo');
    expect(s).not.toContain('Asegurar evaluacion objetiva basada en evidencia');
  });

  it('no longer ships the placeholder "AI Coach" empty-state text', () => {
    const s = src();
    expect(s).not.toContain('proporcionara sugerencias en tiempo real');
  });

  it('no longer carries hardcoded per-competency aiQuestion fake-AI strings', () => {
    const s = src();
    expect(s).not.toContain('aiQuestion');
    expect(s).not.toContain('IA sugiere preguntar');
  });

  it('renders the real AI panel in the AI tab', () => {
    expect(src()).toContain('InterviewAiPanel');
  });
});

describe('room page — wires interviewId into the scorecard/AI panel', () => {
  const src = () => read(ROOM_PAGE);

  it('passes interviewId to the ScorecardPanel', () => {
    expect(src()).toMatch(/interviewId=\{/);
  });
});

describe('interview-ai i18n keys (both locales)', () => {
  const NEW_KEYS = [
    'aiTab',
    'generateGuide',
    'generateSummary',
    'detectBias',
    'guideHeading',
    'summaryHeading',
    'keyPointsHeading',
    'strengthsHeading',
    'concernsHeading',
    'biasHeading',
    'biasIndicatorsHeading',
    'recommendationsHeading',
    'overallRiskLabel',
    'riskNone',
    'riskLow',
    'riskMedium',
    'riskHigh',
    'riskUnknown',
    'severityNone',
    'severityLow',
    'severityMedium',
    'severityHigh',
    'noScorecardsError',
    'aiEmptyState',
    'generating',
  ];

  it('es.json interviews.* has all new keys', () => {
    const es = JSON.parse(read(ES));
    for (const k of NEW_KEYS) {
      expect(es.interviews?.[k], `es interviews.${k}`).toBeTruthy();
    }
  });

  it('en.json interviews.* has all new keys', () => {
    const en = JSON.parse(read(EN));
    for (const k of NEW_KEYS) {
      expect(en.interviews?.[k], `en interviews.${k}`).toBeTruthy();
    }
  });
});
