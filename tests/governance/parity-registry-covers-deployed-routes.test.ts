import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SURFACES } from '../../scripts/parity/surfaces';
import { WRITE_SURFACES, type WriteResolvedBase } from '../../scripts/parity/write-surfaces';

/**
 * DEPLOYED ROUTE ↔ PARITY REGISTRY COVERAGE GUARD (#195).
 *
 * The parity harness (scripts/parity/) is the only automated thing that probes the LIVE C# service
 * for cross-tenant isolation (checks/rls.ts) and permission denials (checks/rbac.ts). It can probe
 * nothing that SURFACES + WRITE_SURFACES do not register — and nothing measured how much of the
 * deployed service that is. Re-measured 2026-08-18: 92 registered endpoints against 157 deployed
 * operations, leaving a gap of 65. (The numeric PINS below were updated when slice 23 landed; update
 * both this prose and the pins, or neither is trustworthy — slice 22 updated only the pins and this
 * line read 50/135/gap-85 for a commit, and slice 23's SECOND PR repeated the mistake: it moved the
 * pins to 147/63 and left every figure in this header at the pre-PR numbers. Slice 23's THIRD PR
 * updated both, as did its final read. The 2026-08-17 change — #195's residual, re-registering the
 * four deleted talent read surfaces C#-only — moved 67→92 / 84→59: 27 routes left the allowlist as
 * 25 registered endpoints plus the two team-intel 501 stubs, which moved to their OWN allowlist
 * group rather than the registry, for the reason that group states. The 2026-08-18 change is the
 * first to GROW these numbers rather than shrink them: slice 24 / #90 deployed six fit-engine routes
 * DARK with no registry entry — 151→157 deployed, 59→65 allowlisted, 92 registered UNCHANGED — which
 * is the documented-growth path a new dark slice is supposed to take, not drift.)
 *
 * THIS GUARD MEASURES REGISTRATION, NOT PROBE COVERAGE, and the two are not the same number, and as
 * of 2026-08-15 there is a THIRD number: registration does not imply a PAYLOAD DIFF either, since an
 * endpoint may be registered C#-only (no `tsProcedure`) and report [WEAK]. THIRTY-NINE of the 65
 * reads are, across nine surfaces — dashboard's 3 FX reads (see surfaces.ts caveat 8), nine-box 4,
 * access-review 3, audit-log 2, dei 2, and the four talent surfaces re-registered on 2026-08-17
 * (team-intel 5, reporting 6, succession 9, evaluation360 5) — all but the FX trio being surfaces
 * whose TypeScript side was deleted outright.
 * (This line read "three" when the dashboard entries landed: a count written in prose beside a list that
 * lives elsewhere, which is the failure mode this file's own header warns about. Dashboard's
 * ai-cost-anomalies read, by contrast, carries a real `tsProcedure` — no FX provider is involved — so
 * it did NOT move this count.) Of the
 * 65 READ registrations, TWENTY-SIX issue no cross-tenant probe at all: 25 carry `globalScope` and 1
 * carries `noTenantBoundaryForCaller`, and checks/rls.ts returns `inconclusive` for both without calling
 * anything. Those are correct dispositions — a platform-owner cross-org read has no tenant boundary
 * to prove — but it means a route can move from the allowlist into the "covered" set without gaining
 * a Mode-A probe. The organization/detail registration was one worked example: `GET
 * /platform/organizations/{id}` left allowlist group 3 and the gap pin dropped 86 → 85, which reads
 * as progress, while that route's RLS disposition went from "unprobed" to "unprobed, documented".
 * (The 25 reads registered on 2026-08-17 are NOT of that kind: every one runs a real RLS mode — 17
 * Mode B, 8 Mode A — though surfaces.ts's team-intel caveat 1 names one Mode B that is vacuous by
 * fixture design.) Read the headline numbers as "registered and therefore visible to the harness",
 * never as "probed for cross-tenant isolation".
 *
 * WHAT THIS GUARD DOES AND DOES NOT DO. It does NOT register the gap — that is out of scope and must
 * not be attempted here: each org-scoped surface needs its own SEEDED GRANT FIXTURE before it can be
 * registered, and a missing grant produces #166's false FAIL (12 of 43 endpoints red for a fixture
 * reason, not a product reason). What it does is make the gap VISIBLE and stop it growing silently:
 * every deployed route must either be registered or appear on UNREGISTERED_ALLOWLIST under a group
 * with a written reason, so a NEWLY deployed route has to be added deliberately.
 *
 * SOURCE OF TRUTH: contracts/openapi/Tims.Api.json, NOT the *Endpoints.cs files. This is a real
 * decision, for four reasons:
 *   1. A .cs regex cannot resolve 8 of the 133 `.Map{Get,Post,Patch,Put,Delete}(` call sites. Six
 *      PlatformOrganizations* registrations put the route literal on the line AFTER the `app.Map*(`;
 *      AlertMetricsEndpoints.cs:47 maps a `const RoutePath` (declared :43);
 *      Evaluation360WriteEndpoints.cs:172 interpolates `{verb}` into the template and is itself
 *      invoked three times, so 133 call sites are not 133 routes either. Even a next-line-aware
 *      parser both under- and over-reports.
 *   2. The OpenAPI document resolves all of them — it is emitted by the framework from the mapped
 *      routes themselves, so it cannot disagree with what is mapped. What IS reproducible from this
 *      repo is the arithmetic: `grep -rEo '\.Map(Get|Post|Patch|Put|Delete)\(' services/Tims.Platform
 *      /src/Tims.Api --include='*.cs' | wc -l` = 155 call sites (re-run 2026-08-18), minus the 1 inside
 *      the private `MapTransition` helper (Evaluation360WriteEndpoints.cs:169, mapping at :172), plus
 *      its 3 invocations (Evaluation360WriteEndpoints.cs:78/:80/:82) = 157, which is
 *      the operation count this file parses and pins. An earlier version of this line claimed the two
 *      sets had "ZERO symmetric difference" as measured by a one-off script; that script was never
 *      committed, so the claim was not reproducible and is not restated.
 *   3. DARK endpoints are included BY DESIGN. Program.cs:937 computes `isOpenApiDocGeneration` and
 *      every mapping guard is `if (flag || isOpenApiDocGeneration)`, so the document is a
 *      flag-independent inventory — the only source describing routes a deployment will serve AFTER
 *      a flip, which is precisely when an unregistered route becomes dangerous.
 *   4. CI already guarantees freshness: .github/workflows/dotnet-platform.yml:60 builds `-c Release`
 *      (Tims.Api.csproj:9-11 wires OpenApiGenerateDocumentsOnBuild) and :66 runs
 *      `git diff --exit-code contracts/openapi/`. A new route cannot merge without updating this
 *      file — exactly the trigger this guard needs.
 *
 * CAVEAT, stated rather than implied: `/health` and `/ready` (Program.cs:892, :899) are ABSENT from
 * the document — MapHealthChecks emits no endpoint metadata. So this guard covers 157 domain
 * OPERATIONS, never "every routable path".
 */

