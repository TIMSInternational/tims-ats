import { tenantDb } from '@tims/db';

// Request-local anchor loader. SECURITY: anchors are the authorization boundary for
// team/unit/panel scopes — they must NEVER be cached across requests (a revoked
// leader/hrbp/evaluator must lose access on their next request). Memoized within
// one loader instance only; each request constructs a fresh loader.
// A rejected load stays memoized for the request — deliberate: consistent fail-closed denial beats inconsistent retry (callers must always await).
export interface AnchorLoader {
  teamMemberIds(): Promise<string[]>;
  unitIds(): Promise<string[]>;
  panelInterviewIds(): Promise<string[]>;
  ledTeamIds(): Promise<string[]>;
  unitMemberIds(): Promise<string[]>;
}

export function createAnchorLoader(organizationId: string, userId: string): AnchorLoader {
  let teams: Promise<string[]> | null = null;
  let units: Promise<string[]> | null = null;
  let panels: Promise<string[]> | null = null;
  let ledTeams: Promise<string[]> | null = null;
  let unitMembers: Promise<string[]> | null = null;

  const loader: AnchorLoader = {
    teamMemberIds() {
      teams ??= (async () => {
        const led = await tenantDb.team.findMany({
          where: { organizationId, leaderId: userId, isActive: true },
          select: { id: true },
        });
        if (led.length === 0) return [userId]; // Floor is [self], not []: keeps team ⊇ own; a team-scope grant without led teams degrades to own-scope (fail-narrow).
        const members = await tenantDb.userTeam.findMany({
          where: { teamId: { in: led.map((t) => t.id) } },
          select: { userId: true },
        });
        return [...new Set([userId, ...members.map((m) => m.userId)])];
      })();
      return teams;
    },
    unitIds() {
      units ??= tenantDb.userBusinessUnit
        .findMany({ where: { organizationId, userId, businessUnit: { isActive: true } }, select: { businessUnitId: true } })
        .then((rows) => rows.map((r) => r.businessUnitId));
      return units;
    },
    panelInterviewIds() {
      // org isolation enforced BOTH app-level (relation filter) and by the tenantDb RLS session — defense in depth per api-security.md.
      panels ??= tenantDb.interviewEvaluator
        .findMany({ where: { userId, interview: { organizationId } }, select: { interviewId: true } })
        .then((rows) => rows.map((r) => r.interviewId));
      return panels;
    },
    ledTeamIds() {
      // Vacancy team-scope anchor: the TEAM ids the user leads (vs teamMemberIds,
      // which returns member USER ids). Floor is [] — a team-scope grant with no
      // led teams matches no team rows; user-anchored OR-arms (assignedTo) still apply.
      ledTeams ??= tenantDb.team
        .findMany({ where: { organizationId, leaderId: userId, isActive: true }, select: { id: true } })
        .then((rows) => rows.map((r) => r.id));
      return ledTeams;
    },
    unitMemberIds() {
      // People-entity unit scope: every user belonging to the caller's assigned
      // units — via the direct User.businessUnitId FK OR membership in a team of
      // that unit (both forms exist in the schema; union + dedupe). Floor []
      // (no units assigned → no unit rows). Request-local like every anchor;
      // reuses the memoized unitIds() so units load at most once per request.
      unitMembers ??= (async () => {
        const units = await loader.unitIds();
        if (units.length === 0) return [];
        const users = await tenantDb.user.findMany({
          where: {
            organizationId,
            OR: [
              { businessUnitId: { in: units } },
              { teams: { some: { team: { businessUnitId: { in: units } } } } },
            ],
          },
          select: { id: true },
        });
        return [...new Set(users.map((u) => u.id))];
      })();
      return unitMembers;
    },
  };

  return loader;
}
