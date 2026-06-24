import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tims/ai', () => ({
  summarizeInterview: vi.fn(),
  detectScorecardBias: vi.fn(),
  scoreInterviewFit: vi.fn(),
}));

vi.mock('../../packages/db/src/index', () => {
  const mockDb = {
    aiInterviewSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    db: mockDb,
    AiAnalysisStatus: {
      pending: 'pending',
      completed: 'completed',
      failed: 'failed',
    },
  };
});

import { analyzeAiInterview } from '../../packages/api/src/services/ai-interview-analysis.service';
import { summarizeInterview, detectScorecardBias, scoreInterviewFit } from '@tims/ai';
import { db } from '../../packages/db/src/index';

const mockSummarizeInterview = vi.mocked(summarizeInterview);
const mockDetectScorecardBias = vi.mocked(detectScorecardBias);
const mockScoreInterviewFit = vi.mocked(scoreInterviewFit);
const mockDb = db as unknown as {
  aiInterviewSession: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ORG_ID = 'ffffffff-0000-1111-2222-333333333333';

const mockSession = {
  id: SESSION_ID,
  organizationId: ORG_ID,
  transcript: [
    { role: 'interviewer', message: 'Tell me about yourself.' },
    { role: 'candidate', message: 'I am a software engineer with 5 years of experience.' },
  ],
  guideQuestions: ['Tell me about yourself', 'What are your strengths?'],
};

beforeEach(() => {
  vi.clearAllMocks();

  mockDb.aiInterviewSession.findUnique.mockResolvedValue(mockSession);
  mockDb.aiInterviewSession.update.mockResolvedValue({ id: SESSION_ID });

  mockSummarizeInterview.mockResolvedValue({
    result: { summary: 'Good candidate', keyPoints: [], strengths: [], concerns: [] },
    model: 'claude-3-sonnet',
  });
  mockDetectScorecardBias.mockResolvedValue({
    result: { biasIndicators: [], overallRisk: 'none', recommendations: [] },
    model: 'claude-3-sonnet',
  });
  mockScoreInterviewFit.mockResolvedValue({
    result: { score: 75, rationale: 'Candidate showed strong experience.' },
    model: 'claude-3-sonnet',
  });
});

describe('analyzeAiInterview', () => {
  it('invokes all 3 agents via their wrapper functions', async () => {
    await analyzeAiInterview({ sessionId: SESSION_ID });
    expect(mockSummarizeInterview).toHaveBeenCalledOnce();
    expect(mockDetectScorecardBias).toHaveBeenCalledOnce();
    expect(mockScoreInterviewFit).toHaveBeenCalledOnce();
  });

  it('persists fitScore (0–100), summary, biasReport and sets analysisStatus completed', async () => {
    await analyzeAiInterview({ sessionId: SESSION_ID });

    expect(mockDb.aiInterviewSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SESSION_ID },
        data: expect.objectContaining({
          analysisStatus: 'completed',
          fitScore: 75,
        }),
      }),
    );

    const updateCall = mockDb.aiInterviewSession.update.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { data?: { analysisStatus?: string } }).data?.analysisStatus === 'completed',
    );
    expect(updateCall).toBeDefined();
    const data = (updateCall![0] as { data: Record<string, unknown> }).data;
    expect(data['summary']).toBeDefined();
    expect(data['biasReport']).toBeDefined();
  });

  it('passes orgId from session to all 3 agents', async () => {
    await analyzeAiInterview({ sessionId: SESSION_ID });
    expect(mockSummarizeInterview).toHaveBeenCalledWith(ORG_ID, expect.any(Object));
    expect(mockDetectScorecardBias).toHaveBeenCalledWith(ORG_ID, expect.any(Object));
    expect(mockScoreInterviewFit).toHaveBeenCalledWith(ORG_ID, expect.any(Object));
  });

  it('sets analysisStatus failed when scoreInterviewFit throws, does not leave pending', async () => {
    mockScoreInterviewFit.mockRejectedValue(new Error('AI budget exceeded'));

    await expect(analyzeAiInterview({ sessionId: SESSION_ID })).rejects.toThrow(
      'AI budget exceeded',
    );

    const updateCalls = mockDb.aiInterviewSession.update.mock.calls as Array<
      [{ data: { analysisStatus: string } }]
    >;
    const lastStatus = updateCalls[updateCalls.length - 1][0].data.analysisStatus;
    expect(lastStatus).toBe('failed');
  });

  it('sets analysisStatus failed when summarizeInterview throws', async () => {
    mockSummarizeInterview.mockRejectedValue(new Error('network error'));

    await expect(analyzeAiInterview({ sessionId: SESSION_ID })).rejects.toThrow('network error');

    const updateCalls = mockDb.aiInterviewSession.update.mock.calls as Array<
      [{ data: { analysisStatus: string } }]
    >;
    const lastStatus = updateCalls[updateCalls.length - 1][0].data.analysisStatus;
    expect(lastStatus).toBe('failed');
  });

  it('sets analysisStatus failed when session is not found', async () => {
    mockDb.aiInterviewSession.findUnique.mockResolvedValue(null);

    await expect(analyzeAiInterview({ sessionId: SESSION_ID })).rejects.toThrow();

    const updateCalls = mockDb.aiInterviewSession.update.mock.calls as Array<
      [{ data: { analysisStatus: string } }]
    >;
    expect(updateCalls[0][0].data.analysisStatus).toBe('failed');
  });

  it('scoreInterviewFit receives transcriptText built from transcript array', async () => {
    await analyzeAiInterview({ sessionId: SESSION_ID });

    const fitCall = mockScoreInterviewFit.mock.calls[0] as [string, { transcriptText: string }];
    const transcriptText = fitCall[1].transcriptText;
    expect(transcriptText).toContain('interviewer');
    expect(transcriptText).toContain('Tell me about yourself');
  });
});
