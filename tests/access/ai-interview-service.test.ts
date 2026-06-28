import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports (vitest hoists vi.mock calls)
// ---------------------------------------------------------------------------
vi.mock('../../packages/api/src/repositories/ai-interview.repository', () => ({
  aiInterviewRepository: {
    findInterviewWithContext: vi.fn(),
    createSession: vi.fn(),
    findSessionResult: vi.fn(),
    findSessionByCandidateToken: vi.fn(),
  },
}));

vi.mock('../../packages/ai/src/index', () => ({
  generateInterviewGuide: vi.fn(),
}));

vi.mock('../../packages/api/src/services/ai-interview-access.service', () => ({
  assertAiInterviewEnabled: vi.fn().mockResolvedValue({
    enabled: true,
    monthlyBudget: null,
    billableUsdPerMinute: null,
    addonMonthlyFeeUsd: null,
    aiInterviewDefaultMaxMinutes: null,
    aiInterviewMaxMinutesByType: null,
  }),
  loadAiInterviewConfig: vi.fn().mockResolvedValue({ billableUsdPerMinute: 0.2 }),
  resolveMaxDurationSeconds: vi.fn().mockReturnValue(900),
  AI_VOICE_INTERVIEW_SLUG: 'ai-voice-interview',
  AI_INTERVIEW_DEFAULT_MAX_MINUTES: 15,
}));

import { aiInterviewService } from '../../packages/api/src/services/ai-interview.service';
import { aiInterviewRepository } from '../../packages/api/src/repositories/ai-interview.repository';
import { generateInterviewGuide } from '../../packages/ai/src/index';
import type { Prisma } from '@tims/db';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INTERVIEW_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SESSION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
// candidateToken is DISTINCT from SESSION_ID — the review finding being fixed.
const CANDIDATE_TOKEN = 'tok-abc-11111111-2222-3333-4444-555555555555';
const CANDIDATE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VACANCY_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const INTERVIEW_CTX = {
  id: INTERVIEW_ID,
  organizationId: ORG,
  candidateId: CANDIDATE_ID,
  vacancyId: VACANCY_ID,
  type: 'technical',
  duration: 60,
  candidate: { firstName: 'Ana', lastName: 'Gomez', currentTitle: 'Dev', skills: ['ts'] },
  vacancy: { title: 'Senior Dev', description: 'Build things' },
};

const GUIDE_RESULT = {
  result: { sections: [{ title: 'Tecnica', duration: 20, questions: ['q1'] }] },
  model: 'sonnet',
};

const CREATED_SESSION = {
  id: SESSION_ID,
  organizationId: ORG,
  interviewId: INTERVIEW_ID,
  candidateId: CANDIDATE_ID,
  vacancyId: VACANCY_ID,
  status: 'pending' as const,
  // candidateToken MUST differ from id — that's the whole point of this fix.
  candidateToken: CANDIDATE_TOKEN,
};

