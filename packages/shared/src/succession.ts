// Pure succession shaping/scoring kernels — the SINGLE SOURCE the TS succession router returns AND the
// parity target for the C# port (Phase-5 succession strangler, Slice 8). No DB, no I/O, no `new Date()`
// (none of these reads carry time math), so they are golden-fixturable from the repo-root vitest AND
// importable everywhere.
//
// PARITY PINS (each red-if-regressed in contracts/succession-fixtures/*):
//  - All `Math.round` are JS half-UP (toward +Infinity); the C# port uses `Math.Floor(x + 0.5)`, NOT
//    banker's rounding. coverageRate/avgSuccessorsPerRole/gapPercent are the traps.
//  - avgSuccessorsPerRole is round(total/roles * 10) / 10 (ONE decimal); coverageRate/gapPercent are
//    INTEGER percents (round(x * 100) / round((1 - r) * 100)).
//  - coverageStatus: readyNow>=1 → 'covered'; else totalSuccessors>=1 → 'partial'; else 'uncovered'.
//  - buildSuggestedSuccessors keeps the FIRST evaluation seen per user (input order = evaluatedAt desc,
//    createdAt desc — the repo's job), filters quadrant ∈ {star, high_potential}, excludes existing
//    successor users, then sorts potentialScore desc, performanceScore desc (stable tie-break).
//  - buildExitSimulation picks the FIRST ready_now successor (repo readiness-asc order) for the name.
//  - Zero roles → coverageRate/avgSuccessorsPerRole 0 (no divide-by-zero). Empty inputs → empty outputs.

// ── Read 4: getCompetencyCoverage ────────────────────────────────────────────

export interface CoverageRoleInput {
  id: string;
  title: string;
  criticality: string;
  successors: { readiness: string }[];
}
export type CoverageStatus = 'covered' | 'partial' | 'uncovered';
export interface CoverageRow {
  roleId: string;
  title: string;
  criticality: string;
  totalSuccessors: number;
  readyNow: number;
  readySoon: number;
  developing: number;
  coverageStatus: CoverageStatus;
}

/**
 * Per-role coverage rollup: ready-now / ready-soon (1-2y) / developing counts + a coverage status.
 * Row order = input order (the query's orderBy stands, no re-sort). Ported verbatim from the router.
 */
export function buildCompetencyCoverage(roles: CoverageRoleInput[]): CoverageRow[] {
  return roles.map((role) => {
    const totalSuccessors = role.successors.length;
    const readyNow = role.successors.filter((s) => s.readiness === 'ready_now').length;
    const readySoon = role.successors.filter(
      (s) => s.readiness === 'ready_1_year' || s.readiness === 'ready_2_years',
    ).length;

    return {
      roleId: role.id,
      title: role.title,
      criticality: role.criticality,
      totalSuccessors,
      readyNow,
      readySoon,
      developing: totalSuccessors - readyNow - readySoon,
      coverageStatus:
        readyNow >= 1 ? 'covered' : totalSuccessors >= 1 ? 'partial' : 'uncovered',
    };
  });
}

// ── Read 9: getDashboardKpis ─────────────────────────────────────────────────

export interface SuccessionKpiCounts {
  totalCriticalRoles: number;
  totalSuccessors: number;
  rolesWithoutSuccessor: number;
  readyNowCount: number;
  ready1to2YearsCount: number;
  highFlightRiskRoles: number;
}
export interface SuccessionKpiView {
  totalCriticalRoles: number;
  totalSuccessors: number;
  rolesWithoutSuccessor: number;
  coverageRate: number;
  readyNowCount: number;
  ready1to2YearsCount: number;
  highFlightRiskRoles: number;
  avgSuccessorsPerRole: number;
}

/**
 * The succession dashboard rollup from the six pre-computed org counts. coverageRate is an INTEGER
 * percent (roles WITH a successor / total), avgSuccessorsPerRole is ONE-decimal (total / roles); both
 * are JS half-up and floor to 0 when there are no roles.
 */
