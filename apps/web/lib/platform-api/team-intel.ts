'use client';

// C#-only team-intelligence dashboard-KPIs read. The TS tRPC procedure
// (packages/api/src/routers/teamIntel.ts's getDashboardKpis) has been deleted — there is
// no TS fallback path left. NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP is confirmed live in
// prod (2026-07-27) and local dev's .env.local mirrors production values directly, so
// this file calls the C# service unconditionally rather than gating on the flag.

import { useQuery } from '@tanstack/react-query';
import { platformGet } from './client';

// The KPI data shape — identical field-for-field to the deleted tRPC getDashboardKpis
// output AND to the C# DashboardKpiView (all camelCase).
export interface DashboardKpis {
  totalTeams: number;
  totalMembers: number;
  teamsWithLeader: number;
  teamsWithoutLeader: number;
  avgTeamSize: number;
  avgTenureYears: number;
  diversityIndex: number;
}

/**
 * Returns the team-intel dashboard KPIs with a React Query result API
 * (`{ data, isLoading, isError, ... }`). GET /team-intel/dashboard-kpis.
 */
export function useTeamIntelDashboardKpis() {
  return useQuery<DashboardKpis>({
    queryKey: ['platform-api', 'team-intel', 'dashboard-kpis'],
    queryFn: async () => {
      const raw = await platformGet('/team-intel/dashboard-kpis');
      // Contract types the numeric fields as number|string (a minimal-API OpenAPI
      // number-as-string read artifact); coerce to number so the returned shape is
      // byte-identical to the old tRPC output.
      return {
        totalTeams: Number(raw.totalTeams),
        totalMembers: Number(raw.totalMembers),
        teamsWithLeader: Number(raw.teamsWithLeader),
        teamsWithoutLeader: Number(raw.teamsWithoutLeader),
        avgTeamSize: Number(raw.avgTeamSize),
        avgTenureYears: Number(raw.avgTenureYears),
        diversityIndex: Number(raw.diversityIndex),
      };
    },
  });
}
