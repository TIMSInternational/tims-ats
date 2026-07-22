'use client';

// Per-surface read gate for the EIGHT FE-consumed succession reads (getDashboardKpis /
// listCriticalRoles / getCompetencyCoverage / getFlightRisk / getRolesWithoutSuccessor /
// getCompGapAlerts / getSuggestedSuccessors / simulateExit) — the fifth read surface staged to
// route to the C# Platform service. DARK by default: unless BOTH the platform-api base URL and
// NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP are set at deploy time, every hook returns the existing
// tRPC query unchanged (byte-identical to today). Merging changes nothing in prod until Federico
// flips the flag at cutover.
//
// Mirrors lib/platform-api/{reporting,billing,evaluation360}.ts exactly: each hook calls BOTH the
// tRPC hook (enabled when NOT viaCSharp) and a C# useQuery (enabled when viaCSharp), then returns
// the active one. The C# useQuery is typed to the EXACT tRPC output type (inferRouterOutputs), so
// each mapper below is compile-time-locked to the live contract's shape — including the superjson
// Date semantics on the CriticalRole/Successor date fields and the number-as-string wire artifacts.
//
// All eight live behind the C# `Platform:SuccessionReadEnabled` backend flag (see
// services/Tims.Platform/src/Tims.Api/Succession/SuccessionReadEndpoints.cs — the nine GETs are
// mapped by MapSuccessionReadEndpoints, gated on SuccessionReadEnabled; getCriticalRole is the one
// not consumed by the FE, so it gets no wrapper here), so they share ONE FE flag mirroring it.

import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type DashboardKpisOutput = RouterOutput['succession']['getDashboardKpis'];
type ListCriticalRolesOutput = RouterOutput['succession']['listCriticalRoles'];
type CompetencyCoverageOutput = RouterOutput['succession']['getCompetencyCoverage'];
type FlightRiskOutput = RouterOutput['succession']['getFlightRisk'];
type RolesWithoutSuccessorOutput = RouterOutput['succession']['getRolesWithoutSuccessor'];
type CompGapAlertsOutput = RouterOutput['succession']['getCompGapAlerts'];
type SuggestedSuccessorsOutput = RouterOutput['succession']['getSuggestedSuccessors'];
type SimulateExitOutput = RouterOutput['succession']['simulateExit'];

// Nested-shape aliases so the number-as-string / DB-enum-string wire artifacts are narrowed back to
// the EXACT unions each tRPC output declares (no `any`; cast a widened wire value to the contract
// type). The C# service only ever emits valid DB enum strings — a `string`-typed field makes the
// cast a no-op, a union-typed field is narrowed to it.
type ListRoleOut = ListCriticalRolesOutput[number];
type ListSuccOut = ListRoleOut['successors'][number];
type CoverageRowOut = CompetencyCoverageOutput[number];
type SuggestedOut = SuggestedSuccessorsOutput[number];
type ExitSuccOut = SimulateExitOutput['successors'][number];

// Second gate: even when the client is enabled, succession only routes to C# when its own flag is
// exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const SUCCESSION_VIA_CSHARP = process.env.NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP === 'true';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the tRPC output declares.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

// DateTime fields serialize as canonical Node-ISO strings (…fffZ) via the shared Node-ISO converter.
// The tRPC output types them as Prisma `Date` (superjson rebuilds real Date objects), so the C# path
// reconstructs Date objects to be byte-identical at cutover. The contract types the raw values as
// `unknown`; parse to Date.
const toDate = (v: unknown): Date => new Date(v as string);

// Successor sub-shape shared by listCriticalRoles (the only FE read whose successors the UI reads).
const mapListSuccessor = (s: {
  id: string;
  organizationId: string;
  criticalRoleId: string;
  userId: string;
  readiness: string;
  type: string;
  developmentPlan?: string | null;
  addedById?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  user: { id: string; firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null };
}) => ({
  id: s.id,
  organizationId: s.organizationId,
  criticalRoleId: s.criticalRoleId,
  userId: s.userId,
  readiness: s.readiness as ListSuccOut['readiness'],
  type: s.type as ListSuccOut['type'],
  developmentPlan: s.developmentPlan ?? null,
  addedById: s.addedById ?? null,
  createdAt: toDate(s.createdAt),
  updatedAt: toDate(s.updatedAt),
  user: {
    id: s.user.id,
    firstName: s.user.firstName,
    lastName: s.user.lastName,
    avatar: s.user.avatar ?? null,
    jobTitle: s.user.jobTitle ?? null,
  },
});

