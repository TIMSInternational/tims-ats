import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the params each agent hands to the gated door, then build the real
// user message from them — so these assertions cover exactly what would reach
// Bedrock (and the cache key), not a re-implementation.
const invokeAgentMock = vi.fn();
vi.mock('../../packages/ai/src/invoke', () => ({ invokeAgent: (...a: unknown[]) => invokeAgentMock(...a) }));

import {
  screenCandidate,
  CANDIDATE_SCREENER_SYSTEM_PROMPT,
  SCREENER_FALLBACK,
  candidateScreenerOutputSchema,
} from '../../packages/ai/src/agents/candidate-screener';
import { matchCandidate, CANDIDATE_MATCHER_SYSTEM_PROMPT } from '../../packages/ai/src/agents/candidate-matcher';
import { explainFit, FIT_EXPLAINER_SYSTEM_PROMPT } from '../../packages/ai/src/agents/fit-explainer';
import {
  INTERVIEW_FIT_SCORE_SYSTEM_PROMPT,
  FIT_SCORE_FALLBACK,
  fitScoreOutputSchema,
} from '../../packages/ai/src/agents/interview-fit-score';
import { checkInclusiveLanguage } from '../../packages/ai/src/agents/inclusive-language';
import { PROTECTED_CHARACTERISTICS } from '../../packages/ai/src/fairness';

interface CapturedParams {
  input: unknown;
  systemPrompt: string;
  buildUserMessage: (input: unknown) => string;
  fallback: (raw: string) => unknown;
}

function lastParams(): CapturedParams {
  const call = invokeAgentMock.mock.calls.at(-1);
  if (!call) throw new Error('invokeAgent was not called');
  return call[0] as CapturedParams;
}

const NAME = 'Valentina Zapata-Okonkwo';
const EMAIL = 'valentina@example.com';

beforeEach(() => {
  invokeAgentMock.mockReset();
  invokeAgentMock.mockResolvedValue({ data: {}, model: 'haiku' });
});

describe('candidate name never reaches the scoring prompts', () => {
  it('screener: message and input carry job-relevant fields only, even if a caller passes a name', async () => {
    const profile = { title: 'Backend Engineer', skills: ['Go', 'SQL'], experience: 6, name: NAME, email: EMAIL };
    await screenCandidate('org-1', profile, { title: 'Senior Backend Engineer', skills: ['Go'] });
    const p = lastParams();
    const msg = p.buildUserMessage(p.input);
    expect(msg).not.toContain('Valentina');
    expect(msg).not.toContain('Okonkwo');
    expect(msg).not.toContain(EMAIL);
    expect(JSON.stringify(p.input)).not.toContain('Valentina');
    expect(msg).toContain('the candidate');
    expect(msg).toContain('Backend Engineer');
    expect(msg).toContain('Go, SQL');
  });

  it('matcher: message and input carry job-relevant fields only', async () => {
    const candidateProfile = { title: 'Analyst', skills: ['Excel'], experience: 2, name: NAME };
    await matchCandidate('org-1', { candidateProfile, vacancies: [{ id: 'v1', title: 'Data Analyst' }] });
    const p = lastParams();
    const msg = p.buildUserMessage(p.input);
    expect(msg).not.toContain('Valentina');
    expect(JSON.stringify(p.input)).not.toContain('Valentina');
    expect(msg).toContain('the candidate');
    expect(msg).toContain('Data Analyst');
  });

  it('fit explainer: candidateName is dropped before the prompt and cache key', async () => {
    invokeAgentMock.mockResolvedValue({ data: { narrative: 'ok' }, model: 'haiku' });
    await explainFit('org-1', {
      overallScore: 70,
      breakdown: {
        assessment: null,
        interview: 70,
        experience: 70,
        education: null,
        languages: null,
        llmJudgment: null,
      },
      candidateName: NAME,
      vacancyTitle: 'Sales Director',
    });
    const p = lastParams();
    const msg = p.buildUserMessage(p.input);
    expect(msg).not.toContain('Valentina');
    expect(JSON.stringify(p.input)).not.toContain('Valentina');
    expect(msg).toContain('Sales Director');
  });

  it('fit explainer: renders a prior judgment whose score is null', async () => {
    invokeAgentMock.mockResolvedValue({ data: { narrative: 'ok' }, model: 'haiku' });
    await explainFit('org-1', {
      overallScore: 70,
      breakdown: {
        assessment: null,
        interview: 70,
        experience: 70,
        education: null,
        languages: null,
        llmJudgment: { score: null, recommendation: 'review', reasoning: 'n/a', strengths: [], gaps: [] },
      },
      vacancyTitle: 'Sales Director',
    });
    const p = lastParams();
    expect(p.buildUserMessage(p.input)).toContain('recommendation: review');
  });
});

