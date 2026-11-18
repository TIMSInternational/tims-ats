import type { Page, Route } from '@playwright/test';

// A mocked TIMS Assessments provider, seen through the C# Platform routes the web app calls (all under the
// same-origin /api/platform relay). It keeps the state the real connector would: the vacancy's assessments[] with
// its version token (a conditional write), the provider catalog, the attempts an assignment creates (pinned to one
// version per vacancy and instrument), and the results the provider publishes. Audience "team_leader" makes the
// attempts read apply owner default D6 the way the C# route does: no level, only whether the minimum is met.

export const VACANCY = '7ac00000-0000-4000-8000-000000000001';
export const CANDIDATE = 'ca000000-0000-4000-8000-000000000001';

type Minimum = { globalPercentile: number | null; cefr: string | null; level: number | null; score: number | null };
interface Requirement {
  instrument: string;
  use: string;
  min: Minimum | null;
  weight: number | null;
  reason: string | null;
}
interface Result {
  validity: 'valid' | 'needs_review' | 'voided';
  globalPercentile: number | null;
  cefr: string | null;
}
interface Attempt {
  attemptId: string;
  instrument: string;
  status: string;
  instrumentVersion: string;
  missingConsents: string[];
  result: Result | null;
}

const CATALOG = [
  { instrument: 'lia', version: '1.0' },
  { instrument: 'english', version: '2.1' },
  { instrument: 'personality', version: '1.0' },
];
const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export class MockAssessmentsProvider {
  requirements: Requirement[] = [];
  version = 0;
  attempts: Attempt[] = [];
  audience: 'hr' | 'team_leader' = 'hr';
  readonly puts: unknown[] = [];
  readonly assigns: unknown[] = [];

  async install(page: Page): Promise<void> {
    await page.route('**/api/platform/**', (route) => this.handle(route));
  }

  /** Someone else saves the vacancy's tests (another HR session). */
  saveElsewhere(requirements: Requirement[]): void {
    this.requirements = requirements;
    this.version++;
  }

  /** The provider publishes a result for the candidate's attempt of one instrument. */
  publish(instrument: string, result: Result): void {
    const attempt = this.attempts.find((a) => a.instrument === instrument)!;
    attempt.result = result;
    attempt.missingConsents = [];
    attempt.status = result.validity === 'valid' ? 'result_ready' : 'needs_review';
  }

  private versionToken(): string {
    return this.version.toString(16).padStart(32, '0');
  }

  private view() {
    return { assessments: this.requirements, version: this.versionToken(), issues: [] };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/platform', '');
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === `/fit-engine/vacancies/${VACANCY}/requirements/assessments`) {
      if (request.method() === 'GET') return json(200, this.view());
      const body = request.postDataJSON() as { assessments: Requirement[]; expectedVersion: string };
      this.puts.push(body);
      if (body.expectedVersion !== this.versionToken())
        return json(409, { error: 'requirements_changed', current: this.view() });
      this.requirements = body.assessments.map((a) => ({
        instrument: a.instrument,
        use: a.use,
        // The body carries only the minimum's own key; the C# response spells out all four.
        min: a.min
          ? { globalPercentile: null, cefr: null, level: null, score: null, ...(a.min as Partial<Minimum>) }
          : null,
        weight: a.weight ?? null,
        reason: a.reason,
      }));
      this.version++;
      return json(200, this.view());
    }

    if (path === '/assessments/provider-catalog') {
      return json(200, {
        connected: true,
        instruments: CATALOG.map(({ instrument, version }) => ({
          instrument,
          delivery: 'native',
          locales: ['es', 'en'],
          requiredConsents: ['assessment'],
          versions: [{ instrumentVersion: version, status: 'ga' }],
          pinnedVersion: this.attempts.find((a) => a.instrument === instrument)?.instrumentVersion ?? null,
        })),
      });
    }

    if (path === '/assessments/provider-assignments' && request.method() === 'POST') {
      const body = request.postDataJSON() as { instruments: { instrument: string }[]; ageBand?: string };
      this.assigns.push(body);
      const listed = new Set(this.requirements.map((r) => r.instrument));
      const refused = body.instruments.find((i) => !listed.has(i.instrument));
      if (!body.ageBand) return json(400, { error: 'invalid_input' });
      if (refused) return json(422, { error: 'instrument_not_listed_by_vacancy', instrument: refused.instrument });
      const items = body.instruments.map(({ instrument }) => {
        const attempt: Attempt = {
          attemptId: crypto.randomUUID(),
          instrument,
          status: 'consent_needed',
          instrumentVersion: CATALOG.find((c) => c.instrument === instrument)!.version,
          missingConsents: ['assessment'],
          result: null,
        };
        this.attempts.push(attempt);
        return {
          attemptId: attempt.attemptId,
          instrument,
          state: 'created',
          instrumentVersion: attempt.instrumentVersion,
          requiredConsents: ['assessment'],
          expiresAt: '2026-11-30T12:00:00.000Z',
          error: null,
          locale: 'es',
          timeMultiplier: 1,
          aids: [],
        };
      });
      return json(200, { complete: true, items });
    }

    if (path === '/assessments/provider-attempts' && url.searchParams.get('candidateId') === CANDIDATE) {
      return json(200, { consentWithdrawn: false, attempts: this.attempts.map((a) => this.attemptView(a)) });
    }

    return json(404, { message: `mock: no route for ${request.method()} ${path}` });
  }

  private attemptView(attempt: Attempt) {
    const requirement = this.requirements.find((r) => r.instrument === attempt.instrument) ?? null;
    const hr = this.audience === 'hr';
    const result = attempt.result;
    const valid = result?.validity === 'valid';
    let minimum: string | null = null;
    if (result && requirement?.min) {
      if (!valid) minimum = 'unknown';
      else if (requirement.min.globalPercentile !== null)
        minimum = (result.globalPercentile ?? -1) >= requirement.min.globalPercentile ? 'met' : 'not_met';
      else if (requirement.min.cefr !== null)
        minimum = CEFR.indexOf(result.cefr ?? '') >= CEFR.indexOf(requirement.min.cefr) ? 'met' : 'not_met';
    }
    const countsIn = !requirement
      ? 'not_listed'
      : requirement.use === 'advisory'
        ? 'advisory'
        : attempt.instrument === 'english'
          ? 'languages'
          : attempt.instrument === 'lia' || requirement.use === 'gate'
            ? 'gate'
            : 'assessment';
    return {
      attemptId: attempt.attemptId,
      vacancyId: VACANCY,
      instrument: attempt.instrument,
      status: attempt.status,
      instrumentVersion: attempt.instrumentVersion,
      missingConsents: attempt.status === 'consent_needed' ? attempt.missingConsents : [],
      expiresAt: '2026-11-30T12:00:00.000Z',
      createdAt: '2026-11-09T12:00:00.000Z',
      completedAt: result ? '2026-11-09T13:00:00.000Z' : null,
      lastErrorCode: null,
      timeMultiplier: hr ? 1 : null,
      aids: hr ? [] : null,
      countsIn,
      result: result && {
        validity: result.validity,
        validityReasons: hr ? (valid ? [] : ['proctoring_flag']) : null,
        requiresHumanReview: false,
        reviewPending: !valid,
        minimum,
        globalPercentile: hr ? result.globalPercentile : null,
        cefr: hr ? result.cefr : null,
        level: null,
        instrumentVersion: attempt.instrumentVersion,
        normVersion: 'norm-1',
        completedAt: '2026-11-09T13:00:00.000Z',
      },
    };
  }
}
