import { db } from '@tims/db';
import { summarizeInterview, detectScorecardBias, scoreInterviewFit } from '@tims/ai';

function buildTranscriptText(transcript: unknown): string {
  if (typeof transcript === 'string') return transcript.slice(0, 40_000);
  if (Array.isArray(transcript)) {
    return transcript
      .slice(0, 200)
      .map((turn: unknown) => {
        if (turn && typeof turn === 'object') {
          const t = turn as Record<string, unknown>;
          const role = typeof t['role'] === 'string' ? t['role'] : 'speaker';
          const msg =
            typeof t['message'] === 'string'
              ? t['message']
              : typeof t['text'] === 'string'
                ? t['text']
                : '';
          return `${role}: ${msg}`;
        }
        return String(turn);
      })
      .join('\n');
  }
  return '';
}

export async function analyzeAiInterview(input: { sessionId: string }): Promise<void> {
  const session = await db.aiInterviewSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, organizationId: true, transcript: true, guideQuestions: true },
  });

  if (!session) {
    await db.aiInterviewSession.update({
      where: { id: input.sessionId },
      data: { analysisStatus: 'failed' },
      select: { id: true },
    });
    throw new Error(`Session not found: ${input.sessionId}`);
  }

  try {
    const transcriptText = buildTranscriptText(session.transcript);
    const orgId = session.organizationId;

    const guideQuestionsText = Array.isArray(session.guideQuestions)
      ? (session.guideQuestions as unknown[])
          .slice(0, 20)
          .map((q) => (typeof q === 'string' ? q : JSON.stringify(q)))
          .join('\n')
      : typeof session.guideQuestions === 'string'
        ? session.guideQuestions
        : '';

    const syntheticScorecard = {
      evaluatorLabel: 'AI Voice Interview',
      recommendation: 'transcript',
      ratings: {} as Record<string, number>,
      overallNotes: transcriptText.slice(0, 4000),
    };

    const [summaryResult, biasResult, fitResult] = await Promise.all([
      summarizeInterview(orgId, {
        candidateName: 'Candidate',
        vacancyTitle: 'Position',
        interviewType: 'AI Voice Interview',
        scorecards: [syntheticScorecard],
      }),
      detectScorecardBias(orgId, {
        vacancyTitle: 'Position',
        scorecards: [syntheticScorecard],
      }),
      scoreInterviewFit(orgId, {
        transcriptText,
        guideQuestions: guideQuestionsText || undefined,
      }),
    ]);

    await db.aiInterviewSession.update({
      where: { id: input.sessionId },
      data: {
        analysisStatus: 'completed',
        summary: summaryResult.result,
        biasReport: biasResult.result,
        fitScore: fitResult.result.score,
        analysisModel: fitResult.model,
      },
      select: { id: true },
    });
  } catch (err) {
    await db.aiInterviewSession.update({
      where: { id: input.sessionId },
      data: { analysisStatus: 'failed' },
      select: { id: true },
    });
    throw err;
  }
}
