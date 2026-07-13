import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI package by the realpath the service resolves '@tims/ai' to.
vi.mock('../../packages/ai/src/index', () => ({ parseCV: vi.fn(), screenCandidate: vi.fn() }));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({ candidateRepository: {} }));
vi.mock('../../packages/api/src/repositories/candidate-ai.repository', () => ({
  candidateAiRepository: { getCandidateProfile: vi.fn(), getVacancyForScreening: vi.fn() },
}));
const computeFitScoreMock = vi.fn();
vi.mock('../../packages/api/src/services/fit-engine.service', () => ({
  fitEngineService: { computeFitScore: (...a: unknown[]) => computeFitScoreMock(...a) },
}));

import { candidateAiService } from '../../packages/api/src/services/candidate-ai.service';
import { screenCandidate as screenCandidateAgent } from '../../packages/ai/src/index';
import { candidateAiRepository } from '../../packages/api/src/repositories/candidate-ai.repository';

const SCREEN_RESULT = {
  result: {
    score: 80, matchedSkills: ['ts'], missingSkills: [], strengths: ['fast'], gaps: [],
    recommendation: 'advance' as const, reasoning: 'strong fit',
  },
  model: 'sonnet',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(screenCandidateAgent).mockResolvedValue(SCREEN_RESULT as never);
  vi.mocked(candidateAiRepository.getCandidateProfile).mockResolvedValue({
    id: 'c1', firstName: 'Ana', lastName: 'Gómez', currentTitle: 'Dev', skills: ['ts', 'react'], yearsExperience: 5,
  } as never);
  vi.mocked(candidateAiRepository.getVacancyForScreening).mockResolvedValue({
    id: 'v1', title: 'Senior Dev', description: 'Build stuff', settings: { skills: ['ts'], requirements: ['5+ yrs'] },
  } as never);
  computeFitScoreMock.mockResolvedValue({ fitScoreId: 'fitscore-1', overallScore: 82, isPartial: true, breakdown: {}, weights: {} });
});

describe('candidateAiService.screenCandidate', () => {
  it('maps profile + vacancy and runs the gated agent', async () => {
    const r = await candidateAiService.screenCandidate('org-1', 'c1', 'v1');

    expect(screenCandidateAgent).toHaveBeenCalledWith(
      'org-1',
      { name: 'Ana Gómez', title: 'Dev', skills: ['ts', 'react'], experience: 5 },
      { title: 'Senior Dev', requirements: ['5+ yrs', 'Build stuff'], skills: ['ts'] },
    );
    expect(r).toMatchObject({ score: 80, recommendation: 'advance', model: 'sonnet', fitScoreId: 'fitscore-1' });
  });

  it('delegates FitScore computation to fitEngineService with the screener result as llmJudgment', async () => {
    const result = await candidateAiService.screenCandidate('org-1', 'c1', 'v1');

    expect(computeFitScoreMock).toHaveBeenCalledWith(
      'org-1', 'c1', 'v1',
      {
        llmJudgment: {
          score: SCREEN_RESULT.result.score,
          recommendation: SCREEN_RESULT.result.recommendation,
          reasoning: SCREEN_RESULT.result.reasoning,
          strengths: SCREEN_RESULT.result.strengths,
          gaps: SCREEN_RESULT.result.gaps,
        },
      },
    );
    expect(result.fitScoreId).toBe('fitscore-1');
    expect(result.overallScore).toBe(82);
    expect(result.isPartial).toBe(true);
  });

  it('coerces non-array skills/requirements to empty arrays', async () => {
    vi.mocked(candidateAiRepository.getCandidateProfile).mockResolvedValue({
      id: 'c1', firstName: 'Ana', lastName: 'Gómez', currentTitle: null, skills: null, yearsExperience: null,
    } as never);
    vi.mocked(candidateAiRepository.getVacancyForScreening).mockResolvedValue({
      id: 'v1', title: 'Senior Dev', description: null, settings: {},
    } as never);

    await candidateAiService.screenCandidate('org-1', 'c1', 'v1');
    expect(screenCandidateAgent).toHaveBeenCalledWith(
      'org-1',
      { name: 'Ana Gómez', title: undefined, skills: [], experience: undefined },
      { title: 'Senior Dev', requirements: [], skills: [] },
    );
  });

  it('throws NOT_FOUND (no AI spend) when the candidate is missing', async () => {
    vi.mocked(candidateAiRepository.getCandidateProfile).mockResolvedValue(null as never);
    await expect(candidateAiService.screenCandidate('org-1', 'cx', 'v1')).rejects.toThrow();
    expect(screenCandidateAgent).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND (no AI spend) when the vacancy is missing', async () => {
    vi.mocked(candidateAiRepository.getVacancyForScreening).mockResolvedValue(null as never);
    await expect(candidateAiService.screenCandidate('org-1', 'c1', 'vx')).rejects.toThrow();
    expect(screenCandidateAgent).not.toHaveBeenCalled();
  });
});
