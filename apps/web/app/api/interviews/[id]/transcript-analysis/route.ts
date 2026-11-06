import { NextResponse } from 'next/server';
import { logger } from '@tims/shared';
import { analyzeTranscriptView, fetchTranscript } from '../../../../../lib/interview-transcript-analysis.server';
import { transcriptAnalysisSchema } from '../../../../../lib/interview-transcription';

export const dynamic = 'force-dynamic';
// Up to 4 transcript chunks × 2 parallel extraction calls, then one synthesis call (each bounded at 20 s).
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Advisory AI analysis of a video interview's transcript. Dark unless INTERVIEW_TRANSCRIPT_AI_ENABLED is exactly
 * "true" (404 otherwise, like an unmapped route). Same-origin, bearer-only (ambient cookies never authenticate),
 * no request body. C# authorizes the caller and scopes the transcript; the AI runs through invokeAgent with the
 * organization's budget. The answer is advice for the evaluator: nothing is stored and no scorecard is written.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const noStore = { 'cache-control': 'no-store' };
  const fail = (status: number, code: string) => NextResponse.json({ code }, { status, headers: noStore });
  if (process.env.INTERVIEW_TRANSCRIPT_AI_ENABLED !== 'true') return fail(404, 'not_found');
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site')
    return fail(403, 'forbidden');
  const authorization = request.headers.get('authorization');
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]{1,4096}$/.test(authorization)) return fail(401, 'unauthorized');
  const { id } = await params;
  if (!UUID.test(id)) return fail(400, 'invalid_input');

  try {
    const transcript = await fetchTranscript(request, id.toLowerCase(), authorization);
    if (!transcript.ok) return NextResponse.json(transcript.body, { status: transcript.status, headers: noStore });
    const analysis = await analyzeTranscriptView(transcript.view);
    // Re-validate our own output against the published contract before it leaves the server.
    return NextResponse.json(transcriptAnalysisSchema.parse(analysis), { status: 200, headers: noStore });
  } catch (error) {
    // invokeAgent throws TOO_MANY_REQUESTS when the org's AI budget is exhausted (fail closed).
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'TOO_MANY_REQUESTS') return fail(429, 'ai_budget_exceeded');
    // Interview id only: never the transcript, the bearer or the model output.
    logger.error(
      { err: error instanceof Error ? error.name : 'unknown', interviewId: id },
      'transcript analysis failed',
    );
    return fail(503, 'ai_unavailable');
  }
}
