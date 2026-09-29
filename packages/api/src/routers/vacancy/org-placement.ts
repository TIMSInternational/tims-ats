import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export interface VacancyPlacement {
  /** undefined = not provided; null = cleared (nothing to verify). */
  businessUnitId?: string | null;
  teamId?: string | null;
  assignedTo?: string | null;
}

function reject(message: string): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message });
}

/**
 * Verifies the org anchors a vacancy write sets (business unit, team, assignee) belong to the caller's
 * organization and are active, and that the team belongs to the effective business unit. Without this,
 * a crafted request could point a vacancy at another tenant's unit/team/user (the FK alone accepts it),
 * which then feeds the team/unit approval-scope anchors.
 *
 * `effectiveBusinessUnitId` is the unit the team must belong to: the input's unit on create, or on
 * update the input's unit when provided, else the vacancy's current one. Null = no unit constraint.
 */
export async function assertVacancyPlacement(
  organizationId: string,
  placement: VacancyPlacement,
  effectiveBusinessUnitId: string | null,
): Promise<void> {
  const { businessUnitId, teamId, assignedTo } = placement;

  if (businessUnitId) {
    const unit = await db.businessUnit.findFirst({
      where: { id: businessUnitId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!unit) reject('La unidad de negocio no existe o no esta activa en tu organizacion');
  }

  if (teamId) {
    const team = await db.team.findFirst({
      where: { id: teamId, organizationId, isActive: true },
      select: { businessUnitId: true },
    });
    if (!team) reject('El equipo no existe o no esta activo en tu organizacion');
    if (effectiveBusinessUnitId && team.businessUnitId !== effectiveBusinessUnitId) {
      reject('El equipo no pertenece a la unidad de negocio de la vacante');
    }
  }

  if (assignedTo) {
    const user = await db.user.findFirst({
      where: { id: assignedTo, organizationId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!user) reject('El responsable asignado no es un usuario activo de tu organizacion');
  }
}

/** Update variant: the team is checked against the input's unit if provided, else the vacancy's current unit. */
export async function assertVacancyUpdatePlacement(
  organizationId: string,
  vacancyId: string,
  placement: VacancyPlacement,
): Promise<void> {
  if (!placement.businessUnitId && !placement.teamId && !placement.assignedTo) return;
  let effective = placement.businessUnitId ?? null;
  if (placement.teamId && placement.businessUnitId === undefined) {
    const current = await db.vacancy.findFirst({
      where: { id: vacancyId, organizationId, deletedAt: null },
      select: { businessUnitId: true },
    });
    effective = current?.businessUnitId ?? null;
  }
  await assertVacancyPlacement(organizationId, placement, effective);
}
