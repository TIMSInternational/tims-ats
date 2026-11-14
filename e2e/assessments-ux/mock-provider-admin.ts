import type { Page, Route } from '@playwright/test';

// Round 12: the platform owner's TIMS Assessments tools, seen through the C# Platform routes the web app calls (under
// the same-origin /api/platform relay), over a MOCKED provider. It keeps the state the real connector would: the
// binding (bound / in force), its tests and default language, the open sittings an unbind would strand (refused with
// 409 unless cancelOpenAttempts, then cancelled at the provider), and one candidate's DSAR export and erasure.

export const ORG = '0a000000-0000-4000-8000-000000000001';
export const CANDIDATE = 'ca000000-0000-4000-8000-0000000000aa';
const TENANT = '7e000000-0000-4000-8000-000000000001';

export class MockProviderAdmin {
  bound = false;
  active = false;
  instruments: string[] = [];
  defaultLocale = 'es';
  openSittings = 2;
  readonly binds: unknown[] = [];
  readonly unbinds: unknown[] = [];
  readonly cancelledAtProvider: number[] = [];
  readonly erasures: string[] = [];

  async install(page: Page): Promise<void> {
    await page.route('**/api/platform/**', (route) => this.handle(route));
  }

  private work() {
    return {
      cancellable: this.openSittings,
      awaitingResult: 0,
      pendingWithdrawals: 0,
      cancelPending: 0,
      createsInFlight: 0,
    };
  }

  private state() {
    return {
      bound: this.bound,
      active: this.active,
      providerTenantId: this.bound ? TENANT : null,
      enabledInstruments: this.bound ? this.instruments : [],
      defaultLocale: this.bound ? this.defaultLocale : null,
      updatedAt: this.bound ? '2026-11-09T15:00:00.000Z' : null,
      openWork: this.work(),
    };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/platform', '');
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const base = `/platform/assessment-providers/organizations/${ORG}`;

    if (path === `${base}/binding` && request.method() === 'GET') return json(200, this.state());

    if (path === '/platform/assessment-providers/bindings' && request.method() === 'POST') {
      const body = request.postDataJSON() as { organizationId: string; instruments: string[]; defaultLocale: string };
      this.binds.push(body);
      if (body.organizationId !== ORG) return json(404, { message: 'Organización no encontrada' });
      Object.assign(this, {
        bound: true,
        active: true,
        instruments: body.instruments,
        defaultLocale: body.defaultLocale,
      });
      return json(200, {
        organizationId: ORG,
        providerTenantId: TENANT,
        enabledInstruments: body.instruments,
        defaultLocale: body.defaultLocale,
      });
    }

    if (path === `${base}/binding/unbind` && request.method() === 'POST') {
      const body = (request.postDataJSON() ?? {}) as { cancelOpenAttempts?: boolean };
      this.unbinds.push(body);
      if (!this.active) return json(404, { error: 'not_bound' });
      let cancelled = 0;
      if (body.cancelOpenAttempts) {
        cancelled = this.openSittings;
        this.cancelledAtProvider.push(cancelled);
        this.openSittings = 0;
      }
      if (this.openSittings > 0) {
        return json(409, { error: 'binding_has_open_work', openWork: this.work(), cancelled, cancelFailed: 0 });
      }
      this.active = false;
      return json(200, { unbound: true, openWork: this.work(), cancelled, cancelFailed: 0 });
    }

    if (path === `${base}/candidates/${CANDIDATE}/export` && request.method() === 'GET') {
      return json(200, {
        attempts: [{ attemptId: 'e0000000-0000-4000-8000-000000000001', instrument: 'lia', state: 'result_ready' }],
        results: [],
        providerExports: [
          { subjectId: '5b000000-0000-4000-8000-000000000001', status: 'exported', export: { consents: [] } },
        ],
      });
    }

    if (path === `${base}/candidates/${CANDIDATE}/erasure` && request.method() === 'POST') {
      this.erasures.push(CANDIDATE);
      return json(202, { subjects: 1, requested: 1 });
    }

    return json(404, { message: `mock: no route for ${request.method()} ${path}` });
  }
}