const SCOPE_WHERE: Prisma.InterviewWhereInput = { candidateId: CANDIDATE_ID };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createAiInterviewSession
// ---------------------------------------------------------------------------
describe('aiInterviewService.createAiInterviewSession', () => {
  it('throws NOT_FOUND when the interview is not in scope (organizationId+scopeWhere)', async () => {
    vi.mocked(aiInterviewRepository.findInterviewWithContext).mockResolvedValue(null as never);

    await expect(
      aiInterviewService.createAiInterviewSession({
        interviewId: INTERVIEW_ID,
        organizationId: ORG,
        scopeWhere: SCOPE_WHERE,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(generateInterviewGuide).not.toHaveBeenCalled();
    expect(aiInterviewRepository.createSession).not.toHaveBeenCalled();
  });

  it('composes organizationId AND scopeWhere in the repository lookup', async () => {
    vi.mocked(aiInterviewRepository.findInterviewWithContext).mockResolvedValue(
      INTERVIEW_CTX as never,
    );
    vi.mocked(generateInterviewGuide).mockResolvedValue(GUIDE_RESULT as never);
    vi.mocked(aiInterviewRepository.createSession).mockResolvedValue(CREATED_SESSION as never);

    await aiInterviewService.createAiInterviewSession({
      interviewId: INTERVIEW_ID,
      organizationId: ORG,
      scopeWhere: SCOPE_WHERE,
    });

    const call = vi.mocked(aiInterviewRepository.findInterviewWithContext).mock.calls[0];
    expect(call).toBeTruthy();
    // Must include organizationId
    expect(call[0]).toEqual(ORG);
    // Must include interviewId
    expect(call[1]).toEqual(INTERVIEW_ID);
    // Must include scopeWhere (passed through, not defaulted away)
    expect(call[2]).toEqual(SCOPE_WHERE);
  });

  it('calls generateInterviewGuide with the interview context', async () => {
    vi.mocked(aiInterviewRepository.findInterviewWithContext).mockResolvedValue(
      INTERVIEW_CTX as never,
    );
    vi.mocked(generateInterviewGuide).mockResolvedValue(GUIDE_RESULT as never);
    vi.mocked(aiInterviewRepository.createSession).mockResolvedValue(CREATED_SESSION as never);

    await aiInterviewService.createAiInterviewSession({
      interviewId: INTERVIEW_ID,
      organizationId: ORG,
      scopeWhere: SCOPE_WHERE,
    });

    expect(generateInterviewGuide).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        vacancyTitle: 'Senior Dev',
        interviewType: 'technical',
        durationMinutes: 60,
      }),
    );
  });

  it('persists status:pending and guideQuestions from generateInterviewGuide', async () => {
    vi.mocked(aiInterviewRepository.findInterviewWithContext).mockResolvedValue(
      INTERVIEW_CTX as never,
    );
    vi.mocked(generateInterviewGuide).mockResolvedValue(GUIDE_RESULT as never);
    vi.mocked(aiInterviewRepository.createSession).mockResolvedValue(CREATED_SESSION as never);

    await aiInterviewService.createAiInterviewSession({
      interviewId: INTERVIEW_ID,
      organizationId: ORG,
      scopeWhere: SCOPE_WHERE,
    });

    const createCall = vi.mocked(aiInterviewRepository.createSession).mock.calls[0];
    expect(createCall).toBeTruthy();
    const createArg = createCall[0];
    expect(createArg).toMatchObject({
      status: 'pending',
      guideQuestions: GUIDE_RESULT.result,
    });
  });

  it('returns a sessionId and a candidateLink', async () => {
    vi.mocked(aiInterviewRepository.findInterviewWithContext).mockResolvedValue(
      INTERVIEW_CTX as never,
    );
    vi.mocked(generateInterviewGuide).mockResolvedValue(GUIDE_RESULT as never);
    vi.mocked(aiInterviewRepository.createSession).mockResolvedValue(CREATED_SESSION as never);

    const result = await aiInterviewService.createAiInterviewSession({
      interviewId: INTERVIEW_ID,
      organizationId: ORG,
      scopeWhere: SCOPE_WHERE,
    });

    expect(result.sessionId).toBe(SESSION_ID);
    expect(typeof result.candidateLink).toBe('string');
    expect(result.candidateLink.length).toBeGreaterThan(0);
    // Must embed the candidateToken (not the session PK) in the link.
    expect(result.candidateLink).toContain(CANDIDATE_TOKEN);
    // The session PK must NOT appear in the link — that's the security fix.
    expect(result.candidateLink).not.toContain(SESSION_ID);
  });
});

