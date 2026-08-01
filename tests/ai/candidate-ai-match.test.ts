import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI package by the realpath the service resolves '@tims/ai' to.
vi.mock('../../packages/ai/src/index', () => ({ parseCV: vi.fn(), screenCandidate: vi.fn(), matchCandidate: vi.fn() }));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({ candidateRepository: {} }));
vi.mock('../../packages/api/src/repositories/candidate-ai.repository', () => ({
  candidateAiRepository: {
    getCandidateProfile: vi.fn(),
    getVacancyForScreening: vi.fn(),
    getOpenVacanciesForMatching: vi.fn(),
  },
}));
vi.mock('../../packages/api/src/services/fit-engine.service', () => ({
  fitEngineService: { computeFitScore: vi.fn() },
}));

import { candidateAiService } from '../../packages/api/src/services/candidate-ai.service';
import { matchCandidate as matchCandidateAgent } from '../../packages/ai/src/index';
import { candidateAiRepository } from '../../packages/api/src/repositories/candidate-ai.repository';

const MATCH_RESULT = {
  result: {
    recommendedVacancies: [
      { vacancyId: 'v1', matchScore: 90 },
      { vacancyId: 'v-hallucinated', matchScore: 99 },
    ],
    suggestedActions: ['Schedule technical assessment'],
  },
  model: 'sonnet',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(matchCandidateAgent).mockResolvedValue(MATCH_RESULT as never);
  vi.mocked(candidateAiRepository.getCandidateProfile).mockResolvedValue({
    id: 'c1',
    firstName: 'Ana',
    lastName: 'Gómez',
    currentTitle: 'Dev',
    skills: ['ts', 'react'],
    yearsExperience: 5,
  } as never);
  vi.mocked(candidateAiRepository.getOpenVacanciesForMatching).mockResolvedValue([
    { id: 'v1', title: 'Senior Backend Engineer' },
    { id: 'v2', title: 'Frontend Engineer' },
  ] as never);
});

describe('candidateAiService.getRecommendations', () => {
  it('maps the candidate profile and passes the bounded open-vacancy set to the agent', async () => {
    await candidateAiService.getRecommendations('org-1', 'c1');

    expect(candidateAiRepository.getOpenVacanciesForMatching).toHaveBeenCalledWith('org-1', 20);
    expect(matchCandidateAgent).toHaveBeenCalledWith('org-1', {
      candidateProfile: { name: 'Ana Gómez', title: 'Dev', skills: ['ts', 'react'], experience: 5 },
      vacancies: [
        { id: 'v1', title: 'Senior Backend Engineer' },
        { id: 'v2', title: 'Frontend Engineer' },
      ],
    });
  });

  it("drops any recommended vacancy id the model hallucinated outside the fetched set, and uses our own title (not the model's)", async () => {
    const result = await candidateAiService.getRecommendations('org-1', 'c1');

    expect(result.recommendedVacancies).toEqual([
      { vacancyId: 'v1', title: 'Senior Backend Engineer', matchScore: 90 },
    ]);
    expect(result.candidateId).toBe('c1');
    expect(result.modelVersion).toBe('sonnet');
    expect(result.suggestedActions).toEqual(['Schedule technical assessment']);
  });

  it('skips the AI call entirely (no spend) when the org has no open vacancies', async () => {
    vi.mocked(candidateAiRepository.getOpenVacanciesForMatching).mockResolvedValue([] as never);

    const result = await candidateAiService.getRecommendations('org-1', 'c1');

    expect(matchCandidateAgent).not.toHaveBeenCalled();
    expect(result.recommendedVacancies).toEqual([]);
    expect(result.modelVersion).toBe('no-open-vacancies');
  });

  it('coerces non-array skills to an empty array', async () => {
    vi.mocked(candidateAiRepository.getCandidateProfile).mockResolvedValue({
      id: 'c1',
      firstName: 'Ana',
      lastName: 'Gómez',
      currentTitle: null,
      skills: null,
      yearsExperience: null,
    } as never);

    await candidateAiService.getRecommendations('org-1', 'c1');

    expect(matchCandidateAgent).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        candidateProfile: { name: 'Ana Gómez', title: undefined, skills: [], experience: undefined },
      }),
    );
  });

  it('throws NOT_FOUND (no AI spend) when the candidate is missing', async () => {
    vi.mocked(candidateAiRepository.getCandidateProfile).mockResolvedValue(null as never);

    await expect(candidateAiService.getRecommendations('org-1', 'cx')).rejects.toThrow();
    expect(matchCandidateAgent).not.toHaveBeenCalled();
  });
});
