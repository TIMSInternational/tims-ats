import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export interface VacancyPlacement {
  /** undefined = not provided; null = cleared (nothing to verify). */
  companyId?: string | null;
  businessUnitId?: string | null;
  teamId?: string | null;
  assignedTo?: string | null;
}

/** The vacancy's anchors as they will be AFTER the write (input value when provided, else current). */
interface EffectiveAnchors {
  companyId: string | null;
  businessUnitId: string | null;
  teamId: string | null;
}

function reject(message: string): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message });
}

/**
 * Verifies the org anchors a vacancy write sets (company, business unit, team, assignee) belong to the
 * caller's organization and are active, and that the anchors are mutually consistent AFTER the write:
 * the team belongs to the effective business unit, and the unit belongs to the effective company.
 * Without this, a crafted request could point a vacancy at another tenant's company/unit/team/user (the FK
 * alone accepts it) — which leaks that row's name through vacancy list/detail (`company`/`unit`/`team`
 * selects) and feeds the team/unit approval-scope anchors.
 *
 * Consistency is only enforced for a pair this write touches, so an unrelated edit of a legacy vacancy
 * whose stored anchors already disagree is not blocked.
 *
 * Not transactional with the write that follows (accepted): a unit/team deactivated in the milliseconds
 * between this check and the write leaves the vacancy on an inactive anchor — the same state as a
 * deactivation one second after the write, which deactivation does not cascade to either.
 */
async function assertPlacement(
  organizationId: string,
  placement: VacancyPlacement,
  effective: EffectiveAnchors,
): Promise<void> {
  const { companyId, businessUnitId, teamId, assignedTo } = placement;

  if (companyId) {
    const company = await db.company.findFirst({
      where: { id: companyId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!company) reject('La empresa no existe o no esta activa en tu organizacion');
  }

  let unitCompanyId: string | null | undefined;
  if (businessUnitId) {
    const unit = await db.businessUnit.findFirst({
      where: { id: businessUnitId, organizationId, isActive: true },
      select: { id: true, companyId: true },
    });
    if (!unit) reject('La unidad de negocio no existe o no esta activa en tu organizacion');
    unitCompanyId = unit.companyId;
  }

  let teamUnitId: string | null | undefined;
  if (teamId) {
    const team = await db.team.findFirst({
      where: { id: teamId, organizationId, isActive: true },
      select: { businessUnitId: true },
    });
    if (!team) reject('El equipo no existe o no esta activo en tu organizacion');
    teamUnitId = team.businessUnitId;
  }

  if (assignedTo) {
    const user = await db.user.findFirst({
      where: { id: assignedTo, organizationId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!user) reject('El responsable asignado no es un usuario activo de tu organizacion');
  }

  // team ↔ unit, when this write touches either side and both end up set.
  const touchesTeamOrUnit = teamId !== undefined || businessUnitId !== undefined;
  if (touchesTeamOrUnit && effective.teamId && effective.businessUnitId) {
    if (teamUnitId === undefined) {
      // The team is the vacancy's CURRENT one (the write changed only the unit).
      const current = await db.team.findFirst({
        where: { id: effective.teamId, organizationId },
        select: { businessUnitId: true },
      });
      teamUnitId = current?.businessUnitId ?? null;
    }
    if (teamUnitId !== effective.businessUnitId) {
      reject(
        teamId
          ? 'El equipo no pertenece a la unidad de negocio de la vacante'
          : 'El equipo actual de la vacante no pertenece a la nueva unidad de negocio; cambia o quita el equipo',
      );
    }
  }

  // unit ↔ company, same rule.
  const touchesUnitOrCompany = businessUnitId !== undefined || companyId !== undefined;
  if (touchesUnitOrCompany && effective.businessUnitId && effective.companyId) {
    if (unitCompanyId === undefined) {
      // The unit is the vacancy's CURRENT one (the write changed only the company).
      const current = await db.businessUnit.findFirst({
        where: { id: effective.businessUnitId, organizationId },
        select: { companyId: true },
      });
      unitCompanyId = current?.companyId ?? null;
    }
    if (unitCompanyId !== effective.companyId) {
      reject('La unidad de negocio no pertenece a la empresa de la vacante');
    }
  }
}

/** Create: the effective anchors are exactly the input's. */
export async function assertVacancyPlacement(organizationId: string, placement: VacancyPlacement): Promise<void> {
  await assertPlacement(organizationId, placement, {
    companyId: placement.companyId ?? null,
    businessUnitId: placement.businessUnitId ?? null,
    teamId: placement.teamId ?? null,
  });
}

/**
 * Update: an anchor the input omits keeps its CURRENT value, so e.g. a unit-only change is checked against
 * the vacancy's current team (a mismatch is rejected, not silently cleared: the caller must change or clear
 * the team explicitly in the same write).
 */
export async function assertVacancyUpdatePlacement(
  organizationId: string,
  vacancyId: string,
  placement: VacancyPlacement,
): Promise<void> {
  const touchesAnchors =
    placement.companyId !== undefined || placement.businessUnitId !== undefined || placement.teamId !== undefined;
  if (!touchesAnchors && !placement.assignedTo) return;

  let current: EffectiveAnchors = { companyId: null, businessUnitId: null, teamId: null };
  if (touchesAnchors) {
    const row = await db.vacancy.findFirst({
      where: { id: vacancyId, organizationId, deletedAt: null },
      select: { companyId: true, businessUnitId: true, teamId: true },
    });
    current = {
      companyId: row?.companyId ?? null,
      businessUnitId: row?.businessUnitId ?? null,
      teamId: row?.teamId ?? null,
    };
  }

  await assertPlacement(organizationId, placement, {
    companyId: placement.companyId !== undefined ? placement.companyId : current.companyId,
    businessUnitId: placement.businessUnitId !== undefined ? placement.businessUnitId : current.businessUnitId,
    teamId: placement.teamId !== undefined ? placement.teamId : current.teamId,
  });
}
