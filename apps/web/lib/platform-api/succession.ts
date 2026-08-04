'use client';

// C#-only succession reads + writes. The 8 TS tRPC read procedures
// (getDashboardKpis/listCriticalRoles/getCompetencyCoverage/getFlightRisk/
// getRolesWithoutSuccessor/getCompGapAlerts/getSuggestedSuccessors/simulateExit) and 2 TS tRPC
// write procedures (addSuccessor/updateCriticalRoleBand) have been deleted — there is no TS
// fallback path left for any of the 10 hooks below. NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP and
// NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP are both confirmed live in prod; this file calls the C#
// service unconditionally rather than gating on either flag.
//
// UPDATE 2026-08-03 (#58): packages/api/src/routers/succession.ts is now DELETED OUTRIGHT. Its last
// 4 procedures — getCriticalRole (the one read with zero FE consumers, never wrapped here) plus the
// 3 zero-consumer writes addCriticalRole/removeSuccessor/updateSuccessorReadiness — are gone, so
// there is no TS *tRPC* succession implementation left. (Deliberately not "none anywhere":
// packages/db/prisma/seed-demo.ts:914-932 still writes critical_roles + successors via Prisma. It is
// a local demo seeder, not a runtime path, but it is a real remaining TS writer and it blocks the
// ownership flip — see #69.) All 5 C# writes and 9 C# reads remain; the
// 3 writes and 1 read with no FE consumer are simply not wrapped in this file, by design.

import { useMutation, useQuery } from '@tanstack/react-query';
import type { SuccessionKpiView, CoverageRow, SuggestedSuccessor, CompGapAlert, ExitRiskLevel } from '@tims/shared';
import { platformGet, platformPatch, platformPost } from './client';

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to `number`.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

// DateTime fields serialize as canonical Node-ISO strings (…fffZ). Reconstruct real Date objects
// so every shape below is byte-identical to what the deleted tRPC procedures used to return.
const toDate = (v: unknown): Date => new Date(v as string);

