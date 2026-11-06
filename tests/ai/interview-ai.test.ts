import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI package by the realpath the service resolves '@tims/ai' to.
vi.mock('../../packages/ai/src/index', async () => {
  const guide = await vi.importActual<typeof import('../../packages/ai/src/agents/interview-guide')>(
    '../../packages/ai/src/agents/interview-guide',
  );
  return {
    summarizeInterview: vi.fn(),
    generateInterviewGuide: vi.fn(),
    detectScorecardBias: vi.fn(),
    // Pure: the real reader of stored CV parses.
    guideCvFromParsedDocuments: guide.guideCvFromParsedDocuments,
  };
});
vi.mock('../../packages/api/src/repositories/interview-ai.repository', () => ({
  interviewAiRepository: { findInterviewForAi: vi.fn(), upsertSummary: vi.fn() },
}));

import { interviewAiService } from '../../packages/api/src/services/interview-ai.service';
import {
  summarizeInterview,
  generateInterviewGuide,
  detectScorecardBias,
} from '../../packages/ai/src/index';
import { interviewAiRepository } from '../../packages/api/src/repositories/interview-ai.repository';

const INTERVIEW = {
  id: 'i1',
  type: 'technical',
  duration: 60,
  candidate: { firstName: 'Ana', lastName: 'Gomez', currentTitle: 'Dev', skills: ['ts', 'react'], documents: [] },
  vacancy: { title: 'Senior Dev', description: 'Build things', jobProfile: null },
  scorecards: [
    {
      ratings: { tech: 4 },
      recommendation: 'yes',
      overallNotes: 'Solida',
      evaluator: { firstName: 'Luis', lastName: 'Diaz' },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(interviewAiRepository.findInterviewForAi).mockResolvedValue(INTERVIEW as never);
});

describe('interviewAiService.generateGuide', () => {
  it('throws NOT_FOUND before any AI spend when the interview is not in the org', async () => {
    vi.mocked(interviewAiRepository.findInterviewForAi).mockResolvedValue(null as never);
    await expect(interviewAiService.generateGuide('org-1', 'i1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(generateInterviewGuide).not.toHaveBeenCalled();
  });

  it('passes vacancy + candidate context to the gated agent and returns sections', async () => {
    vi.mocked(generateInterviewGuide).mockResolvedValue({
      result: { sections: [{ title: 'Tecnica', duration: 20, questions: ['q1'] }] },
      model: 'sonnet',
    } as never);

    const r = await interviewAiService.generateGuide('org-1', 'i1');
    expect(generateInterviewGuide).toHaveBeenCalledWith('org-1', {
      vacancyTitle: 'Senior Dev',
      vacancyDescription: 'Build things',
      interviewType: 'technical',
      durationMinutes: 60,
      candidateTitle: 'Dev',
      candidateSkills: ['ts', 'react'],
      competencies: [],
      candidateCv: null,
      redact: ['Ana', 'Gomez'],
    });
    expect(r.sections).toHaveLength(1);
    expect(r.model).toBe('sonnet');
  });
});

describe('interviewAiService.generateGuide — job profile + parsed CV', () => {
  it('sends the scorecard competency set and the newest parsed CV (no contact fields), and returns the question sets', async () => {
    vi.mocked(interviewAiRepository.findInterviewForAi).mockResolvedValue({
      ...INTERVIEW,
      candidate: {
        ...INTERVIEW.candidate,
        documents: [
          { parsedData: null },
          { parsedData: { name: 'Ana Gomez', email: 'ana@x.co', summary: 'Dev 5 años', experience: [] } },
        ],
      },
      vacancy: {
        ...INTERVIEW.vacancy,
        jobProfile: { competencies: [{ name: 'SQL', level: 4, scaleMax: 5, description: 'Consultas' }, { name: 'Excel', level: 2 }] },
      },
    } as never);
    const SETS = [{ competency: 'SQL', targetLevel: 4, targetScaleMax: 5, questions: ['q'] }];
    vi.mocked(generateInterviewGuide).mockResolvedValue({ result: { sections: [], competencyQuestions: SETS }, model: 'haiku' } as never);

    const r = await interviewAiService.generateGuide('org-1', 'i1');
    const input = vi.mocked(generateInterviewGuide).mock.calls[0]![1];
    expect(input.competencies).toEqual([
      { name: 'SQL', description: 'Consultas', targetLevel: 4, targetScaleMax: 5 },
      { name: 'Excel', description: null, targetLevel: 2, targetScaleMax: 5 },
    ]);
    expect(input.candidateCv).toEqual({ summary: 'Dev 5 años', experience: [] });
    expect(JSON.stringify(input.candidateCv)).not.toContain('ana@x.co');
    expect(r.competencyQuestions).toEqual(SETS);
  });
});

describe('interviewAiService.generateSummary', () => {
  it('refuses to summarize with zero scorecards (nothing honest to summarize)', async () => {
    vi.mocked(interviewAiRepository.findInterviewForAi).mockResolvedValue({
      ...INTERVIEW,
      scorecards: [],
    } as never);
    await expect(interviewAiService.generateSummary('org-1', 'i1')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(summarizeInterview).not.toHaveBeenCalled();
    expect(interviewAiRepository.upsertSummary).not.toHaveBeenCalled();
  });

  it('summarizes scorecards via the gated agent and persists the result', async () => {
    const RESULT = {
      summary: 'Buen desempeno',
      keyPoints: ['kp'],
      strengths: ['s'],
      concerns: [],
    };
    vi.mocked(summarizeInterview).mockResolvedValue({ result: RESULT, model: 'sonnet' } as never);
    vi.mocked(interviewAiRepository.upsertSummary).mockResolvedValue({ id: 'sum1' } as never);

    await interviewAiService.generateSummary('org-1', 'i1');

    expect(summarizeInterview).toHaveBeenCalledWith('org-1', {
      candidateName: 'Ana Gomez',
      vacancyTitle: 'Senior Dev',
      interviewType: 'technical',
      scorecards: [
        { evaluatorLabel: 'Luis Diaz', recommendation: 'yes', ratings: { tech: 4 }, overallNotes: 'Solida' },
      ],
    });
    expect(interviewAiRepository.upsertSummary).toHaveBeenCalledWith('org-1', 'i1', RESULT, 'sonnet');
  });
});

describe('interviewAiService.detectBias', () => {
  it('refuses to analyze with zero scorecards', async () => {
    vi.mocked(interviewAiRepository.findInterviewForAi).mockResolvedValue({
      ...INTERVIEW,
      scorecards: [],
    } as never);
    await expect(interviewAiService.detectBias('org-1', 'i1')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(detectScorecardBias).not.toHaveBeenCalled();
  });

  it('returns the agent verdict with the analyzed count — including degraded "unknown"', async () => {
    vi.mocked(detectScorecardBias).mockResolvedValue({
      result: { biasIndicators: [], overallRisk: 'unknown', recommendations: ['revision manual'] },
      model: 'sonnet',
    } as never);

    const r = await interviewAiService.detectBias('org-1', 'i1');
    expect(r.scorecardsAnalyzed).toBe(1);
    expect(r.overallRisk).toBe('unknown'); // degraded fallback — never a fake "low"
    expect(r.recommendations).toEqual(['revision manual']);
  });
});
