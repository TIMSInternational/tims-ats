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
}

export function createAnchorLoader(organizationId: string, userId: string): AnchorLoader {
  let teams: Promise<string[]> | null = null;
  let units: Promise<string[]> | null = null;
  let panels: Promise<string[]> | null = null;

  return {
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
  };
}