// ---------------------------------------------------------------------------
// getAiInterviewResult
// ---------------------------------------------------------------------------
describe('aiInterviewService.getAiInterviewResult', () => {
  it('throws NOT_FOUND when the session is not in scope', async () => {
    vi.mocked(aiInterviewRepository.findSessionResult).mockResolvedValue(null as never);

    await expect(
      aiInterviewService.getAiInterviewResult({
        sessionId: SESSION_ID,
        organizationId: ORG,
        scopeWhere: SCOPE_WHERE,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('composes organizationId AND scopeWhere in the result lookup', async () => {
    const RESULT_ROW = {
      id: SESSION_ID,
      organizationId: ORG,
      interviewId: INTERVIEW_ID,
      status: 'completed',
      analysisStatus: 'completed',
      transcript: { lines: [] },
      summary: { text: 'ok' },
      biasReport: { risk: 'low' },
      fitScore: 85,
    };
    vi.mocked(aiInterviewRepository.findSessionResult).mockResolvedValue(RESULT_ROW as never);

    await aiInterviewService.getAiInterviewResult({
      sessionId: SESSION_ID,
      organizationId: ORG,
      scopeWhere: SCOPE_WHERE,
    });

    const call = vi.mocked(aiInterviewRepository.findSessionResult).mock.calls[0];
    expect(call).toBeTruthy();
    // organizationId
    expect(call[0]).toEqual(ORG);
    // sessionId
    expect(call[1]).toEqual(SESSION_ID);
    // scopeWhere — must not be defaulted to {}
    expect(call[2]).toEqual(SCOPE_WHERE);
  });

  it('returns only DTO fields — no raw DB record leaked', async () => {
    const RESULT_ROW = {
      id: SESSION_ID,
      organizationId: ORG,
      interviewId: INTERVIEW_ID,
      status: 'completed',
      analysisStatus: 'completed',
      transcript: { lines: ['line1'] },
      summary: { text: 'Buen candidato' },
      biasReport: { risk: 'low' },
      fitScore: 85,
    };
    vi.mocked(aiInterviewRepository.findSessionResult).mockResolvedValue(RESULT_ROW as never);

    const dto = await aiInterviewService.getAiInterviewResult({
      sessionId: SESSION_ID,
      organizationId: ORG,
      scopeWhere: SCOPE_WHERE,
    });

    // Required DTO fields
    expect(dto.sessionId).toBe(SESSION_ID);
    expect(dto.status).toBe('completed');
    expect(dto.analysisStatus).toBe('completed');
    expect(dto.transcript).toEqual({ lines: ['line1'] });
    expect(dto.summary).toEqual({ text: 'Buen candidato' });
    expect(dto.biasReport).toEqual({ risk: 'low' });
    expect(dto.fitScore).toBe(85);

    // Sensitive raw fields must NOT be present
    expect((dto as Record<string, unknown>).organizationId).toBeUndefined();
  });

  it('returns null for optional DTO fields when the session has no analysis yet', async () => {
    const RESULT_ROW = {
      id: SESSION_ID,
      organizationId: ORG,
      interviewId: INTERVIEW_ID,
      status: 'pending',
      analysisStatus: 'pending',
      transcript: null,
      summary: null,
      biasReport: null,
      fitScore: null,
    };
    vi.mocked(aiInterviewRepository.findSessionResult).mockResolvedValue(RESULT_ROW as never);

    const dto = await aiInterviewService.getAiInterviewResult({
      sessionId: SESSION_ID,
      organizationId: ORG,
      scopeWhere: SCOPE_WHERE,
    });

    expect(dto.transcript).toBeNull();
    expect(dto.summary).toBeNull();
    expect(dto.biasReport).toBeNull();
    expect(dto.fitScore).toBeNull();
    expect(dto.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// findSessionByCandidateToken (repository method — tested via mock to verify
// the service hands the token through and Task 4 can consume it)
// ---------------------------------------------------------------------------
describe('aiInterviewRepository.findSessionByCandidateToken', () => {
  it('resolves a session by its candidateToken and returns candidate-flow fields', async () => {
    const CANDIDATE_SESSION = {
      id: SESSION_ID,
      organizationId: ORG,
      candidateId: CANDIDATE_ID,
      status: 'pending' as const,
      consentedAt: null,
      elevenlabsAgentId: 'agent-xyz',
      guideQuestions: { sections: [] },
    };
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue(
      CANDIDATE_SESSION as never,
    );

    const result = await aiInterviewRepository.findSessionByCandidateToken(CANDIDATE_TOKEN);

    expect(vi.mocked(aiInterviewRepository.findSessionByCandidateToken)).toHaveBeenCalledWith(
      CANDIDATE_TOKEN,
    );
    expect(result).not.toBeNull();
    expect(result?.id).toBe(SESSION_ID);
    // organizationId returned so callers can scope downstream ops
    expect(result?.organizationId).toBe(ORG);
    // The token itself is NOT part of the returned select (it is the credential)
    expect((result as Record<string, unknown>).candidateToken).toBeUndefined();
  });

  it('returns null when candidateToken does not match any session', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue(null);

    const result = await aiInterviewRepository.findSessionByCandidateToken('unknown-token');

    expect(result).toBeNull();
  });
});