const ROOT = join(__dirname, '..', '..');
const OPENAPI = join(ROOT, 'contracts/openapi/Tims.Api.json');

const HTTP_VERBS = ['get', 'post', 'patch', 'put', 'delete'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * VERB + path, per-SEGMENT tokenisation. Applied IDENTICALLY to all three sides (deployed, registry,
 * allowlist), because a normalisation applied to only one side is a silent false match. Each rule has
 * a reason:
 *
 *  1. Truncate at the first `?`. Thirteen of the 65 read registry entries carry a query string
 *     (`/monitoring/alerts?page=1&limit=20`, the three access-review `?organizationId=…` routes,
 *     the three `?period=30D` reporting reads, team-intel's compare, …);
 *     no OpenAPI path and no .cs route template ever does.
 *  2. Split on '/', and replace a WHOLE segment with `{*}` when it is a `{…}` placeholder or a bare
 *     UUID. Both sides need it: param NAMES differ (the registry writes `/compensation/employee/{id}`
 *     where the deployed template says `{userId}`), and the write builders interpolate REAL module
 *     constants (e.g. `e0000361-…`) plus the resolver stub's sentinel, so a concrete UUID appears
 *     where the deployed side has a template.
 *  3. Compare the joined string with EXACT equality — never a `.+` regex.
 *     `GET /platform/organizations/kpis` (a literal, registered) and
 *     `GET /platform/organizations/{id}` (a template) are BOTH live routes; a loose wildcard would
 *     let the registered literal satisfy the unregistered by-id route. `kpis !== {*}` keeps them apart.
 *  4. Key on VERB + path, NEVER path alone. Seven OpenAPI paths carry two verbs, so a verb-blind key
 *     would falsely mark FIVE currently-unregistered routes covered: POST /platform/organizations,
 *     GET /evaluation360/cycles, GET /succession/critical-roles, GET /ninebox/calibrations and
 *     GET /engagement/action-plans. It was SIX until 2026-08-11: GET /platform/organizations/{id} was
 *     unregistered while PATCH on that same path was registered (the organization write surface's
 *     `update`), so a verb-blind key excused a read that had never been probed with the write that
 *     had — the exact shape of failure this rule exists to prevent.
 *  5. Upper-case the verb and strip a trailing '/'. Neither varies today; normalise anyway so a future
 *     `.MapGet("/billing/plan/")` cannot slip past as a "new" route.
 */
function routeKey(verb: string, path: string): string {
  let p = path.split('?')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const segments = p
    .split('/')
    .map((s) => (/^\{[^}]*\}$/.test(s) || UUID_RE.test(s) ? '{*}' : s))
    .join('/');
  return `${verb.toUpperCase()} ${segments}`;
}

// ── The deployed side ────────────────────────────────────────────────────────────────────────────
interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
}
const doc = JSON.parse(readFileSync(OPENAPI, 'utf8')) as OpenApiDoc;
const deployed = new Set<string>();
/** Raw operations PARSED, counted before the Set dedupes anything. `deployed.size` alone cannot
 *  distinguish "no new route" from "a new route collapsed onto an existing key": `routeKey` maps a
 *  bare UUID segment to `{*}`, so a future literal-id diagnostic (say
 *  `GET /platform/organizations/00000000-…`) would normalise onto the already-registered
 *  `GET /platform/organizations/{*}`, be counted as covered, and leave the 151 pin unmoved. Asserting
 *  these two are EQUAL proves the normaliser is injective over the deployed set, which is the
 *  property every count below silently assumes. */