export function buildSuccessionKpis(counts: SuccessionKpiCounts): SuccessionKpiView {
  const { totalCriticalRoles, totalSuccessors, rolesWithoutSuccessor } = counts;
  return {
    totalCriticalRoles,
    totalSuccessors,
    rolesWithoutSuccessor,
    coverageRate:
      totalCriticalRoles > 0
        ? Math.round(((totalCriticalRoles - rolesWithoutSuccessor) / totalCriticalRoles) * 100)
        : 0,
    readyNowCount: counts.readyNowCount,
    ready1to2YearsCount: counts.ready1to2YearsCount,
    highFlightRiskRoles: counts.highFlightRiskRoles,
    avgSuccessorsPerRole:
      totalCriticalRoles > 0 ? Math.round((totalSuccessors / totalCriticalRoles) * 10) / 10 : 0,
  };
}

// ── Read 8: simulateExit ─────────────────────────────────────────────────────

export interface ExitSuccessorInput {
  readiness: string;
  user: { firstName: string; lastName: string };
}
export type ExitRiskLevel = 'low' | 'medium' | 'high';
export interface ExitSimulation {
  riskLevel: ExitRiskLevel;
  recommendation: string;
  readyNowCount: number;
  pipelineCount: number;
}

/**
 * The exit-impact decision from the role's (scope-filtered) successors: a ready-now successor → low
 * risk (naming the FIRST ready-now person, in repo readiness-asc order); else a ready-soon successor →
 * medium; else high. The recommendation strings are ASCII, verbatim from the router.
 */
export function buildExitSimulation(successors: ExitSuccessorInput[]): ExitSimulation {
  const readyNow = successors.filter((s) => s.readiness === 'ready_now');
  const readySoon = successors.filter(
    (s) => s.readiness === 'ready_1_year' || s.readiness === 'ready_2_years',
  );

  let riskLevel: ExitRiskLevel;
  let recommendation: string;

  if (readyNow.length >= 1) {
    riskLevel = 'low';
    recommendation = `Sucesor listo: ${readyNow[0].user.firstName} ${readyNow[0].user.lastName}`;
  } else if (readySoon.length >= 1) {
    riskLevel = 'medium';
    recommendation = `Sucesor disponible en 1-2 anos. Considerar plan de aceleracion.`;
  } else {
    riskLevel = 'high';
    recommendation = `Sin sucesores identificados. Iniciar busqueda inmediata.`;
  }

  return {
    riskLevel,
    recommendation,
    readyNowCount: readyNow.length,
    pipelineCount: successors.length,
  };
}

// ── Read 7: getSuggestedSuccessors ───────────────────────────────────────────

export interface SuggestedUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  jobTitle: string | null;
}
export interface SuggestedEvaluationInput {
  userId: string;
  quadrant: string;
  potentialScore: number;
  performanceScore: number;
  user: SuggestedUser;
}
export type SuggestedReadiness = 'ready_now' | 'ready_1_year';
export interface SuggestedSuccessor {
  userId: string;
  user: SuggestedUser;
  quadrant: string;
  potentialScore: number;
  performanceScore: number;
  suggestedReadiness: SuggestedReadiness;
}

const READINESS_BY_QUADRANT: Record<string, SuggestedReadiness> = {
  star: 'ready_now',
  high_potential: 'ready_1_year',
};

/**
 * Ranked successor suggestions from the caller's (scope-filtered) nine-box evaluations. Input MUST be
 * pre-ordered evaluatedAt desc, createdAt desc — the FIRST row per user is kept (their most recent
 * placement); a stale earlier-period "star" never resurfaces. Then: keep only star/high_potential,
 * drop anyone already a successor for the role, sort potentialScore desc then performanceScore desc.
 */
