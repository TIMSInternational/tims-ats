import type { EndpointDef } from '../surfaces';

export interface CheckResult {
  check: 'rls';
  endpoint: string;
  ok: boolean;
  detail?: string;
  /** Set when an `ok:true` RLS verdict is NOT a strong cross-tenant proof, in
   *  one of THREE cases: (1) Mode B's both-orgs-200-and-empty case (no cross-tenant
   *  data existed to compare); (2) a `globalScope` endpoint, where the payload
   *  is deliberately org-independent so there is no tenant isolation to prove; or
   *  (3) a `noTenantBoundaryForCaller` by-id endpoint, where the caller crosses no
   *  tenant boundary because its gate is principal TYPE rather than tenancy (#195,
   *  2026-08-11). Cases 2 and 3 carry DISTINCT detail strings on purpose — they are
   *  different dispositions and a report reader must be able to tell them apart.
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
 * True when `body` is a k-anonymity-SUPPRESSED payload (`{ ..., suppressed: true, ... }`).
 * By contract (see `DeiKernels.BuildDistribution`/`LeadershipDiversity`/`SuppressBelowMin5` and
 * their siblings across every k-anonymity domain in this codebase), `suppressed: true` ALWAYS
 * pairs with an empty/null group payload — the kernel wipes the real counts before returning,
 * so this shape can never carry real cross-tenant data regardless of which org asked. It is
 * `suppressed: true` is itself a real, non-empty scalar value, so `isDeepEmpty` doesn't treat this
 * shape as empty either — which is exactly what caused a false "possible global leak" flag on DEI's distribution
 * endpoints once small (<5-row) test-org fixtures triggered suppression identically for both
 * orgs — suppression working correctly, not a leak. This is the k-anonymity analog of Mode B's
 * existing "both orgs returned empty" inconclusive case, not a new isolation guarantee.
 */
function isSuppressedPayload(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as Record<string, unknown>).suppressed === true;
}

/**
 * RECURSIVELY empty — the emptiness test for the Mode-A isolation verdict (and its
 * positive control). Some by-id routes model a cross-tenant / not-found read as an
 * HTTP 200 with a null-SHAPED body (e.g. ninebox `/employee/{id}` returns
 * `{evaluation: null, history: []}` — structurally non-empty, semantically NO data)
 * rather than a 404 (which compensation/succession use). Mode B's identical-payload
 * comparison (below) reuses this SAME function — a shallow keys-only emptiness check
 * would misread a paginated list envelope like `{items: []}` as non-empty and flag a
 * false "possible global leak" (billing-invoices, 2026-07-28). `isDeepEmpty` treats
 * a value as empty when null/undefined/'', an array with no (deep-)non-empty elements,
 * or an object whose every own value is deep-empty. `0`/`false` are NOT empty (a real
 * scalar payload). A genuine leak (`{evaluation: {...org-B data...}}`) stays non-empty
 * and is still caught.
 */
