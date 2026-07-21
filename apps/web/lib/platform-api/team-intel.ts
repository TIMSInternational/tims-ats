'use client';

// Per-surface read gate for the team-intel dashboard KPIs — the FIRST read surface
// staged to route to the C# Platform service. DARK by default: unless BOTH env vars
// are set at deploy time, this returns the existing tRPC query unchanged (byte-identical
// to today). Merging changes nothing in prod until Federico flips the flag at cutover.

import { useQuery } from '@tanstack/react-query';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet } from './client';

// The KPI data shape — identical field-for-field to the tRPC getDashboardKpis output
// AND to the C# DashboardKpiView (all camelCase). Verified against
// packages/api/src/routers/teamIntel.ts + services/Tims.Platform/.../TeamIntelReadModels.cs.
export interface DashboardKpis {
  totalTeams: number;
  totalMembers: number;
  teamsWithLeader: number;
  teamsWithoutLeader: number;
  avgTeamSize: number;
  avgTenureYears: number;
  diversityIndex: number;
}

// Second gate: even when the client is enabled, this specific surface only routes to
// C# when its own flag is 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const TEAMINTEL_VIA_CSHARP = process.env.NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP === 'true';

/**
 * Returns the team-intel dashboard KPIs with a React Query result API
 * (`{ data, isLoading, isError, ... }`) — identical whether the data comes from the
 * C# Platform service or the existing tRPC endpoint.
 *
 * Gate: `isPlatformApiEnabled() && NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /team-intel/dashboard-kpis from the C# service.
 *  - false → the existing trpc.teamIntel.getDashboardKpis.useQuery() (the DEFAULT).
 *
 * Both hooks are always called (React hook rules); the inactive branch is disabled via
 * `enabled`, so exactly one performs a request and the other is inert.
 */
export function useTeamIntelDashboardKpis() {
  const viaCSharp = isPlatformApiEnabled() && TEAMINTEL_VIA_CSHARP;

  // DEFAULT path — identical to today's page.tsx call. When viaCSharp is false this is
  // enabled (the tRPC hook's default), so behavior is unchanged.
  const trpcQuery = trpc.teamIntel.getDashboardKpis.useQuery(undefined, { enabled: !viaCSharp });

  // C# path — inert (never fetches) unless the gate is on.
  const csharpQuery = useQuery<DashboardKpis>({
    queryKey: ['platform-api', 'team-intel', 'dashboard-kpis'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/team-intel/dashboard-kpis');
      // Contract types the numeric fields as number|string (a minimal-API OpenAPI
      // number-as-string read artifact); coerce to number so the returned shape is
      // byte-identical to the tRPC output.
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

  return viaCSharp ? csharpQuery : trpcQuery;
}
