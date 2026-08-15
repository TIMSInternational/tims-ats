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
 * deployed service that is. Re-measured 2026-08-15: 66 registered endpoints against 150 deployed
 * operations, leaving a gap of 84. (The numeric PINS below were updated when slice 23 landed; update
 * both this prose and the pins, or neither is trustworthy — slice 22 updated only the pins and this
 * line read 50/135/gap-85 for a commit, and slice 23's SECOND PR repeated the mistake: it moved the
 * pins to 147/63 and left every figure in this header at the pre-PR numbers. Slice 23's THIRD PR
 * updated both, which is the only reason this sentence is worth keeping.)
 *
 * THIS GUARD MEASURES REGISTRATION, NOT PROBE COVERAGE, and the two are not the same number, and as
 * of 2026-08-15 there is a THIRD number: registration does not imply a PAYLOAD DIFF either, since an
 * endpoint may be registered C#-only (no `tsProcedure`) and report [WEAK]. Three of the 39 are — the
 * `dashboard` surface's FX reads, see surfaces.ts caveat 8. Of the
 * 39 READ registrations, TWENTY-FIVE issue no cross-tenant probe at all: 24 carry `globalScope` and 1
 * carries `noTenantBoundaryForCaller`, and checks/rls.ts returns `inconclusive` for both without calling
 * anything. Those are correct dispositions — a platform-owner cross-org read has no tenant boundary
 * to prove — but it means a route can move from the allowlist into the "covered" set without gaining
 * a Mode-A probe. This change is its own worked example: `GET /platform/organizations/{id}` left
 * allowlist group 3 and the gap pin dropped 86 → 85, which reads as progress, while that route's RLS
 * disposition went from "unprobed" to "unprobed, documented". Read the headline numbers as
 * "registered and therefore visible to the harness", never as "probed for cross-tenant isolation".
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
 *      /src/Tims.Api --include='*.cs' | wc -l` = 148 call sites (re-run 2026-08-15), minus the 1 inside
 *      the private `MapTransition` helper (Evaluation360WriteEndpoints.cs:169, mapping at :172), plus
 *      its 3 invocations (Evaluation360WriteEndpoints.cs:78/:80/:82) = 150, which is
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
 * the document — MapHealthChecks emits no endpoint metadata. So this guard covers 150 domain
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
 *  1. Truncate at the first `?`. Eight of the 24 read registry entries carry a query string
 *     (`/monitoring/alerts?page=1&limit=20`, the three access-review `?organizationId=…` routes, …);
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
 *  `GET /platform/organizations/{*}`, be counted as covered, and leave the 150 pin unmoved. Asserting
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
      'left to diff" — obsolete since `tsProcedure` became OPTIONAL on 2026-08-06 (efb7553f). These are exactly the ' +
      'six `parity_command=NONE` rows in scripts/deploy/cutover.sh. Re-registering them C#-only (the audit-log / ' +
      'access-review precedent, 2026-08-11) is the fix and is tracked separately: unlike those two platform-owner ' +
      'surfaces, each of these is org-scoped RBAC and needs its OWN seeded grant fixture first — a missing grant ' +
      "reproduces #166's false 12/43 FAIL, which is worse than a documented gap.",
    routes: [
      'GET /succession/comp-gap-alerts',
      'GET /succession/competency-coverage',
      'GET /succession/critical-roles',
      'GET /succession/critical-roles/{criticalRoleId}',
      'GET /succession/critical-roles/{criticalRoleId}/simulate-exit',
      'GET /succession/critical-roles/{criticalRoleId}/suggested-successors',
      'GET /succession/dashboard-kpis',
      'GET /succession/flight-risk',
      'GET /succession/roles-without-successor',
      'GET /team-intel/compare',
      'GET /team-intel/dashboard-kpis',
      'GET /team-intel/teams/{teamId}/balance-alerts',
      'GET /team-intel/teams/{teamId}/balance-score',
      'GET /team-intel/teams/{teamId}/members',
      'GET /team-intel/teams/{teamId}/profile',
      'GET /team-intel/teams/{teamId}/recommended-hires',
      'GET /reporting/funnel',
      'GET /reporting/kpis',
      'GET /reporting/lost-by-delay',
      'GET /reporting/recruiter-sla',
      'GET /reporting/source-breakdown',
      'GET /reporting/trend',
      'GET /evaluation360/cycles',
      'GET /evaluation360/cycles/{cycleId}/progress',
      'GET /evaluation360/my/rater-tasks',
      'GET /evaluation360/my/report-cycles',
      'GET /evaluation360/my/reports/{cycleId}',
      'GET /billing/usage',
      'GET /billing/plan',
      'GET /billing/config',
      'GET /billing/invoices',
      'GET /billing/invoices/{id}',
    ],
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
    // entry, be silently counted as covered, and leave the 150 pin below unmoved. See
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
    expect(deployed.size).toBe(150);
    //   66 = 39 read endpoints (surfaces.ts, 10 surfaces) + 27 write (write-surfaces.ts, 8 surfaces:
    //        24 written literally + 3 produced by the shared `transitionEndpoint` helper). The READ side
    //        went 36 → 39 on 2026-08-15: slice 23's PR 3 registered all THREE of its newly deployed
    //        routes on the EXISTING `dashboard` surface, so the surface count stays at 10 and the
    //        allowlist below is unchanged — the gap did not grow. (30 → 36 was the same slice's PR 2;
    //        27 → 30 was PR 1, which created that surface; 24 → 27 was slice 22's `invitation`
    //        surface, 2026-08-12; 26 → 27 on the write side was 2026-08-11: `organization-create`
    //        registered POST /platform/organizations, #208.)
    expect(registryEndpointCount).toBe(66);
    //   ...resolving to 66 DISTINCT VERB+path keys. A drop here means two registry entries normalise
    //   to the same route, which would make one of them invisible to the coverage assertion below.
    expect(registry.size, 'two registry entries normalise to the same VERB+path key').toBe(66);
    //   27 write paths resolved through the Proxy stub, none degenerate.
    expect(writePaths.length).toBe(27);
  });

  it('every registry entry points at a route that is actually deployed', () => {
    // The INVERSE direction, which nothing in this repo checked before. A typo'd `csharpPath` is
    // caught by no test and no compiler — it would simply 404 during a live cutover, in Federico's
    // hands, and read as a C# failure rather than a registry one. (surfaces.test.ts pins the three
    // access-review paths exactly; this generalises that to all 57.)
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
    //   84 = the measured gap at 87a02ef1 (86) minus GET /platform/organizations/{id}, registered the
    //   same day as `organization/detail` under `noTenantBoundaryForCaller` (#195), minus
    //   POST /platform/organizations, registered 2026-08-11 as `organization-create` (#208). Pinned so
    //   SHRINKING the gap is visible as progress and GROWING it is visible as drift; neither can happen
    //   silently.
    expect(allowlistNormalised.length).toBe(84);
    // Every group must actually carry a reason and actually cover something — an empty group, or one
    // whose "reason" is a word, is a rubber stamp.
    for (const g of UNREGISTERED_ALLOWLIST) {
      expect(g.routes.length, `an allowlist group is empty: "${g.reason.slice(0, 40)}…"`).toBeGreaterThan(0);
      expect(g.reason.length, `allowlist group reason is too short to be a reason: "${g.reason}"`).toBeGreaterThan(40);
    }
    expect(UNREGISTERED_ALLOWLIST.length, 'the five documented gap categories').toBe(5);
  });
});