function isDeepEmpty(body: unknown): boolean {
  if (body === null || body === undefined || body === '') return true;
  if (Array.isArray(body)) return body.every(isDeepEmpty);
  if (typeof body === 'object') return Object.values(body as Record<string, unknown>).every(isDeepEmpty);
  return false;
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
export function assertIsolated(
  response: IsolationResponse,
  opts: { emptyOk?: boolean } = {},
): Omit<CheckResult, 'endpoint'> {
  const { status, body } = response;

  // Isolation holds: 403 or 404 always mean access denied
  if (status === 403 || status === 404) {
    return { check: 'rls', ok: true };
  }

  // Isolation fails: 200 with a non-empty body means cross-tenant access succeeded
  if (status === 200 && !isDeepEmpty(body)) {
    return {
      check: 'rls',
      ok: false,
      detail: `cross-tenant isolation breach: org-A token reached org-B resource (status ${status}, body present)`,
    };
  }

  // 200 with a (recursively) empty body. For MOST by-id endpoints the correct
  // cross-tenant response is a 404, so a 200-empty is itself an anomaly (the route
  // did NOT deny access — it processed a cross-org id and returned an empty
  // projection = a possible missing-404 / existence oracle) → FAIL. Only when the
  // endpoint is documented to model not-found as a 200 null-SHAPE (opts.emptyOk,
  // e.g. ninebox `/employee/{id}`) is a 200-empty a genuine isolation-held result.
  if (status === 200 && isDeepEmpty(body)) {
    if (opts.emptyOk) return { check: 'rls', ok: true };
    return {
      check: 'rls',
      ok: false,
      detail:
        'cross-tenant probe returned HTTP 200 with an empty body where a 404 denial was expected — the endpoint processed a cross-org id instead of denying it (possible missing-404 / existence oracle). Set crossTenantEmptyOk on the endpoint only if a 200 null-shape is its documented not-found response.',
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
 * THREE modes. `globalScope` and `noTenantBoundaryForCaller` short-circuit first
 * (in that order); otherwise the mode is chosen by `ep.idScopeKey`:
 *
 * Mode C — no tenant boundary FOR THIS CALLER (`ep.noTenantBoundaryForCaller`):
 * a by-id endpoint served by a platform-owner gate (TS `platformProcedure` / C#
 * `PlatformOwnerGate`) over the UNSCOPED client. Reaching org B's row is the
 * FEATURE, so Mode A would assert the opposite of the requirement — and could
 * not run anyway, since `mintTokens` mints no org-B token for an org-less
 * platform owner (cli.ts), which would fail Mode A's positive control closed.
 * Reported as a documented N/A (`inconclusive` → `[WEAK]`) with its OWN reason
 * string, distinct from the globalScope one: that flag claims the PAYLOAD is
 * org-independent, which is false here. Parity and RBAC still run unchanged, and
 * on such a surface the RBAC denied-role 403 is the ENTIRE boundary proof.
 *
 * Mode A — by-id IDOR probe (`ep.idScopeKey` set): org-A's token attempts to
 * reach org-B's resource id on `ep.csharpPath`. Two calls:
 *   (1) isolation — org-A token → org-B id; verdict via `assertIsolated()`
 *       (org-A must get 403/404/empty, never org-B's data). A confirmed leak
 *       (200 + body) is FAIL immediately, no second call.
 *   (2) positive control — org-B token → the SAME org-B id: must be reachable
 *       (200 + non-empty). A denial in step (1) only proves isolation if the
 *       org-B id is actually LIVE; a non-existent id 404s for everyone and
 *       proves nothing. So when isolation holds but the positive control can't
 *       confirm the id is live (org-B itself doesn't get 200+data, or there's
 *       no `orgBToken`), this is a FAIL (fail-closed) — a strong IDOR proof that
 *       couldn't run is not a pass, so `verify`'s exit code / "passed" summary
 *       can never imply a cross-tenant test ran when it didn't. (Contrast the
 *       globalScope N/A and Mode-B both-empty cases below, which ARE acceptable
 *       `inconclusive` greens by design.)
 *
 * Isolation-denial mode per endpoint: MOST by-id reads deny cross-tenant with a
 * 404, so a 200-empty is itself an anomaly and FAILS; `ep.crossTenantEmptyOk`
 * opts the rare 200-null-shape endpoint (ninebox `/employee/{id}`) into treating
 * that shape as isolated (see `assertIsolated`).
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
export async function runRlsEndpoint(ep: EndpointDef, ctx: RlsContext, callCsharp: CallCsharp): Promise<CheckResult> {
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

  // noTenantBoundaryForCaller — Mode C. A BY-ID endpoint behind a PRINCIPAL-TYPE gate: reaching
  // another org's row is the product requirement, not a breach, so Mode A below would assert the
  // exact opposite of it (org-A's platform-owner token SHOULD get a 200 carrying org-B's body,
  // which `assertIsolated` correctly reads as a leak). Report a documented N/A with a reason of its
  // OWN — deliberately NOT the globalScope wording above, because this endpoint's payload IS
  // org-specific, and a report reader must not conflate "there is no per-org data here" with "there
  // is per-org data here and this caller may see all of it". Placed AFTER the globalScope branch so
  // that flag keeps its precedence (rls.test.ts pins that ordering), and BEFORE `idScopeKey` so the
  // Mode-A probe never runs.
  if (ep.noTenantBoundaryForCaller) {
    return {
      check: 'rls',
      endpoint: ep.name,
      ok: true,
      inconclusive: true,
      detail:
        'N/A: principal-type gate, not a tenant boundary — this caller reads any org by design, so a Mode-A IDOR probe would assert the opposite of the requirement. The payload IS org-specific (org-independence is NOT claimed). The boundary here is proved by the RBAC denied-role 403, not by RLS.',
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

    // (1) Isolation: org-A token → org-B id. A confirmed leak fails immediately.
    const isolation = await callCsharp(ctx.base, probePath, ctx.orgAToken);
    const verdict = assertIsolated(isolation, { emptyOk: ep.crossTenantEmptyOk });
    if (!verdict.ok) {
      return { check: 'rls', endpoint: ep.name, ok: false, detail: verdict.detail };
    }

    // (2) Positive control: prove the org-B id is actually LIVE for its own org, else
    // the isolation "pass" above could be a trivial not-found on a dead id — no real
    // IDOR test ran. A by-id endpoint's contract is a STRONG proof, so if the control
    // can't confirm the resource is live, that is a FAIL (fail-closed) — NOT a silent
    // green — so `verify`'s exit code + summary can't imply a strong test that never ran.
    if (!ctx.orgBToken) {
      return {
        check: 'rls',
        endpoint: ep.name,
        ok: false,
        detail:
          'rls: Mode-A by-id probe requires orgBToken for the positive control (cannot produce a strong IDOR proof without it)',
      };
    }
    const control = await callCsharp(ctx.base, probePath, ctx.orgBToken);
    if (control.status !== 200 || isDeepEmpty(control.body)) {
      return {
        check: 'rls',
        endpoint: ep.name,
        ok: false,
        detail: `rls: positive control FAILED — org-B could not itself reach the org-B resource (org-B token got status ${control.status}${isDeepEmpty(control.body) ? ' empty-body' : ''}), so a dead id would make org-A's denial trivial and no strong IDOR test ran. Check the org-B seed mirror (seedOrgBTier2Mirrors).`,
      };
    }

    // Strong: org-B reaches its own live resource (200 + data), and org-A is denied it.
    return { check: 'rls', endpoint: ep.name, ok: true };
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

  const bothNonEmpty = !isDeepEmpty(orgAResponse.body) && !isDeepEmpty(orgBResponse.body);
  const identical = JSON.stringify(orgAResponse.body) === JSON.stringify(orgBResponse.body);

  // Both k-anonymity-suppressed: identical is EXPECTED and safe (see isSuppressedPayload's doc
  // comment) — small/sparse per-org fixtures legitimately suppress to the same "no data" shape
  // for both orgs. Same category as the bothEmpty case below, just k-anonymity's version of it.
  if (bothNonEmpty && identical && isSuppressedPayload(orgAResponse.body) && isSuppressedPayload(orgBResponse.body)) {
    return {
      check: 'rls',
      endpoint: ep.name,
      ok: true,
      inconclusive: true,
      detail:
        'inconclusive: both orgs returned an identical k-anonymity-suppressed payload — structural pass only, no real cross-tenant demographic data was compared',
    };
  }

  if (bothNonEmpty && identical) {
    return {
      check: 'rls',
      endpoint: ep.name,
      ok: false,
      detail: 'cross-tenant: org-A and org-B received identical non-empty payloads (possible global leak)',
    };
  }

  const bothEmpty = isDeepEmpty(orgAResponse.body) && isDeepEmpty(orgBResponse.body);

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