let deployedOperations = 0;
/** The document's own spelling of each key, so a failure message names the real route. */
const deployedRaw = new Map<string, string>();
for (const [path, item] of Object.entries(doc.paths ?? {})) {
  for (const method of Object.keys(item)) {
    if (!(HTTP_VERBS as readonly string[]).includes(method.toLowerCase())) continue;
    deployedOperations++;
    const key = routeKey(method, path);
    deployed.add(key);
    deployedRaw.set(key, `${method.toUpperCase()} ${path}`);
  }
}

// ── The registry side ────────────────────────────────────────────────────────────────────────────
// Read endpoints carry a static `csharpPath` and are all GET (checks/parity.ts + checks/rls.ts issue
// a plain GET; SURFACES has no method field precisely because a read surface is GET-only).
const registry = new Set<string>();
let registryEndpointCount = 0;
for (const surface of Object.values(SURFACES)) {
  for (const ep of surface.endpoints) {
    registryEndpointCount++;
    registry.add(routeKey('GET', ep.csharpPath));
  }
}

/**
 * 41% of the registry (27 of the 66 endpoints — the write side) has NO static path: `buildParity` is a function of the
 * resolved seeded ids. Rather than add a hand-written `routeTemplate` field — 26 strings that can
 * drift from the builder they duplicate — call every builder with a recursive Proxy stub that answers
 * any property access with another stub and coerces to a fixed UUID sentinel. write-surfaces.test.ts
 * already stubs these builders with a plain literal bag, so this is the registry's own idiom, just
 * total instead of per-surface. Measured: 27 of 27 resolve, zero throws, zero degenerate paths.
 */
