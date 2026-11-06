import 'server-only';
import { analyzeInterviewTranscript, type TranscriptAnalysis } from '@tims/ai';
import { resolveCompetencies } from '@tims/shared';
import { RELAY_HEADER, signRelayAttribution } from './platform-api/relay-attribution';
import { transcriptViewSchema, type TranscriptView } from './interview-transcription';

// ---------------------------------------------------------------------------
// Server side of the advisory transcript analysis (POST /api/interviews/[id]/transcript-analysis).
//
// Why here and not in C# or a webhook: AI runs ONLY through packages/ai invokeAgent (TypeScript), and C# owns the
// data. So C# authorizes the evaluator (interview:read + scope) and returns the pseudonymized transcript; this
// module only forwards the evaluator's own bearer, validates the answer and calls the gated door. Nothing is
// triggered by the provider webhook: a human presses the button, the per-org AI budget applies, and no AI cost is
// spent on interviews nobody reviews.
// ---------------------------------------------------------------------------

const DEFAULT_LABELS: Record<string, { es: string; en: string }> = {
  leadership: { es: 'Liderazgo', en: 'Leadership' },
  analytical: { es: 'Pensamiento analítico', en: 'Analytical thinking' },
  communication: { es: 'Comunicación', en: 'Communication' },
  problem_solving: { es: 'Resolución de problemas', en: 'Problem solving' },
};

export type TranscriptFetchResult =
  | { ok: true; view: TranscriptView }
  | { ok: false; status: number; body: { code: string; message?: string } };

const IMPERSONATION_COOKIE = 'tims_impersonation';

/** The fixed C# upstream for this one path, or null when unset/unsafe (same rules as the platform relay). */
export function transcriptUpstream(
  interviewId: string,
  configured = process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL,
): URL | null {
  if (!configured) return null;
  let upstream: URL;
  try {
    upstream = new URL(configured);
  } catch {
    return null;
  }
  if (
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    (upstream.protocol !== 'https:' && !(upstream.protocol === 'http:' && upstream.hostname === 'localhost'))
  )
    return null;
  upstream.pathname = `${upstream.pathname.replace(/\/$/, '')}/tenant/interviews/${encodeURIComponent(interviewId)}/transcript`;
  return upstream;
}

/** GET the transcript from C# as the calling evaluator (their bearer + only the impersonation cookie). */
export async function fetchTranscript(
  request: Request,
  interviewId: string,
  authorization: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TranscriptFetchResult> {
  const upstream = transcriptUpstream(interviewId);
  if (!upstream) return { ok: false, status: 503, body: { code: 'platform_unavailable' } };
  const cookies = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${IMPERSONATION_COOKIE}=`));
  if (cookies.length > 1 || cookies.some((value) => value.length > 4096))
    return { ok: false, status: 400, body: { code: 'invalid_request' } };
  const headers = new Headers({ authorization, accept: 'application/json' });
  if (cookies.length === 1) headers.set('cookie', cookies[0]!);
  // Attribution is signed for the request C# actually receives (a GET on the transcript path).
  headers.set(
    RELAY_HEADER,
    signRelayAttribution(
      new Request(request.url, { method: 'GET', headers: request.headers }),
      upstream,
      authorization,
      cookies[0] ?? '',
    ),
  );
  const response = await fetchImpl(upstream, {
    method: 'GET',
    headers,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code =
      body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
        ? String((body as { code: string }).code).slice(0, 64)
        : response.status === 404
          ? 'not_found'
          : 'platform_error';
    // 401/403/404/409 pass through as-is; anything else is the platform's problem, not the caller's.
    const status = [401, 403, 404, 409].includes(response.status) ? response.status : 502;
    return { ok: false, status, body: { code } };
  }
  const parsed = transcriptViewSchema.safeParse(body);
  if (!parsed.success || parsed.data.interviewId !== interviewId)
    return { ok: false, status: 502, body: { code: 'platform_error' } };
  return { ok: true, view: parsed.data };
}

/** The scorecard's own competency set (same keys the evaluator rates), labelled for the prompt. */
export function competenciesFor(view: TranscriptView): { key: string; label: string }[] {
  const resolved = resolveCompetencies(view.competencies.map((c) => ({ name: c.name, level: c.level ?? undefined })));
  return resolved.items.map((item) => ({
    key: item.key,
    label: item.label ?? DEFAULT_LABELS[item.key]?.[view.language] ?? item.key,
  }));
}

export async function analyzeTranscriptView(view: TranscriptView, userId?: string): Promise<TranscriptAnalysis> {
  const { result } = await analyzeInterviewTranscript(
    view.organizationId,
    {
      language: view.language,
      vacancyTitle: view.vacancyTitle,
      competencies: competenciesFor(view),
      segments: view.segments,
      sourceTruncated: view.truncated,
    },
    userId,
  );
  return result;
}