/**
 * STAFF org-rollup: the succession KPI dashboard tile counts. Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /succession/dashboard-kpis (integer/double counts coerced to number; note the
 *            lowercase-"to" wire key `ready1to2YearsCount`).
 *  - false → trpc.succession.getDashboardKpis.useQuery() (the DEFAULT).
 */
export function useSuccessionDashboardKpis() {
  const viaCSharp = isPlatformApiEnabled() && SUCCESSION_VIA_CSHARP;

  const trpcQuery = trpc.succession.getDashboardKpis.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<DashboardKpisOutput>({
    queryKey: ['platform-api', 'succession', 'dashboard-kpis'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/succession/dashboard-kpis');
      return {
        totalCriticalRoles: num(raw.totalCriticalRoles),
        totalSuccessors: num(raw.totalSuccessors),
        rolesWithoutSuccessor: num(raw.rolesWithoutSuccessor),
        coverageRate: num(raw.coverageRate),
        readyNowCount: num(raw.readyNowCount),
        ready1to2YearsCount: num(raw.ready1to2YearsCount),
        highFlightRiskRoles: num(raw.highFlightRiskRoles),
        avgSuccessorsPerRole: num(raw.avgSuccessorsPerRole),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF row-scoped: critical roles (scope-filtered) + their in-scope successors. Gate as above.
 *  - true  → GET /succession/critical-roles (optional companyId/unitId/criticality/search query;
 *            flightRisk number|null; createdAt/updatedAt Dates; nested successors' dates rebuilt).
 *  - false → trpc.succession.listCriticalRoles.useQuery(filters) (the DEFAULT).
 */
export function useSuccessionCriticalRoles(
  filters?: { companyId?: string; unitId?: string; criticality?: string; search?: string },
) {
  const viaCSharp = isPlatformApiEnabled() && SUCCESSION_VIA_CSHARP;

  const trpcQuery = trpc.succession.listCriticalRoles.useQuery(filters ?? {}, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<ListCriticalRolesOutput>({
    queryKey: ['platform-api', 'succession', 'critical-roles', filters ?? {}],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/succession/critical-roles', {
        companyId: filters?.companyId,
        unitId: filters?.unitId,
        criticality: filters?.criticality,
        search: filters?.search,
      });
      return raw.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        title: r.title,
        positionId: r.positionId ?? null,
        currentHolderId: r.currentHolderId ?? null,
        companyId: r.companyId ?? null,
        unitId: r.unitId ?? null,
        criticality: r.criticality as ListRoleOut['criticality'],
        flightRisk: numOrNull(r.flightRisk),
        targetBandLevel: r.targetBandLevel ?? null,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
        currentHolder: r.currentHolder
          ? {
              id: r.currentHolder.id,
              firstName: r.currentHolder.firstName,
              lastName: r.currentHolder.lastName,
              avatar: r.currentHolder.avatar ?? null,
              jobTitle: r.currentHolder.jobTitle ?? null,
            }
          : null,
        successors: r.successors.map(mapListSuccessor),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: per-role competency-coverage rows (kernel output). Gate as above.
 *  - true  → GET /succession/competency-coverage (integer counts coerced to number).
 *  - false → trpc.succession.getCompetencyCoverage.useQuery() (the DEFAULT).
 */
export function useSuccessionCompetencyCoverage() {
  const viaCSharp = isPlatformApiEnabled() && SUCCESSION_VIA_CSHARP;

  const trpcQuery = trpc.succession.getCompetencyCoverage.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<CompetencyCoverageOutput>({
    queryKey: ['platform-api', 'succession', 'competency-coverage'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/succession/competency-coverage');
      return raw.map((row) => ({
        roleId: row.roleId,
        title: row.title,
        criticality: row.criticality as CoverageRowOut['criticality'],
        totalSuccessors: num(row.totalSuccessors),
        readyNow: num(row.readyNow),
        readySoon: num(row.readySoon),
        developing: num(row.developing),
        coverageStatus: row.coverageStatus as CoverageRowOut['coverageStatus'],
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: the flight-risk register (roles ≥ threshold + `_count.successors`). Gate as above.
 *  - true  → GET /succession/flight-risk (optional threshold query; flightRisk number|null;
 *            createdAt/updatedAt Dates; `_count.successors` coerced to number).
 *  - false → trpc.succession.getFlightRisk.useQuery(input) (the DEFAULT).
 */
export function useSuccessionFlightRisk(input?: { threshold?: number }) {
  const viaCSharp = isPlatformApiEnabled() && SUCCESSION_VIA_CSHARP;

  const trpcQuery = trpc.succession.getFlightRisk.useQuery(input ?? {}, { enabled: !viaCSharp });

  const csharpQuery = useQuery<FlightRiskOutput>({
    queryKey: ['platform-api', 'succession', 'flight-risk', input?.threshold ?? null],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/succession/flight-risk', { threshold: input?.threshold });
      return raw.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        title: r.title,
        positionId: r.positionId ?? null,
        currentHolderId: r.currentHolderId ?? null,
        companyId: r.companyId ?? null,
        unitId: r.unitId ?? null,
        criticality: r.criticality as ListRoleOut['criticality'],
        flightRisk: numOrNull(r.flightRisk),
        targetBandLevel: r.targetBandLevel ?? null,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
        currentHolder: r.currentHolder
          ? {
              id: r.currentHolder.id,
              firstName: r.currentHolder.firstName,
              lastName: r.currentHolder.lastName,
              avatar: r.currentHolder.avatar ?? null,
            }
          : null,
        _count: { successors: num(r._count.successors) },
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: critical roles with no successor. Gate as above.
 *  - true  → GET /succession/roles-without-successor (flightRisk number|null; dates rebuilt).
 *  - false → trpc.succession.getRolesWithoutSuccessor.useQuery() (the DEFAULT).
 */
export function useSuccessionRolesWithoutSuccessor() {
  const viaCSharp = isPlatformApiEnabled() && SUCCESSION_VIA_CSHARP;

  const trpcQuery = trpc.succession.getRolesWithoutSuccessor.useQuery(undefined, {
    enabled: !viaCSharp,
  });

  const csharpQuery = useQuery<RolesWithoutSuccessorOutput>({
    queryKey: ['platform-api', 'succession', 'roles-without-successor'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/succession/roles-without-successor');
      return raw.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        title: r.title,
        positionId: r.positionId ?? null,
        currentHolderId: r.currentHolderId ?? null,
        companyId: r.companyId ?? null,
        unitId: r.unitId ?? null,
        criticality: r.criticality as ListRoleOut['criticality'],
        flightRisk: numOrNull(r.flightRisk),
        targetBandLevel: r.targetBandLevel ?? null,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
        currentHolder: r.currentHolder
          ? {
              id: r.currentHolder.id,
              firstName: r.currentHolder.firstName,
              lastName: r.currentHolder.lastName,
              avatar: r.currentHolder.avatar ?? null,
              jobTitle: r.currentHolder.jobTitle ?? null,
            }
          : null,
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF org-rollup: comp-gap alerts (ready_now successors below their target band midpoint).
 * NOTE: the C# endpoint applies the caller's compensation ROW-scope + field classification, matching
 * the hardened live-TS behavior. Gate as above.
 *  - true  → GET /succession/comp-gap-alerts (salary/midSalary doubles + gapPercent int coerced).
 *  - false → trpc.succession.getCompGapAlerts.useQuery() (the DEFAULT).
 */
export function useSuccessionCompGapAlerts() {
  const viaCSharp = isPlatformApiEnabled() && SUCCESSION_VIA_CSHARP;

  const trpcQuery = trpc.succession.getCompGapAlerts.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<CompGapAlertsOutput>({
    queryKey: ['platform-api', 'succession', 'comp-gap-alerts'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/succession/comp-gap-alerts');
      return raw.map((a) => ({
        successorId: a.successorId,
        roleId: a.roleId,
        roleTitle: a.roleTitle,
        userId: a.userId,
        user: {
          id: a.user.id,
          firstName: a.user.firstName,
          lastName: a.user.lastName,
          avatar: a.user.avatar ?? null,
        },
        currentSalary: num(a.currentSalary),
        currency: a.currency,
        midSalary: num(a.midSalary),
        bandLevel: a.bandLevel,
        gapPercent: num(a.gapPercent),
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF by-id (assertScoped): ranked suggested successors for a critical role. Gate as above; the
 * query is disabled until a role is selected (matching the call site's `enabled: !!roleId`).
 *  - true  → GET /succession/critical-roles/{criticalRoleId}/suggested-successors (scores coerced).
 *  - false → trpc.succession.getSuggestedSuccessors.useQuery({ criticalRoleId }) (the DEFAULT).
 */
export function useSuccessionSuggestedSuccessors(criticalRoleId: string) {
  const enabledId = !!criticalRoleId;
  const viaCSharp = isPlatformApiEnabled() && SUCCESSION_VIA_CSHARP;

  const trpcQuery = trpc.succession.getSuggestedSuccessors.useQuery(
    { criticalRoleId },
    { enabled: !viaCSharp && enabledId },
  );

  const csharpQuery = useQuery<SuggestedSuccessorsOutput>({
    queryKey: ['platform-api', 'succession', 'suggested-successors', criticalRoleId],
    enabled: viaCSharp && enabledId,
    queryFn: async () => {
      const raw = await platformGet(
        '/succession/critical-roles/{criticalRoleId}/suggested-successors',
        undefined,
        { criticalRoleId },
      );
      return raw.map((s) => ({
        userId: s.userId,
        user: {
          id: s.user.id,
          firstName: s.user.firstName,
          lastName: s.user.lastName,
          avatar: s.user.avatar ?? null,
          jobTitle: s.user.jobTitle ?? null,
        },
        quadrant: s.quadrant as SuggestedOut['quadrant'],
        potentialScore: num(s.potentialScore),
        performanceScore: num(s.performanceScore),
        suggestedReadiness: s.suggestedReadiness as SuggestedOut['suggestedReadiness'],
      }));
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * STAFF by-id (assertScoped): exit-impact simulation for a critical role. Gate as above; disabled
 * until a role is selected (matching the call site's `enabled: !!selectedId`).
 *  - true  → GET /succession/critical-roles/{criticalRoleId}/simulate-exit (successor dates rebuilt;
 *            readyNowCount/pipelineCount coerced).
 *  - false → trpc.succession.simulateExit.useQuery({ criticalRoleId }) (the DEFAULT).
 */
export function useSuccessionSimulateExit(criticalRoleId: string) {
  const enabledId = !!criticalRoleId;
  const viaCSharp = isPlatformApiEnabled() && SUCCESSION_VIA_CSHARP;

  const trpcQuery = trpc.succession.simulateExit.useQuery(
    { criticalRoleId },
    { enabled: !viaCSharp && enabledId },
  );

  const csharpQuery = useQuery<SimulateExitOutput>({
    queryKey: ['platform-api', 'succession', 'simulate-exit', criticalRoleId],
    enabled: viaCSharp && enabledId,
    queryFn: async () => {
      const raw = await platformGet(
        '/succession/critical-roles/{criticalRoleId}/simulate-exit',
        undefined,
        { criticalRoleId },
      );
      return {
        role: {
          id: raw.role.id,
          title: raw.role.title,
          criticality: raw.role.criticality as SimulateExitOutput['role']['criticality'],
        },
        currentHolder: raw.currentHolder
          ? {
              id: raw.currentHolder.id,
              firstName: raw.currentHolder.firstName,
              lastName: raw.currentHolder.lastName,
            }
          : null,
        riskLevel: raw.riskLevel as SimulateExitOutput['riskLevel'],
        recommendation: raw.recommendation,
        successors: raw.successors.map((s) => ({
          id: s.id,
          organizationId: s.organizationId,
          criticalRoleId: s.criticalRoleId,
          userId: s.userId,
          readiness: s.readiness as ExitSuccOut['readiness'],
          type: s.type as ExitSuccOut['type'],
          developmentPlan: s.developmentPlan ?? null,
          addedById: s.addedById ?? null,
          createdAt: toDate(s.createdAt),
          updatedAt: toDate(s.updatedAt),
          user: {
            id: s.user.id,
            firstName: s.user.firstName,
            lastName: s.user.lastName,
            jobTitle: s.user.jobTitle ?? null,
          },
        })),
        readyNowCount: num(raw.readyNowCount),
        pipelineCount: num(raw.pipelineCount),
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}