const PROXY_UUID = '00000000-0000-0000-0000-0000000000ff';
function resolverStub(): WriteResolvedBase {
  const target = function stubTarget() {} as unknown as object;
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => PROXY_UUID;
      if (prop === 'toString' || prop === 'valueOf' || prop === 'toJSON') return () => PROXY_UUID;
      if (prop === Symbol.toStringTag) return 'writeResolverStub';
      // A Proxy that answers `then` with a stub makes itself thenable and would hang an `await`.
      if (prop === 'then') return undefined;
      return resolverStub();
    },
    apply() {
      return resolverStub();
    },
  };
  return new Proxy(target, handler) as unknown as WriteResolvedBase;
}

const writePaths: string[] = [];
const degenerateWritePaths: string[] = [];
for (const [surfaceKey, surface] of Object.entries(WRITE_SURFACES)) {
  for (const ep of surface.endpoints) {
    registryEndpointCount++;
    let path: string;
    try {
      path = ep.buildParity(resolverStub()).path;
    } catch (err) {
      degenerateWritePaths.push(`${surfaceKey}/${ep.name}: buildParity THREW (${String(err)})`);
      continue;
    }
    if (typeof path !== 'string' || !path.startsWith('/') || /undefined|\[object|NaN|\/\//.test(path)) {
      degenerateWritePaths.push(`${surfaceKey}/${ep.name}: buildParity produced a degenerate path "${String(path)}"`);
      continue;
    }
    writePaths.push(path);
    registry.add(routeKey(ep.method, path));
  }
}

// ── The allowlist ────────────────────────────────────────────────────────────────────────────────
interface AllowGroup {
  reason: string;
  routes: string[];
}

/**
 * Groups, each with ONE reason covering every route in it, and EXACT literal VERB+path entries using
 * the OpenAPI document's own param names. Deliberately not prefixes: a `/engagement/*` prefix group
 * would let a brand-new engagement route land silently, which is the exact drift this file exists to
 * stop.
 */
const UNREGISTERED_ALLOWLIST: AllowGroup[] = [
  {
    reason:
      'INFRA / DIAGNOSTIC, not a domain surface. `/` and the two whoami routes are liveness and identity echoes; ' +
      '/require-permission and /require-org-scope (Program.cs:1225, :1265) are the permission-kernel probes the C# ' +
      'auth integration tests drive. None reads tenant data, so none carries a parity, RLS or RBAC obligation.',
    routes: [
      'GET /',
      'GET /whoami',
      'GET /external-whoami',
      'GET /require-permission/{module}/{action}',
      'GET /require-org-scope/{module}/{action}',
    ],
  },
  {
    reason:
      'SURFACE WAS REGISTERED AND THEN DELETED, on the reasoning "the TS procedures are gone, so there is nothing ' +
      'left to diff" — obsolete since `tsProcedure` became OPTIONAL on 2026-08-06 (efb7553f). This group held the ' +
      "six `parity_command=NONE` cutover.sh surfaces until 2026-08-17, when #195's residual re-registered FOUR of " +
      'them C#-only (succession, team-intel, reporting, evaluation360 — 27 routes left this list: 25 registered, ' +
      'and the two team-intel 501 stubs moved to their own group below). What remains is billing-read + ' +
      'billing-usage. Re-registering those two the same way is the fix and is tracked in #195 — their fixture ' +
      '(seedBillingSubscription) already exists, but their role expectations must be probed rather than guessed, ' +
      "since a wrong one reproduces #166's false 12/43 FAIL, which is worse than a documented gap. " +
      'cutover.sh + README rows for the four re-registered surfaces were flipped NONE→verify in the same PR.',
    routes: [
      'GET /billing/usage',
      'GET /billing/plan',
      'GET /billing/config',
      'GET /billing/invoices',
      'GET /billing/invoices/{id}',
    ],
  },
  {
    reason:
      'SLICE LANDED DARK 2026-08-18 (Phase-5 slice 24 / #90, fit-engine backend) — five of the six deployed ' +
      'routes are registrable, but registration is NOT a registry edit: fit_engine grants do not exist in the ' +
      'parity seed yet (seedFitEngineGrants — copy scopes from seed-access-matrix.ts: hr_admin/recruiter@org, ' +
      'hrbp@unit, leader@team), the ranking/simulate reads need seeded fit_scores rows on a parity vacancy or ' +
      'they compare empty-vs-empty (the vacuous-PASS shape), and computeForVacancy MUTATES fit_scores, so its ' +
      'write-surface fixture needs a dedicated vacancy that no read expectation depends on. Doing that ' +
      'fixture-first registration is #195-pattern work, tracked on #90 (step 5 is unrunnable by anyone until ' +
      'then). The sixth route, explain-fit, is in the 501-stub group below.',
    routes: [
      'GET /fit-engine/vacancies/{vacancyId}/ranking',
      'GET /fit-engine/vacancies/{vacancyId}/simulate-weights',
      'GET /fit-engine/weight-profiles',
      'POST /fit-engine/weight-profiles',
      'POST /fit-engine/vacancies/{vacancyId}/compute',
    ],
  },
  {
    reason:
      'DEPLOYED HONEST 501 STUB — explainFit (FitEngineReadEndpoints.cs: gate → vacancy IDOR probe → score ' +
      'fetch, null ⇒ the TS 404 → 501). The narrative half needs the TS-only invokeAgent Bedrock pipeline, so ' +
      'NO caller receives a 200 and the harness contract cannot express it (expectedByRole admits only 200|403; ' +
      'checks/parity.ts fails a C#-only endpoint on any non-200) — the same inexpressibility as the team-intel ' +
      'stubs in the group below. Its gate→probe→fetch→501 ordering is pinned by FitEngineReadEndpointAuthTests. ' +
      'If a C# AI plane ever ships and this answers 200, register it as a by-id endpoint on the fit-engine ' +
      'surface and delete this group.',
    routes: ['GET /fit-engine/vacancies/{vacancyId}/candidates/{candidateId}/explain-fit'],
  },
  {
    reason:
      'DEPLOYED HONEST 501 STUBS — the two team-intel AI reads (TeamIntelReadEndpoints.cs: gate → team IDOR ' +
      'probe → 501 "AI agent pending"). NO role receives a 200 from them, and the harness contract cannot express ' +
      'that: `expectedByRole` admits only 200|403, checks/parity.ts fails a C#-only endpoint on any non-200, ' +
      "surfaces.test.ts's probeRole-expects-200 invariant covers every endpoint of a surface, and the RLS Mode-A " +
      'positive control requires the org-B caller to reach its own resource 200 + non-empty. Registering them on ' +
      'the team-intel surface would therefore manufacture a permanent false-RED — the #166 shape, worse than this ' +
      'documented gap. Their gate→probe→501 ordering (auth still enforced, id never confirmed) is pinned by ' +
      'TeamIntelReadEndpointAuthTests.cs. When the AI agents ship and these answer 200, register them as by-id ' +
      "endpoints (idScopeKey 'team') on the team-intel surface and delete this group.",
    routes: ['GET /team-intel/teams/{teamId}/balance-alerts', 'GET /team-intel/teams/{teamId}/recommended-hires'],
  },
  {
    reason:
      'THE SURFACE IS REGISTERED, BUT ONLY A SUBSET OF ITS DEPLOYED READS IS. Adding the rest is NOT a registry ' +
      'edit: each needs a seeded grant fixture and a PROBED cross-org status before an expectation can be written ' +
      'down rather than guessed. Measured coverage of DEPLOYED GETs, 2026-08-11 — engagement 2 of 14, dei 2 of 11, ' +
      'compensation 2 of 12, ninebox 4 of 11. Do not read "the surface is registered" as "the domain is covered". ' +
      'The platform-organizations WRITES are NO LONGER an instance of this: all three deployed writes are now ' +
      'registered — PATCH /{id} and POST /{id}/suspend under `organization`, and POST /platform/organizations ' +
      'under its own `organization-create` surface (#208, resolved 2026-08-11 with a prior-run cleanup in ' +
      'seed.ts). That route was the worked example in this group; it was removed from the list when registered, ' +
      'which is what shrinking this gap is supposed to look like.',
    routes: [
      'GET /engagement/action-plans',
      'GET /engagement/alerts',
      'GET /engagement/climate-heatmap',
      'GET /engagement/dashboard-kpis',
      'GET /engagement/enps',
      'GET /engagement/leader-commitments',
      'GET /engagement/my/pending-surveys',
      'GET /engagement/surveys/{surveyId}/results',
      'GET /engagement/surveys/{surveyId}/results-by-area',
      'GET /engagement/surveys/{surveyId}/sentiment',
      'GET /engagement/surveys/{surveyId}/take',
      'GET /engagement/surveys/{surveyId}/word-cloud',
      'GET /dei/age-distribution',
      'GET /dei/dashboard-kpis',
      'GET /dei/gender-representation',
      'GET /dei/hiring-funnel',
      'GET /dei/inclusion-index',
      'GET /dei/leadership-diversity',
      'GET /dei/nationality-diversity',
      'GET /dei/promotion-equity',
      'GET /compensation/benefits-utilization',
      'GET /compensation/compa-ratio-distribution',
      'GET /compensation/my-compensation',
      'GET /compensation/pending-adjustments',
      'GET /compensation/salary-bands',
      'GET /ninebox/bench-strength',
      'GET /ninebox/calibrations',
      'GET /ninebox/calibrations/{id}',
      'GET /ninebox/dashboard-kpis',
      'GET /ninebox/employee/{userId}',
      'GET /ninebox/grid',
      'GET /ninebox/my-calibrations',
      // POST /platform/organizations was allowlisted here when it shipped DARK in 87a02ef1 (Phase-5
      // slice 21, PR #209). REGISTERED 2026-08-11 as WRITE_SURFACES['organization-create'] (#208), so
      // the line is DELETED rather than left as a stale excuse — the "no stale entries" assertion below
      // would fail it anyway, which is the guard working.
    ],
  },
  {
    reason:
      'DEPLOYED BEHIND `Platform__FxReadsEnabled`, NOT the flag of the surface whose path prefix they share ' +
      '(Program.cs:1188-1192 maps MapDeiPayEquityEndpoint() + MapCompensationFxReadEndpoints() under that one flag). ' +
      'A guard that grouped by path prefix would mis-attribute these to `dei`/`compensation`, and registering them ' +
      'under those surfaces would assert against a flag that does not gate them — a green that means nothing.',
    routes: [
      'GET /dei/pay-equity',
      'GET /compensation/band-distribution',
      'GET /compensation/pay-equity',
      'GET /compensation/total-comp-breakdown',
      'GET /compensation/dashboard-kpis',
      'GET /compensation/simulate-adjustment',
    ],
  },
  {
    reason:
      'THE DOMAIN HAS NEVER HAD A PARITY SURFACE AT ALL — no SURFACES or WRITE_SURFACES entry has ever existed for ' +
      'it, so there is no deletion to reverse and no partial coverage to extend. Each needs a surface designed from ' +
      'scratch: probe role, seeded grants, cross-org probe semantics. POST /billing/webhooks/stripe additionally ' +
      'does not fit this harness at all — it is ANONYMOUS and authenticated by the Stripe SIGNATURE ' +
      '(BillingWebhookEndpoints.cs:8, :27), not by a Bearer token, so there is no probe identity to mint. ' +
      'GET /internal/alert-metrics is the #172 privileged cross-org cron read (AlertMetricsEndpoints.cs:43, :47).',
    routes: [
      'GET /external/assessment-results',
      'GET /external/assessment-results/{assignmentId}',
      'POST /external/validations/{validationId}/result',
      'POST /billing/checkout-session',
      'POST /billing/portal-session',
      'POST /billing/cancel-subscription',
      'POST /billing/webhooks/stripe',
      'GET /internal/alert-metrics',
      'PATCH /validations/{validationId}',
    ],
  },
];

const allowlistNormalised = UNREGISTERED_ALLOWLIST.flatMap((g) =>
  g.routes.map((r) => {
    const [verb, ...rest] = r.split(' ');
    return routeKey(verb, rest.join(' '));
  }),
);
const allowed = new Set(allowlistNormalised);

describe('parity registry covers every deployed route (or documents why not)', () => {
  it('parses the deployed contract and the registry — a broken parser must not silently pass', () => {
    // NON-VACUITY FLOOR (the idiom is tests/governance/cutover-table-matches-script.test.ts:64-70).
    // If the OpenAPI shape changes, the verb filter breaks, or the write-builder Proxy stub starts
    // returning garbage, THIS fails loudly — instead of the coverage assertions below filtering an
    // empty set, producing `[]`, and reporting green while checking nothing.
    expect(
      deployedOperations,
      'zero operations parsed from the OpenAPI document — the parser is broken',
    ).toBeGreaterThan(0);
    expect(deployed.size, 'zero deployed route keys built — routeKey() is broken').toBeGreaterThan(0);
    // INJECTIVITY. Two OpenAPI operations that normalise to the same key would collapse into one Set
    // entry, be silently counted as covered, and leave the 151 pin below unmoved. See
    // `deployedOperations`.
    expect(
      deployed.size,
      'two deployed operations normalise to the same VERB+path key — one of them is invisible to the ' +
        'coverage assertion below, and the deployed.size pin cannot see it',
    ).toBe(deployedOperations);
    expect(registry.size, 'zero registry entries parsed — the SURFACES/WRITE_SURFACES walk is broken').toBeGreaterThan(
      0,
    );
    expect(degenerateWritePaths, 'a write buildParity threw or produced a degenerate path').toEqual([]);

    // COUNT PINS. Each carries its reason, because a pin without one is unmaintainable — the next
    // person cannot tell a deliberate change from a regression.
    //
    //   150 = every GET/POST/PATCH/PUT/DELETE operation in contracts/openapi/Tims.Api.json across 143
    //         paths (GET 117, POST 26, PATCH 5, DELETE 2), measured 2026-08-15.
    //         147 → 150 (and 140 → 143 paths): Phase-5 slice 23 (#81 PR 3) deployed three more GETs —
    //         /platform/dashboard/{kpis,revenue-by-customer,churn-risk}. All three are REGISTERED (so
    //         the allowlist is unchanged), but registered C#-ONLY — no tsProcedure, because the two
    //         stacks resolve FX rates from different providers. Coverage here is about a route being
    //         KNOWN to the registry, not about it being payload-compared; surfaces.test.ts is what
    //         pins which endpoints are which. See surfaces.ts caveat 8.
    //         (141 → 147 was the same slice's PR 2: attention-items, mrr-trend, mrr-forecast,
    //         customer-health, upsell-opportunities, search. 138 → 141 was PR 1.)
    //         Re-derive with:
    //           python3 -c "import json;d=json.load(open('contracts/openapi/Tims.Api.json'));\
    //           v={'get','post','patch','put','delete'};\
    //           print(len(d['paths']),sum(1 for p,i in d['paths'].items() for m in i if m.lower() in v))"
    //         /health + /ready are NOT in the document (MapHealthChecks emits no endpoint metadata),
    //         so this counts domain operations, not "every routable path". A new route bumps this,
    //         deliberately — that is the point.
    //         (151 → 157 was Phase-5 slice 24 / #90: the six fit-engine routes, landed dark and
    //         allowlisted pending their fixture-first registration — see their two groups above.)
    expect(deployed.size).toBe(157);
    //   92 = 65 read endpoints (surfaces.ts, 14 surfaces) + 27 write (write-surfaces.ts, 8 surfaces:
    //        24 written literally + 3 produced by the shared `transitionEndpoint` helper). The READ side
    //        went 40 → 65 on 2026-08-17 (#195 residual): the four talent surfaces deleted in the
    //        TS-deletion passes were re-registered C#-only — team-intel 5 (of 7 deployed; the two 501
    //        stubs stay allowlisted, see their group), reporting 6, succession 9, evaluation360 5 —
    //        so the read-surface count went 10 → 14 and the allowlist shrank by 27 lines.
    //        (39 → 40 was 2026-08-16, ai-cost-anomalies on the existing `dashboard` surface;
    //        36 → 39 was slice 23 PR 3; 30 → 36 was PR 2; 27 → 30 was PR 1, which created that
    //        surface; 24 → 27 was slice 22's `invitation` surface, 2026-08-12; 26 → 27 on the write
    //        side was 2026-08-11: `organization-create` registered POST /platform/organizations, #208.)
    expect(registryEndpointCount).toBe(92);
    //   ...resolving to 92 DISTINCT VERB+path keys. A drop here means two registry entries normalise
    //   to the same route, which would make one of them invisible to the coverage assertion below.
    //   (This pin is WHY the deleted reporting registration's second kpis probe at period=90D was not
    //   restored: it normalises onto `GET /reporting/kpis` and would collide here.)
    expect(registry.size, 'two registry entries normalise to the same VERB+path key').toBe(92);
    //   27 write paths resolved through the Proxy stub, none degenerate.
    expect(writePaths.length).toBe(27);
  });

  it('every registry entry points at a route that is actually deployed', () => {
    // The INVERSE direction, which nothing in this repo checked before. A typo'd `csharpPath` is
    // caught by no test and no compiler — it would simply 404 during a live cutover, in Federico's
    // hands, and read as a C# failure rather than a registry one. (surfaces.test.ts pins the three
    // access-review paths exactly; this generalises that to all 92 — this figure read "57" until
    // 2026-08-17, stale since before the talent-surface re-registration that made it 92.)
    expect([...registry].filter((k) => !deployed.has(k))).toEqual([]);
  });

  it('every deployed route is registered, or on the documented allowlist with a reason', () => {
    const unaccounted = [...deployed].filter((k) => !registry.has(k) && !allowed.has(k)).map((k) => deployedRaw.get(k));
    expect(
      unaccounted,
      'a NEWLY deployed route has neither a parity registry entry nor an allowlist reason. Register it ' +
        "(scripts/parity/surfaces.ts or write-surfaces.ts — SEED ITS GRANT FIXTURE FIRST, or you get #166's " +
        'false 12/43 FAIL) or add it to UNREGISTERED_ALLOWLIST under a group whose reason genuinely applies to it.',
    ).toEqual([]);
  });

  it('the allowlist has no stale, duplicate, or contradictory entries', () => {
    expect(allowlistNormalised.length, 'duplicate allowlist entry').toBe(allowed.size);
    expect(
      [...allowed].filter((k) => !deployed.has(k)),
      'allowlisted route is no longer deployed — delete the line rather than leaving a stale excuse',
    ).toEqual([]);
    expect(
      [...allowed].filter((k) => registry.has(k)),
      'route is BOTH registered and allowlisted — remove the allowlist line, it now excuses nothing',
    ).toEqual([]);
    //   59 = the long-standing 84 minus the 27 routes of the four talent surfaces re-registered
    //   C#-only on 2026-08-17 (#195 residual: succession 9, team-intel 7, reporting 6,
    //   evaluation360 5), plus the two team-intel 501 stubs RE-ADDED under their own group — they
    //   left the "deleted surface" group but cannot join the registry (no role answers 200; see the
    //   group's reason). Net: 84 − 27 + 2 = 59. Pinned so SHRINKING the gap is visible as progress
    //   and GROWING it is visible as drift; neither can happen silently.
    //   59 → 65, 2026-08-18 (Phase-5 slice 24 / #90): the six fit-engine routes landed DARK — five
    //   pending their fixture-first registration (grants + fit_scores rows do not exist in the
    //   parity seed yet; tracked on #90) and explain-fit permanently 501-inexpressible until a C#
    //   AI plane exists. This is the documented-growth case, not drift: a new dark slice adds its
    //   routes here first and shrinks the list when its surface registers.
    expect(allowlistNormalised.length).toBe(65);
    // Every group must actually carry a reason and actually cover something — an empty group, or one
    // whose "reason" is a word, is a rubber stamp.
    for (const g of UNREGISTERED_ALLOWLIST) {
      expect(g.routes.length, `an allowlist group is empty: "${g.reason.slice(0, 40)}…"`).toBeGreaterThan(0);
      expect(g.reason.length, `allowlist group reason is too short to be a reason: "${g.reason}"`).toBeGreaterThan(40);
    }
    // 5 → 6 on 2026-08-17: the team-intel 501 stubs got their own group — their reason (the harness
    // contract cannot express an endpoint no role gets 200 from) is a different KIND of gap from
    // every other group's, and folding it into one of them would dilute both reasons.
    // 6 → 8 on 2026-08-18 (slice 24 / #90): fit-engine's five registrable-dark routes and its one
    // 501-inexpressible explain-fit are DIFFERENT kinds of gap (one shrinks with fixture work, the
    // other only with a C# AI plane), so they get one group each rather than diluting either reason.
    expect(UNREGISTERED_ALLOWLIST.length, 'the eight documented gap categories').toBe(8);
  });
});
