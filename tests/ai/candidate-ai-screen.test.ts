import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI package by the realpath the service resolves '@tims/ai' to.
vi.mock('../../packages/ai/src/index', () => ({ parseCV: vi.fn(), screenCandidate: vi.fn() }));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({ candidateRepository: {} }));
vi.mock('../../packages/api/src/repositories/candidate-ai.repository', () => ({
  candidateAiRepository: { getCandidateProfile: vi.fn(), getVacancyForScreening: vi.fn(), upsertFitScore: vi.fn() },
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
  vi.mocked(candidateAiRepository.upsertFitScore).mockResolvedValue({ id: 'fit-1', overallScore: 80 } as never);
});

describe('candidateAiService.screenCandidate', () => {
  it('maps profile + vacancy, runs the gated agent, and persists a FitScore', async () => {
    const r = await candidateAiService.screenCandidate('org-1', 'c1', 'v1');

    expect(screenCandidateAgent).toHaveBeenCalledWith(
      'org-1',
      { name: 'Ana Gómez', title: 'Dev', skills: ['ts', 'react'], experience: 5 },
      { title: 'Senior Dev', requirements: ['5+ yrs', 'Build stuff'], skills: ['ts'] },
    );
    expect(candidateAiRepository.upsertFitScore).toHaveBeenCalledWith('org-1', 'c1', 'v1', 80, SCREEN_RESULT.result);
    expect(r).toMatchObject({ score: 80, recommendation: 'advance', model: 'sonnet', fitScoreId: 'fit-1' });
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