describe('protected-attribute instruction', () => {
  it.each([
    ['candidate-screener', CANDIDATE_SCREENER_SYSTEM_PROMPT],
    ['candidate-matcher', CANDIDATE_MATCHER_SYSTEM_PROMPT],
    ['fit-explainer', FIT_EXPLAINER_SYSTEM_PROMPT],
    ['interview-fit-score', INTERVIEW_FIT_SCORE_SYSTEM_PROMPT],
  ])('%s system prompt forbids inferring/using protected characteristics', (_slug, prompt) => {
    expect(prompt).toMatch(/Do NOT infer, guess, use or mention any protected characteristic/);
    for (const c of PROTECTED_CHARACTERISTICS) expect(prompt).toContain(c);
    expect(prompt).toMatch(/ONLY from job-relevant evidence/);
  });

  it('covers the characteristics named in the launch requirement', () => {
    const list = PROTECTED_CHARACTERISTICS.join(' | ');
    for (const word of [
      'age',
      'gender',
      'ethnicity',
      'religion',
      'disability',
      'pregnancy',
      'marital',
      'nationality',
      'political',
      'union',
      'sexual orientation',
      'socioeconomic',
    ]) {
      expect(list).toContain(word);
    }
  });

  it('sends the instruction on the actual screener call', async () => {
    await screenCandidate('org-1', { title: 'x' }, { title: 'y' });
    expect(lastParams().systemPrompt).toBe(CANDIDATE_SCREENER_SYSTEM_PROMPT);
  });
});

describe('fallbacks never look like a real score', () => {
  it('screener fallback has score null and the screener schema accepts null', async () => {
    expect(SCREENER_FALLBACK.score).toBeNull();
    await screenCandidate('org-1', { title: 'x' }, { title: 'y' });
    expect(lastParams().fallback('garbage')).toMatchObject({ score: null, recommendation: 'review' });
    expect(candidateScreenerOutputSchema.parse(SCREENER_FALLBACK).score).toBeNull();
  });

  it('interview fit-score fallback is null and the schema accepts null', () => {
    expect(FIT_SCORE_FALLBACK.score).toBeNull();
    expect(fitScoreOutputSchema.parse({ score: null, rationale: 'insufficient' }).score).toBeNull();
  });

  it('inclusive-language fallback is null, not a default number', async () => {
    invokeAgentMock.mockImplementation(async (params: CapturedParams) => ({
      data: params.fallback(''),
      model: 'haiku',
    }));
    const r = await checkInclusiveLanguage('org-1', 'texto');
    expect(r.score).toBeNull();
  });
});

describe('output bounds', () => {
  const valid = {
    score: 70,
    matchedSkills: ['a'],
    missingSkills: [],
    strengths: ['s'],
    gaps: [],
    recommendation: 'review',
    reasoning: 'ok',
  };

  it('accepts the maximum list sizes the system prompt allows', () => {
    const n = (k: number, p: string) => Array.from({ length: k }, (_, i) => `${p}${i}`);
    expect(CANDIDATE_SCREENER_SYSTEM_PROMPT).toContain('At most 20 matchedSkills and 20 missingSkills');
    expect(CANDIDATE_SCREENER_SYSTEM_PROMPT).toContain('At most 10 strengths and 10 gaps');
    expect(() =>
      candidateScreenerOutputSchema.parse({
        ...valid,
        matchedSkills: n(20, 'm'),
        missingSkills: n(20, 'x'),
        strengths: n(10, 's'),
        gaps: n(10, 'g'),
      }),
    ).not.toThrow();
  });

  it('accepts a normal screener result', () => {
    expect(() => candidateScreenerOutputSchema.parse(valid)).not.toThrow();
  });

  it.each([
    ['reasoning', { reasoning: 'x'.repeat(2001) }],
    ['skill item', { matchedSkills: ['x'.repeat(201)] }],
    ['skill array', { missingSkills: Array.from({ length: 21 }, (_, i) => `s${i}`) }],
    ['strength item', { strengths: ['x'.repeat(301)] }],
    ['gaps array', { gaps: Array.from({ length: 11 }, (_, i) => `g${i}`) }],
    ['strengths array', { strengths: Array.from({ length: 11 }, (_, i) => `s${i}`) }],
  ])('rejects an oversize %s', (_label, patch) => {
    expect(() => candidateScreenerOutputSchema.parse({ ...valid, ...patch })).toThrow();
  });
});
