import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analyzeMock = vi.fn();
vi.mock('@tims/ai', () => ({ analyzeInterviewTranscript: (...a: unknown[]) => analyzeMock(...a) }));

import { POST } from '../../apps/web/app/api/interviews/[id]/transcript-analysis/route';
import { competenciesFor } from '../../apps/web/lib/interview-transcript-analysis.server';

const ID = '1234abcd-0000-4000-8000-000000000001';
const ORG = '11111111-1111-4111-8111-111111111111';
const fetchMock = vi.fn();

const transcript = {
  organizationId: ORG,
  interviewId: ID,
  vacancyTitle: 'Analista',
  language: 'es',
  competencies: [{ name: 'SQL', level: 4 }],
  segments: [
    { startSeconds: 1, speaker: 'interviewer_1', text: '¿Qué usa?' },
    { startSeconds: 4, speaker: 'candidate', text: 'Uso SQL a diario en reportes de ventas.' },
  ],
  truncated: false,
};

const analysis = {
  summary: 'Habló de SQL.',
  questions: [],
  competencies: [
    {
      key: 'SQL',
      label: 'SQL',
      suggestedRating: 3,
      rationale: 'Uso diario.',
      evidence: [{ quote: 'Uso SQL a diario', atSeconds: 4 }],
    },
  ],
  limitations: [],
  degraded: false,
  truncated: false,
};

beforeEach(() => {
  vi.stubEnv('INTERVIEW_TRANSCRIPT_AI_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://api.example.test');
  vi.stubEnv('NEXTAUTH_SECRET', 'relay-test-secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  analyzeMock.mockReset();
  // A fresh Response per call: a body can be read only once.
  fetchMock.mockImplementation(async () => Response.json(transcript));
  analyzeMock.mockResolvedValue({ result: analysis, model: 'haiku' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function call(id = ID, headers: Record<string, string> = {}) {
  const request = new Request(`https://app.example.test/api/interviews/${id}/transcript-analysis`, {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      authorization: 'Bearer eyJ.header.sig',
      cookie: 'sb-access-token=private; tims_impersonation=signed',
      ...headers,
    },
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

describe('POST /api/interviews/[id]/transcript-analysis', () => {
  it('is dark unless INTERVIEW_TRANSCRIPT_AI_ENABLED is exactly "true"', async () => {
    vi.stubEnv('INTERVIEW_TRANSCRIPT_AI_ENABLED', '1');
    expect((await call()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it('refuses cross-site, cookie-only and malformed requests before any upstream call', async () => {
    expect((await call(ID, { origin: 'https://attacker.test' })).status).toBe(403);
    expect((await call(ID, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call(ID, { authorization: '' })).status).toBe(401);
    expect((await call('not-a-uuid')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only the evaluator's bearer + impersonation cookie to C#, then runs the gated AI with C#'s org", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`https://api.example.test/tenant/interviews/${ID}/transcript`);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { headers: Headers };
    expect(init.method).toBe('GET');
    expect(init.headers.get('authorization')).toBe('Bearer eyJ.header.sig');
    expect(init.headers.get('cookie')).toBe('tims_impersonation=signed');
    expect(init.headers.get('x-tims-relay-attribution')).toBeTruthy();
    const [orgId, input] = analyzeMock.mock.calls[0] as [string, { competencies: unknown; segments: unknown[] }];
    expect(orgId).toBe(ORG);
    expect(input.competencies).toEqual([{ key: 'SQL', label: 'SQL' }]);
    expect(input.segments).toHaveLength(2);
    expect((await response.json()).competencies[0].suggestedRating).toBe(3);
  });

  it("passes the platform's refusal through without running the AI", async () => {
    fetchMock.mockResolvedValue(Response.json({ code: 'candidate_consent_missing', message: 'x' }, { status: 409 }));
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'candidate_consent_missing' });
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await call()).status).toBe(404);
    fetchMock.mockResolvedValue(Response.json({ boom: true }, { status: 500 }));
    expect((await call()).status).toBe(502);
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it('refuses a transcript whose shape or interview does not match', async () => {
    fetchMock.mockResolvedValue(Response.json({ ...transcript, interviewId: '99999999-0000-4000-8000-000000000001' }));
    expect((await call()).status).toBe(502);
    fetchMock.mockResolvedValue(
      Response.json({ ...transcript, segments: [{ startSeconds: 1, speaker: 'Ana', text: 'x' }] }),
    );
    expect((await call()).status).toBe(502);
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it('maps an exhausted AI budget to 429 and any other AI failure to 503 without leaking it', async () => {
    analyzeMock.mockRejectedValueOnce(Object.assign(new Error('AI budget exceeded'), { code: 'TOO_MANY_REQUESTS' }));
    const budget = await call();
    expect(budget.status).toBe(429);
    expect(await budget.json()).toEqual({ code: 'ai_budget_exceeded' });
    analyzeMock.mockRejectedValueOnce(new Error('bedrock exploded with secrets'));
    const failed = await call();
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('secrets');
  });
});

describe('competency keys come from the same resolver the scorecard uses', () => {
  it('falls back to the four default competencies with localized labels', () => {
    expect(competenciesFor({ ...transcript, competencies: [], language: 'en' }).map((c) => c.label)).toEqual([
      'Leadership',
      'Analytical thinking',
      'Communication',
      'Problem solving',
    ]);
    expect(competenciesFor({ ...transcript, language: 'es', competencies: [{ name: 'SQL', level: null }] })).toEqual([
      { key: 'SQL', label: 'SQL' },
    ]);
  });
});