export function buildSuggestedSuccessors(
  evaluations: SuggestedEvaluationInput[],
  existingUserIds: string[],
): SuggestedSuccessor[] {
  const existing = new Set(existingUserIds);
  const latestByUser = new Map<string, SuggestedEvaluationInput>();
  for (const ev of evaluations) {
    if (!latestByUser.has(ev.userId)) latestByUser.set(ev.userId, ev);
  }

  return Array.from(latestByUser.values())
    .filter((ev) => ev.quadrant === 'star' || ev.quadrant === 'high_potential')
    .filter((ev) => !existing.has(ev.userId))
    .sort((a, b) => {
      if (b.potentialScore !== a.potentialScore) return b.potentialScore - a.potentialScore;
      return b.performanceScore - a.performanceScore;
    })
    .map((ev) => ({
      userId: ev.userId,
      user: ev.user,
      quadrant: ev.quadrant,
      potentialScore: ev.potentialScore,
      performanceScore: ev.performanceScore,
      suggestedReadiness: READINESS_BY_QUADRANT[ev.quadrant],
    }));
}

// ── Read 6: getCompGapAlerts (detection) ─────────────────────────────────────

export const COMP_GAP_THRESHOLD = 0.9;

export interface CompGapUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
}
export interface CompGapSuccessorInput {
  id: string;
  userId: string;
  user: CompGapUser;
}
export interface CompGapRoleInput {
  id: string;
  title: string;
  targetBandLevel: string | null;
  successors: CompGapSuccessorInput[];
}
export interface CompGapBandInput {
  level: string;
  midSalary: number;
}
/** currentSalary/currency are OPTIONAL: absent (undefined) = the caller's roles are not entitled to the
 *  restricted field (selectFor omitted it) → the successor is skipped, never a null-ed sensitive field. */
export interface CompGapCompInput {
  id: string;
  userId: string;
  currentSalary?: number;
  currency?: string;
}
export interface CompGapAlert {
  successorId: string;
  roleId: string;
  roleTitle: string;
  userId: string;
  user: CompGapUser;
  currentSalary: number;
  currency: string;
  midSalary: number;
  bandLevel: string;
  gapPercent: number;
}
export interface CompGapResult {
  /** The alerts to return to the caller. */
  alerts: CompGapAlert[];
  /** The employeeCompensation record ids actually EXPOSED via `alerts` — the router audits exactly these. */
  auditedCompIds: string[];
}

/**
 * The comp-gap detection loop: for each ready-now successor on a role that opted into a target band,
 * flag when their current salary is below 90% of the band midpoint. Skips successors with no matching
 * band or no visible compensation. gapPercent = round((1 - currentSalary/midSalary) * 100), JS half-up.
 * Returns both the alerts and the exposed comp ids so the caller can audit exactly the exposed rows.
 */
export function buildCompGapAlerts(
  roles: CompGapRoleInput[],
  bands: CompGapBandInput[],
  comps: CompGapCompInput[],
): CompGapResult {
  const bandByLevel = new Map(bands.map((b) => [b.level, b]));
  const compByUser = new Map(comps.map((c) => [c.userId, c]));

  const alerts: CompGapAlert[] = [];
  const auditedCompIds: string[] = [];

  for (const role of roles) {
    const band = role.targetBandLevel ? bandByLevel.get(role.targetBandLevel) : undefined;
    if (!band) continue;

    for (const successor of role.successors) {
      const comp = compByUser.get(successor.userId);
      if (!comp || comp.currentSalary === undefined || comp.currency === undefined) continue;

      if (comp.currentSalary < band.midSalary * COMP_GAP_THRESHOLD) {
        alerts.push({
          successorId: successor.id,
          roleId: role.id,
          roleTitle: role.title,
          userId: successor.userId,
          user: successor.user,
          currentSalary: comp.currentSalary,
          currency: comp.currency,
          midSalary: band.midSalary,
          bandLevel: band.level,
          gapPercent: Math.round((1 - comp.currentSalary / band.midSalary) * 100),
        });
        auditedCompIds.push(comp.id);
      }
    }
  }

  return { alerts, auditedCompIds };
}