export interface SuccessorItem {
  id: string;
  organizationId: string;
  criticalRoleId: string;
  userId: string;
  readiness: 'ready_now' | 'ready_1_year' | 'ready_2_years' | 'developing';
  type: 'internal' | 'external';
  developmentPlan: string | null;
  addedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; firstName: string; lastName: string; avatar: string | null; jobTitle: string | null };
}

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
}): SuccessorItem => ({
  id: s.id,
  organizationId: s.organizationId,
  criticalRoleId: s.criticalRoleId,
  userId: s.userId,
  readiness: s.readiness as SuccessorItem['readiness'],
  type: s.type as SuccessorItem['type'],
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

export interface CriticalRoleListItem {
  id: string;
  organizationId: string;
  title: string;
  positionId: string | null;
  currentHolderId: string | null;
  companyId: string | null;
  unitId: string | null;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  flightRisk: number | null;
  targetBandLevel: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentHolder: {
    id: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
    jobTitle: string | null;
  } | null;
  successors: SuccessorItem[];
}
type ListCriticalRolesOutput = CriticalRoleListItem[];

export interface FlightRiskItem {
  id: string;
  organizationId: string;
  title: string;
  positionId: string | null;
  currentHolderId: string | null;
  companyId: string | null;
  unitId: string | null;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  flightRisk: number | null;
  targetBandLevel: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentHolder: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  _count: { successors: number };
}
type FlightRiskOutput = FlightRiskItem[];

export interface RoleWithoutSuccessorItem {
  id: string;
  organizationId: string;
  title: string;
  positionId: string | null;
  currentHolderId: string | null;
  companyId: string | null;
  unitId: string | null;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  flightRisk: number | null;
  targetBandLevel: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentHolder: {
    id: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
    jobTitle: string | null;
  } | null;
}
type RolesWithoutSuccessorOutput = RoleWithoutSuccessorItem[];

export interface SimulateExitOutput {
  role: { id: string; title: string; criticality: 'critical' | 'high' | 'medium' | 'low' };
  currentHolder: { id: string; firstName: string; lastName: string } | null;
  riskLevel: ExitRiskLevel;
  recommendation: string;
  successors: SuccessorItem[];
  readyNowCount: number;
  pipelineCount: number;
}

export interface AddSuccessorOutput {
  id: string;
  organizationId: string;
  criticalRoleId: string;
  userId: string;
  readiness: 'ready_now' | 'ready_1_year' | 'ready_2_years' | 'developing';
  type: 'internal' | 'external';
  developmentPlan: string | null;
  addedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; firstName: string; lastName: string; avatar: string | null };
}

export interface UpdateCriticalRoleBandOutput {
  id: string;
  targetBandLevel: string | null;
}

/** STAFF org-rollup: the succession KPI dashboard tile counts. GET /succession/dashboard-kpis. */
export function useSuccessionDashboardKpis() {
  return useQuery<SuccessionKpiView>({
    queryKey: ['platform-api', 'succession', 'dashboard-kpis'],
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
}

/** STAFF row-scoped: critical roles (scope-filtered) + their in-scope successors. GET /succession/critical-roles. */
export function useSuccessionCriticalRoles(filters?: {
  companyId?: string;
  unitId?: string;
  criticality?: string;
  search?: string;
}) {
  return useQuery<ListCriticalRolesOutput>({
    queryKey: ['platform-api', 'succession', 'critical-roles', filters ?? {}],
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
        criticality: r.criticality as CriticalRoleListItem['criticality'],
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
}

/** STAFF org-rollup: per-role competency-coverage rows. GET /succession/competency-coverage. */
export function useSuccessionCompetencyCoverage() {
  return useQuery<CoverageRow[]>({
    queryKey: ['platform-api', 'succession', 'competency-coverage'],
    queryFn: async () => {
      const raw = await platformGet('/succession/competency-coverage');
      return raw.map((row) => ({
        roleId: row.roleId,
        title: row.title,
        criticality: row.criticality,
        totalSuccessors: num(row.totalSuccessors),
        readyNow: num(row.readyNow),
        readySoon: num(row.readySoon),
        developing: num(row.developing),
        coverageStatus: row.coverageStatus as CoverageRow['coverageStatus'],
      }));
    },
  });
}

/** STAFF org-rollup: the flight-risk register. GET /succession/flight-risk. */
export function useSuccessionFlightRisk(input?: { threshold?: number }) {
  return useQuery<FlightRiskOutput>({
    queryKey: ['platform-api', 'succession', 'flight-risk', input?.threshold ?? null],
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
        criticality: r.criticality as FlightRiskItem['criticality'],
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
}

/** STAFF org-rollup: critical roles with no successor. GET /succession/roles-without-successor. */
export function useSuccessionRolesWithoutSuccessor() {
  return useQuery<RolesWithoutSuccessorOutput>({
    queryKey: ['platform-api', 'succession', 'roles-without-successor'],
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
        criticality: r.criticality as RoleWithoutSuccessorItem['criticality'],
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
}

/** STAFF org-rollup: comp-gap alerts. GET /succession/comp-gap-alerts. */
export function useSuccessionCompGapAlerts() {
  return useQuery<CompGapAlert[]>({
    queryKey: ['platform-api', 'succession', 'comp-gap-alerts'],
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
}

/** STAFF by-id: ranked suggested successors for a critical role. GET /succession/critical-roles/{criticalRoleId}/suggested-successors. */
export function useSuccessionSuggestedSuccessors(criticalRoleId: string) {
  const enabledId = !!criticalRoleId;
  return useQuery<SuggestedSuccessor[]>({
    queryKey: ['platform-api', 'succession', 'suggested-successors', criticalRoleId],
    enabled: enabledId,
    queryFn: async () => {
      const raw = await platformGet('/succession/critical-roles/{criticalRoleId}/suggested-successors', undefined, {
        criticalRoleId,
      });
      return raw.map((s) => ({
        userId: s.userId,
        user: {
          id: s.user.id,
          firstName: s.user.firstName,
          lastName: s.user.lastName,
          avatar: s.user.avatar ?? null,
          jobTitle: s.user.jobTitle ?? null,
        },
        quadrant: s.quadrant,
        potentialScore: num(s.potentialScore),
        performanceScore: num(s.performanceScore),
        suggestedReadiness: s.suggestedReadiness as SuggestedSuccessor['suggestedReadiness'],
      }));
    },
  });
}

/** STAFF by-id: exit-impact simulation for a critical role. GET /succession/critical-roles/{criticalRoleId}/simulate-exit. */
export function useSuccessionSimulateExit(criticalRoleId: string) {
  const enabledId = !!criticalRoleId;
  return useQuery<SimulateExitOutput>({
    queryKey: ['platform-api', 'succession', 'simulate-exit', criticalRoleId],
    enabled: enabledId,
    queryFn: async () => {
      const raw = await platformGet('/succession/critical-roles/{criticalRoleId}/simulate-exit', undefined, {
        criticalRoleId,
      });
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
        riskLevel: raw.riskLevel as ExitRiskLevel,
        recommendation: raw.recommendation,
        successors: raw.successors.map((s) => ({
          id: s.id,
          organizationId: s.organizationId,
          criticalRoleId: s.criticalRoleId,
          userId: s.userId,
          readiness: s.readiness as SuccessorItem['readiness'],
          type: s.type as SuccessorItem['type'],
          developmentPlan: s.developmentPlan ?? null,
          addedById: s.addedById ?? null,
          createdAt: toDate(s.createdAt),
          updatedAt: toDate(s.updatedAt),
          user: {
            id: s.user.id,
            firstName: s.user.firstName,
            lastName: s.user.lastName,
            avatar: null,
            jobTitle: s.user.jobTitle ?? null,
          },
        })),
        readyNowCount: num(raw.readyNowCount),
        pipelineCount: num(raw.pipelineCount),
      };
    },
  });
}

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  options: MutationOptions | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

interface AddSuccessorInputShape {
  criticalRoleId: string;
  userId: string;
  readiness: string;
  type: string;
  developmentPlan?: string;
}

/** STAFF: add a successor to a critical role (1 call site: add-successor-modal.tsx). */
export function useSuccessionAddSuccessor(options?: MutationOptions) {
  return useCSharpMutation(async (input: AddSuccessorInputShape) => {
    const raw = await platformPost(
      '/succession/critical-roles/{criticalRoleId}/successors',
      {
        userId: input.userId,
        readiness: input.readiness,
        type: input.type,
        developmentPlan: input.developmentPlan,
      },
      { criticalRoleId: input.criticalRoleId },
    );
    return {
      id: raw.id,
      organizationId: raw.organizationId,
      criticalRoleId: raw.criticalRoleId,
      userId: raw.userId,
      readiness: raw.readiness as AddSuccessorOutput['readiness'],
      type: raw.type as AddSuccessorOutput['type'],
      developmentPlan: raw.developmentPlan ?? null,
      addedById: raw.addedById ?? null,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt),
      user: {
        id: raw.user.id,
        firstName: raw.user.firstName,
        lastName: raw.user.lastName,
        avatar: raw.user.avatar ?? null,
      },
    } satisfies AddSuccessorOutput;
  }, options);
}

interface UpdateCriticalRoleBandInputShape {
  criticalRoleId: string;
  targetBandLevel: string | null;
}

/** STAFF: set a critical role's target salary band level (1 call site: succession-pipeline.tsx). */
export function useSuccessionUpdateCriticalRoleBand(options?: MutationOptions) {
  return useCSharpMutation(async (input: UpdateCriticalRoleBandInputShape) => {
    const raw = await platformPatch(
      '/succession/critical-roles/{criticalRoleId}/band',
      { targetBandLevel: input.targetBandLevel },
      { criticalRoleId: input.criticalRoleId },
    );
    return { id: raw.id, targetBandLevel: raw.targetBandLevel } satisfies UpdateCriticalRoleBandOutput;
  }, options);
}
