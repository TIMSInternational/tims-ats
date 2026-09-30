'use client';

import { useQuery } from '@tanstack/react-query';
import { trpc } from '../trpc';
import { PlatformApiError } from './client';
import { fetchOrgStructureOptions, isOrgStructureViaCSharp, ORG_STRUCTURE_OPTIONS_QUERY_KEY } from './org-structure';

export interface VacancyTeamOption {
  id: string;
  name: string;
  hasLeader: boolean;
}

export interface VacancyUnitOption {
  id: string;
  name: string;
}

export type VacancyOrgOptionsFailure = 'forbidden' | 'unavailable';

export interface VacancyOrgOptionsState {
  units: VacancyUnitOption[];
  /** Teams of the selected business unit only (empty when none is selected). */
  teams: VacancyTeamOption[];
  isLoading: boolean;
  failure: VacancyOrgOptionsFailure | null;
}

function isForbidden(error: unknown): boolean {
  if (error instanceof PlatformApiError) return error.status === 403;
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { code?: unknown } | null }).data;
    return data?.code === 'FORBIDDEN';
  }
  return false;
}

/**
 * Business-unit / team choices for the vacancy wizard, from exactly one backend per build: the C#
 * `/tenant/org-structure/options` (organization:read OR vacancy:create/update) when
 * NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP is on, otherwise the existing tRPC organization reads
 * (organization:read — a recruiter without it gets `failure: 'forbidden'` and the wizard hides the fields).
 */
export function useVacancyOrgOptions(selectedUnitId: string | null): VacancyOrgOptionsState {
  const viaCSharp = isOrgStructureViaCSharp();

  const csharp = useQuery({
    queryKey: ORG_STRUCTURE_OPTIONS_QUERY_KEY,
    enabled: viaCSharp,
    retry: false,
    staleTime: 60_000,
    queryFn: fetchOrgStructureOptions,
  });

  const companies = trpc.organization.listCompanies.useQuery(undefined, {
    enabled: !viaCSharp,
    retry: false,
    staleTime: 60_000,
  });
  const legacyTeams = trpc.organization.listTeams.useQuery(
    { businessUnitId: selectedUnitId ?? '' },
    { enabled: !viaCSharp && !!selectedUnitId, retry: false, staleTime: 60_000 },
  );

  if (viaCSharp) {
    const units = csharp.data?.businessUnits ?? [];
    const selected = units.find((u) => u.id === selectedUnitId);
    return {
      units: units.map((u) => ({ id: u.id, name: u.name })),
      teams: selected?.teams ?? [],
      isLoading: csharp.isLoading,
      failure: csharp.isError ? (isForbidden(csharp.error) ? 'forbidden' : 'unavailable') : null,
    };
  }

  const units = (companies.data ?? []).flatMap((c) => c.businessUnits.map((u) => ({ id: u.id, name: u.name })));
  const failedQuery = companies.isError ? companies : legacyTeams.isError ? legacyTeams : null;
  return {
    units,
    teams: selectedUnitId
      ? (legacyTeams.data ?? []).map((team) => ({ id: team.id, name: team.name, hasLeader: !!team.leader }))
      : [],
    isLoading: companies.isLoading,
    failure: failedQuery ? (isForbidden(failedQuery.error) ? 'forbidden' : 'unavailable') : null,
  };
}
