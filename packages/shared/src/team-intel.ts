// Pure team-intel shaping kernels — the parity target for the C# port (Phase-5 team-intel
// strangler, Slice 6). No DB, no I/O, so they are golden-fixturable from the repo-root vitest AND
// importable everywhere.
//
// NOT DEAD CODE, despite having no runtime caller (checked before you delete it). This header used
// to read "the SINGLE SOURCE the TS teamIntel router returns"; that router is DELETED as of
// 2026-08-06 (#55), so the importers today are:
//   - buildBalanceScore / buildTeamComparison → tests/team-intel/{balance-score,team-comparison}-fixtures.test.ts
//   - computeAvgTenureYears / computeRoleDiversity → tests/tier2/s-c-team-intel.test.ts, via the
//     re-export shim packages/api/src/routers/team-intel-metrics.ts
// That is the whole point of the arrangement: these functions and
// Tims.Domain.TeamIntel.{BalanceScoreBuilder,TeamComparisonBuilder,TeamIntelMetrics} are asserted
// against the SAME goldens in contracts/team-intel-fixtures/. Deleting the TS side because "nothing
// calls it" would silently retire the C# port's only executable specification.
//
// PARITY PINS (each red-if-regressed in contracts/team-intel-fixtures/*):
//  - Two DIFFERENT roleDiversity formulas — `computeRoleDiversity` is a 2-DECIMAL ratio (round(x*100)/100)
//    while `buildBalanceScore.roleDiversity` is an INTEGER percent (round(x*100)). Do NOT unify.
//  - Two DIFFERENT tenure divisors — `computeAvgTenureYears` uses 365-DAY years, `buildBalanceScore` and
//    `buildTeamComparison` use 30-DAY months. Both intentional.
//  - All `Math.round` are JS half-UP (toward +Infinity); the C# port uses `Math.Floor(x + 0.5)`, NOT
//    banker's rounding.
//  - `uniqueRoles`/diversity count DISTINCT NON-EMPTY jobTitles (`.filter(Boolean)` drops null/empty).
//  - `nowMs` is INJECTED (callers pass `Date.now()`; the goldens pass a fixed instant), never read
//    inside the kernel. The TS caller that used to inject it was the router, now deleted (#55).

const YEAR_MS = 1000 * 60 * 60 * 24 * 365;
const MONTH_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * Mean tenure in YEARS (365-day years), rounded to one decimal (JS half-up). Empty → 0.
 * Ported verbatim from the former team-intel-metrics.ts. Its TS consumer used to be the router's
 * getDashboardKpis (deleted 2026-07-28); the C# owner is TeamIntelMetrics.AvgTenureYears.
 */
export function computeAvgTenureYears(members: { createdAt: Date }[], nowMs: number): number {
  if (members.length === 0) return 0;
  const years = members.reduce((s, m) => s + (nowMs - m.createdAt.getTime()) / YEAR_MS, 0) / members.length;
  return Math.round(years * 10) / 10;
}

/**
 * Role diversity as a 2-DECIMAL ratio: `round((distinctNonEmptyTitles / count) * 100) / 100`. Empty → 0.
 * NOTE: this is a DIFFERENT formula from `buildBalanceScore.roleDiversity` (an integer percent) — both
 * are preserved verbatim; do NOT unify.
 */
export function computeRoleDiversity(members: { jobTitle: string | null }[]): number {
  if (members.length === 0) return 0;
  const unique = new Set(members.map((m) => m.jobTitle).filter(Boolean)).size;
  return Math.round((unique / members.length) * 100) / 100;
}

export interface BalanceScoreMember {
  jobTitle: string | null;
  createdAt: Date;
}
export interface BalanceScoreView {
  memberCount: number;
  uniqueRoles: number;
  /** INTEGER percent — `count > 0 ? round((uniqueRoles / count) * 100) : 0` (≠ computeRoleDiversity). */
  roleDiversity: number;
  /** Mean tenure in 30-DAY months, one decimal (JS half-up). */
  avgTenureMonths: number;
  sizeScore: number;
  balanceScore: number;
}

/**
 * The team balance score — a faithful extraction of the (now-deleted, #55) TS getBalanceScore body,
 * which wrapped this with the `teamId`, exactly as C# GetBalanceScoreAsync does today. tenure uses 30-DAY months (≠ the 365-day years above); `roleDiversity` is an
 * INTEGER percent; `sizeScore` is 100 for a 3..10-member team else `max(0, 100 - abs(count - 7) * 10)`;
 * `balanceScore` = `round((sizeScore + roleDiversity) / 2)`. All rounds are JS half-up.
 */
export function buildBalanceScore(members: BalanceScoreMember[], nowMs: number): BalanceScoreView {
  const memberCount = members.length;

  const tenureMonths = members.map((m) => (nowMs - m.createdAt.getTime()) / MONTH_MS);
  const avgTenure = tenureMonths.length > 0 ? tenureMonths.reduce((a, b) => a + b, 0) / tenureMonths.length : 0;

  const uniqueRoles = new Set(members.map((m) => m.jobTitle).filter(Boolean)).size;
  const roleDiversity = memberCount > 0 ? Math.round((uniqueRoles / memberCount) * 100) : 0;

  const sizeScore = memberCount >= 3 && memberCount <= 10 ? 100 : Math.max(0, 100 - Math.abs(memberCount - 7) * 10);
  const balanceScore = Math.round((sizeScore + roleDiversity) / 2);

  return {
    memberCount,
    uniqueRoles,
    roleDiversity,
    avgTenureMonths: Math.round(avgTenure * 10) / 10,
    sizeScore,
    balanceScore,
  };
}

export interface TeamComparisonLeader {
  id: string;
  firstName: string;
  lastName: string;
}
export interface TeamComparisonInput {
  id: string;
  name: string;
  leader: TeamComparisonLeader | null;
  members: { jobTitle: string | null; createdAt: Date }[];
  openVacancies: number;
  activeOkrs: number;
}
export interface TeamComparisonRow {
  teamId: string;
  teamName: string;
  leader: TeamComparisonLeader | null;
  memberCount: number;
  uniqueRoles: number;
  /** Mean tenure in 30-DAY months, one decimal (JS half-up). */
  avgTenureMonths: number;
  openVacancies: number;
  activeOkrs: number;
}
export interface TeamComparisonView {
  teams: TeamComparisonRow[];
}

/**
 * Multi-team comparison — a faithful extraction of the TS compareTeams shaping. Per team: member count,
 * distinct non-empty roles, mean 30-DAY-month tenure (one decimal, JS half-up), and the passthrough
 * leader + open-vacancy / active-OKR counts. Input order is preserved (no sort — the query order stands).
 */
export function buildTeamComparison(teams: TeamComparisonInput[], nowMs: number): TeamComparisonView {
  const rows = teams.map((team) => {
    const memberCount = team.members.length;
    const uniqueRoles = new Set(team.members.map((m) => m.jobTitle).filter(Boolean)).size;
    const tenureMonths = team.members.map((m) => (nowMs - m.createdAt.getTime()) / MONTH_MS);
    const avgTenure = tenureMonths.length > 0 ? tenureMonths.reduce((a, b) => a + b, 0) / tenureMonths.length : 0;

    return {
      teamId: team.id,
      teamName: team.name,
      leader: team.leader,
      memberCount,
      uniqueRoles,
      avgTenureMonths: Math.round(avgTenure * 10) / 10,
      openVacancies: team.openVacancies,
      activeOkrs: team.activeOkrs,
    };
  });

  return { teams: rows };
}
