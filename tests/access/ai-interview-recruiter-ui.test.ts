import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Static-source tripwires for the AI voice interview RECRUITER UI (Task 8).
// Two surfaces:
//   1. Entry point — a "Start AI screen" action on the interviews list that
//      calls aiInterview.create and surfaces the candidate magic-link.
//   2. Result view — ai-screen-result.tsx reads aiInterview.getResult and renders
//      status / fitScore / summary / strengths / concerns / bias / transcript.
// No hardcoded user-facing strings; no API key client-side; analysisStatus
// 'pending' and 'failed' branches handled (no re-run endpoint exists).

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const exists = (p: string) => existsSync(resolve(root, p));

const INTERVIEWS_DIR = 'apps/web/app/(admin)/recruitment/interviews';
const TABLE = `${INTERVIEWS_DIR}/interview-table.tsx`;
const PAGE = `${INTERVIEWS_DIR}/page.tsx`;
const MODAL = `${INTERVIEWS_DIR}/ai-screen-modal.tsx`;
const RESULT = `${INTERVIEWS_DIR}/[id]/ai-screen-result.tsx`;
const ES = 'apps/web/lib/i18n/es.json';
const EN = 'apps/web/lib/i18n/en.json';

// i18n keys this recruiter UI must add to the `interviews` namespace.
const RECRUITER_I18N_KEYS = [
  'startAiScreen',
  'aiScreenTitle',
  'candidateLinkLabel',
  'copyLink',
  'linkCopied',
  'fitScoreLabel',
  'aiScreenStatusLabel',
  'analysisInProgress',
  'analysisFailed',
  'contactSupport',
  'transcriptHeading',
  'showTranscript',
  'hideTranscript',
  'noTranscript',
  'aiResultLoadError',
  'aiResultEmpty',
  'aiScreenCreated',
  'aiSummaryHeading',
  'aiStrengthsHeading',
  'aiConcernsHeading',
  'aiBiasHeading',
  'aiOverallRiskLabel',
  'aiNoBiasIndicators',
  'viewAiResult',
];

describe('interview-table.tsx — Start AI screen entry point', () => {
  it('file exists', () => {
    expect(exists(TABLE)).toBe(true);
  });

  it('exposes an onStartAiScreen callback prop', () => {
    expect(read(TABLE)).toContain('onStartAiScreen');
  });

  it('renders the startAiScreen label from i18n', () => {
    expect(read(TABLE)).toContain('t.interviews.startAiScreen');
  });

  it('uses no inline styles', () => {
    expect(read(TABLE)).not.toContain('style={{');
  });

  it('has no any type', () => {
    const src = read(TABLE);
    expect(src).not.toMatch(/:\s*any\b/);
    expect(src).not.toMatch(/as any\b/);
  });
});

describe('page.tsx — wires the AI screen modal', () => {
  it('imports the Ai screen modal', () => {
    expect(read(PAGE)).toContain('AiScreenModal');
  });

  it('passes onStartAiScreen to the table', () => {
    expect(read(PAGE)).toContain('onStartAiScreen');
  });
});

describe('ai-screen-modal.tsx — create + candidate link', () => {
  it('file exists', () => {
    expect(exists(MODAL)).toBe(true);
  });

  it('is a client component', () => {
    expect(read(MODAL)).toMatch(/^'use client';/);
  });

  it('calls aiInterview.create mutation', () => {
    expect(read(MODAL)).toContain('aiInterview.create');
  });

  it('passes interviewId to the create mutation', () => {
    expect(read(MODAL)).toContain('interviewId');
  });

  it('surfaces the candidateLink in a copyable field', () => {
    const src = read(MODAL);
    expect(src).toContain('candidateLink');
    // a copy affordance must be present
    expect(src).toContain('t.interviews.copyLink');
  });

  it('shows a success toast and an error toast (onError on the mutation)', () => {
    const src = read(MODAL);
    expect(src).toContain('toast');
    expect(src).toContain('onError');
  });

  it('renders the result view after creation (sessionId handoff)', () => {
    const src = read(MODAL);
    expect(src).toContain('sessionId');
    expect(src).toContain('AiScreenResult');
  });

  it('uses i18n only (no hardcoded user-facing strings)', () => {
    expect(read(MODAL)).toContain('useI18n');
  });

  it('uses no inline styles', () => {
    expect(read(MODAL)).not.toContain('style={{');
  });

  it('has no any type', () => {
    const src = read(MODAL);
    expect(src).not.toMatch(/:\s*any\b/);
    expect(src).not.toMatch(/as any\b/);
  });

  it('ELEVENLABS_API_KEY never appears client-side', () => {
    expect(read(MODAL)).not.toContain('ELEVENLABS_API_KEY');
  });
});

