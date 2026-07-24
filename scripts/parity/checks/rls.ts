import type { EndpointDef } from '../surfaces';

export interface CheckResult {
  check: 'rls';
  endpoint: string;
  ok: boolean;
  detail?: string;
  /** Set when an `ok:true` RLS verdict is NOT a strong cross-tenant proof, in
   *  one of two cases: (1) Mode B's both-orgs-200-and-empty case (no cross-tenant
   *  data existed to compare); or (2) a `globalScope` endpoint, where the payload
   *  is deliberately org-independent so there is no tenant isolation to prove.
   *  Never set alongside `ok:false`. `report.ts` renders this distinctly (`[WEAK]`)
   *  so report-green doesn't silently imply a real comparison happened. */
  inconclusive?: boolean;
}

export interface IsolationResponse {
  status: number;
  body: unknown;
}

/** C# live caller shape, matching `callCsharp` in scripts/parity/callers.ts exactly:
 * a plain GET against `${base}${path}` with `Authorization: Bearer <token>`. */
export type CallCsharp = (base: string, path: string, token: string) => Promise<IsolationResponse>;

export interface RlsContext {
  base: string;
  orgAToken: string;
  orgBToken?: string;
  orgBResourceId?: string;
}

/**
 * Body-emptiness check shared by `assertIsolated` and `runRlsEndpoint`'s Mode B
 * (identical-payload) comparison. Empty = null, undefined, empty string, or an
 * object with no own keys. Deliberately does NOT treat `0`/`false` as empty —
 * those never appear as a bare REST JSON body here.
 */
function isEmpty(body: unknown): boolean {
  return (
    body === null ||
    body === undefined ||
    body === '' ||
    (typeof body === 'object' && Object.keys(body).length === 0)
  );
}

/**
 * Pure verdict function: determines if cross-tenant isolation held.
 *
 * Isolation HOLDS (ok:true) when:
 * - Status is 403 (Forbidden) or 404 (Not Found) — definitive access denial
 * - Status is 200 AND body is empty — no data leaked to cross-tenant access
 *
 * Isolation FAILS (ok:false) when:
 * - Status is 200 with a non-empty body (data leaked to cross-tenant access)
 * - Any other status (e.g., 500) — FAIL CLOSED: cannot confirm isolation held
 */
export function assertIsolated(response: IsolationResponse): Omit<CheckResult, 'endpoint'> {
  const { status, body } = response;

  // Isolation holds: 403 or 404 always mean access denied
  if (status === 403 || status === 404) {
    return { check: 'rls', ok: true };
  }

  // Isolation holds: 200 status with empty body means no data leaked
  if (status === 200 && isEmpty(body)) {
    return { check: 'rls', ok: true };
  }

  // Isolation fails: 200 with non-empty body means cross-tenant access succeeded
  if (status === 200 && !isEmpty(body)) {
    return {
      check: 'rls',
      ok: false,
      detail: `cross-tenant isolation breach: org-A token reached org-B resource (status ${status}, body present)`,
    };
  }

  // FAIL CLOSED: any other status (e.g., 500, 400, etc.) is treated as NOT ok
  // because we cannot definitively confirm isolation held.
  // This includes error statuses with empty bodies.
  return {
    check: 'rls',
    ok: false,
    detail: `cannot confirm isolation: unexpected status ${status} (expected 200, 403, or 404)`,
  };
}

/**
 * Substitute org-B's resource id into a C# by-id route for the Mode A IDOR probe.
 * `ep.csharpPath` routes look like `/team-intel/teams/{teamId}/profile` — the
 * `{...}` path-segment placeholder (whatever its name) is replaced with
 * `orgBResourceId`. If the path has no `{...}` placeholder, the id is appended
 * as a trailing segment (`${csharpPath}/${orgBResourceId}`).
 */
function buildProbePath(csharpPath: string, orgBResourceId: string): string {
  if (/\{[^}]+\}/.test(csharpPath)) {
    return csharpPath.replace(/\{[^}]+\}/, encodeURIComponent(orgBResourceId));
  }
  return `${csharpPath}/${encodeURIComponent(orgBResourceId)}`;
}