describe('ai-screen-result.tsx — result panel', () => {
  it('file exists', () => {
    expect(exists(RESULT)).toBe(true);
  });

  it('is a client component', () => {
    expect(read(RESULT)).toMatch(/^'use client';/);
  });

  it('calls aiInterview.getResult query', () => {
    expect(read(RESULT)).toContain('aiInterview.getResult');
  });

  it('passes sessionId to getResult', () => {
    expect(read(RESULT)).toContain('sessionId');
  });

  it('reads fitScore from the result', () => {
    expect(read(RESULT)).toContain('fitScore');
  });

  it('reads summary fields (summary / strengths / concerns) from the result', () => {
    const src = read(RESULT);
    expect(src).toContain('summary');
    expect(src).toContain('strengths');
    expect(src).toContain('concerns');
  });

  it('reads bias report fields (biasIndicators / overallRisk) from the result', () => {
    const src = read(RESULT);
    expect(src).toContain('biasIndicators');
    expect(src).toContain('overallRisk');
  });

  it('renders the transcript', () => {
    expect(read(RESULT)).toContain('transcript');
  });

  it('handles analysisStatus pending — analysis in progress', () => {
    const src = read(RESULT);
    expect(src).toContain('analysisStatus');
    expect(src).toContain("'pending'");
    expect(src).toContain('analysisInProgress');
  });

  it("handles analysisStatus === 'failed' with a contact-support message (no re-run endpoint)", () => {
    const src = read(RESULT);
    expect(src).toContain("'failed'");
    expect(src).toContain('analysisFailed');
    // there is NO re-run analysis procedure — must NOT invent one
    expect(src).not.toContain('rerunAnalysis');
    expect(src).not.toContain('reRunAnalysis');
  });

  it('handles loading / error / empty states', () => {
    const src = read(RESULT);
    expect(src).toMatch(/isLoading|isPending/);
    expect(src).toMatch(/isError|error/);
  });

  it('uses inferred result type from trpc-types (no any cast)', () => {
    const src = read(RESULT);
    expect(src).not.toMatch(/:\s*any\b/);
    expect(src).not.toMatch(/as any\b/);
  });

  it('uses i18n only (no hardcoded user-facing strings)', () => {
    expect(read(RESULT)).toContain('useI18n');
  });

  it('uses no inline styles', () => {
    expect(read(RESULT)).not.toContain('style={{');
  });
});

describe('trpc-types.ts — AI interview result types exported', () => {
  it('exports AiInterviewResult', () => {
    expect(read('apps/web/lib/trpc-types.ts')).toContain('AiInterviewResult');
  });
});

describe('recruiter AI screen i18n keys (both locales)', () => {
  it('es.json interviews.* has all required recruiter keys', () => {
    const es = JSON.parse(read(ES));
    for (const k of RECRUITER_I18N_KEYS) {
      expect(es.interviews?.[k], `es interviews.${k}`).toBeTruthy();
    }
  });

  it('en.json interviews.* has all required recruiter keys', () => {
    const en = JSON.parse(read(EN));
    for (const k of RECRUITER_I18N_KEYS) {
      expect(en.interviews?.[k], `en interviews.${k}`).toBeTruthy();
    }
  });

  it('both locales have identical key sets under interviews', () => {
    const es = JSON.parse(read(ES));
    const en = JSON.parse(read(EN));
    const esKeys = Object.keys(es.interviews ?? {}).sort();
    const enKeys = Object.keys(en.interviews ?? {}).sort();
    expect(esKeys).toEqual(enKeys);
  });
});