/**
 * Live RLS check: makes a cross-tenant probe call via C# through the real
 * `callCsharp(base, path, token)` caller (scripts/parity/callers.ts).
 *
 * Two modes, chosen by `ep.idScopeKey`:
 *
 * Mode A — by-id IDOR probe (`ep.idScopeKey` set): org-A's token attempts to
 * reach org-B's resource id on `ep.csharpPath`. Isolation verdict is delegated
 * to `assertIsolated()` — this is the strong isolation proof (org-A must get
 * 403/404/empty, never org-B's data).
 *
 * Mode B — org-scoped endpoint (`ep.idScopeKey` NOT set, e.g. dashboard-kpis):
 * the endpoint takes no resource id — it's implicitly scoped to the resolved
 * principal's org via RLS, so there is no cross-org URL to probe. This is a
 * weaker STRUCTURAL check, not the strong isolation proof: call the endpoint
 * with both org-A's and org-B's own tokens and require they don't come back
 * both-200 with an identical non-empty payload (a possible global/unscoped
 * leak). Both-empty is explicitly NOT a failure — freshly-seeded test orgs
 * may legitimately both have zero KPIs — but it's also not a real comparison:
 * no cross-tenant data existed to prove isolation held, so that case comes
 * back `ok:true, inconclusive:true` rather than a plain pass, so report-green
 * doesn't silently imply a leak-check actually ran. This check only
 * strengthens once distinguishing per-org data exists. The real isolation
 * guarantee for org-scoped resources still comes from a Mode A probe on their
 * by-id sibling endpoints, where one exists.
 */
export async function runRlsEndpoint(
  ep: EndpointDef,
  ctx: RlsContext,
  callCsharp: CallCsharp,
): Promise<CheckResult> {
  // globalScope — a non-tenant endpoint (e.g. /billing/config): its payload is
  // org-independent by design, so identical cross-org responses are CORRECT, not
  // a leak. There is no tenant isolation to prove here, so report a documented
  // N/A (inconclusive → [WEAK]) rather than running Mode B, whose identical-
  // non-empty heuristic would otherwise false-FAIL a legitimately global read.
  if (ep.globalScope) {
    return {
      check: 'rls',
      endpoint: ep.name,
      ok: true,
      inconclusive: true,
      detail: 'N/A: globalScope (non-tenant) endpoint — no cross-tenant isolation to prove',
    };
  }

  if (ep.idScopeKey) {
    // Mode A — by-id IDOR probe
    if (!ctx.orgBResourceId) {
      return {
        check: 'rls',
        endpoint: ep.name,
        ok: false,
        detail: 'rls: idScopeKey set but no orgBResourceId provided',
      };
    }

    const probePath = buildProbePath(ep.csharpPath, ctx.orgBResourceId);
    const response = await callCsharp(ctx.base, probePath, ctx.orgAToken);
    const verdict = assertIsolated(response);

    return {
      check: 'rls',
      endpoint: ep.name,
      ok: verdict.ok,
      detail: verdict.detail,
    };
  }

  // Mode B — org-scoped endpoint (no resource id to probe)
  if (!ctx.orgBToken) {
    return {
      check: 'rls',
      endpoint: ep.name,
      ok: false,
      detail: 'rls: org-scoped check needs orgBToken',
    };
  }

  const [orgAResponse, orgBResponse] = await Promise.all([
    callCsharp(ctx.base, ep.csharpPath, ctx.orgAToken),
    callCsharp(ctx.base, ep.csharpPath, ctx.orgBToken),
  ]);

  // FAIL CLOSED: cannot confirm isolation unless both calls succeeded.
  if (orgAResponse.status !== 200 || orgBResponse.status !== 200) {
    return {
      check: 'rls',
      endpoint: ep.name,
      ok: false,
      detail: `cannot confirm isolation: org-A status ${orgAResponse.status}, org-B status ${orgBResponse.status} (expected both 200)`,
    };
  }

  const bothNonEmpty = !isEmpty(orgAResponse.body) && !isEmpty(orgBResponse.body);
  const identical = JSON.stringify(orgAResponse.body) === JSON.stringify(orgBResponse.body);

  if (bothNonEmpty && identical) {
    return {
      check: 'rls',
      endpoint: ep.name,
      ok: false,
      detail: 'cross-tenant: org-A and org-B received identical non-empty payloads (possible global leak)',
    };
  }

  const bothEmpty = isEmpty(orgAResponse.body) && isEmpty(orgBResponse.body);

  if (bothEmpty) {
    // Structural pass only: no cross-tenant data existed to compare, so this
    // is not the strong isolation proof — flag it as `inconclusive` rather
    // than a plain `ok:true` (see the CheckResult.inconclusive doc comment).
    return {
      check: 'rls',
      endpoint: ep.name,
      ok: true,
      inconclusive: true,
      detail:
        'inconclusive: both orgs returned empty payloads — structural pass only, no cross-tenant data was compared',
    };
  }

  // Both 200 with differing (non-identical) bodies: a real comparison ran and
  // found no leak signal — strong pass.
  return { check: 'rls', endpoint: ep.name, ok: true };
}
