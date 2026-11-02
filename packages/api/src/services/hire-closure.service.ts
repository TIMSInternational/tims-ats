import type { Prisma } from '@tims/db';

// Closes the recruitment records a confirmed hire leaves open. Runs INSIDE the convert-to-employee
// transaction so the hire, the application and the vacancy commit (or roll back) together.
//
// - The hired application leaves the active pipeline: status 'hired', moved to the vacancy's last stage
//   (the "Contratado" stage in the default pipeline), with the move recorded in the stage history.
// - The vacancy closes once its converted offers cover every position. Only approved/published vacancies
//   close; a draft, frozen or already-closed vacancy is left as it is.

export const HIRE_STAGE_MOVE_REASON = 'Contratación confirmada';
export const VACANCY_FILLED_REASON = 'Vacante cubierta';
const CLOSABLE_VACANCY_STATUSES = ['approved', 'published'];

export type HireClosureInput = {
  organizationId: string;
  vacancyId: string;
  applicationId: string | null;
  hiredById: string;
};

export type HireClosureResult = { applicationClosed: boolean; vacancyClosed: boolean };

export async function closeHireRecords(
  tx: Prisma.TransactionClient,
  input: HireClosureInput,
): Promise<HireClosureResult> {
  const { organizationId, vacancyId, applicationId, hiredById } = input;
  let applicationClosed = false;

  if (applicationId) {
    const application = await tx.application.findFirst({
      where: { id: applicationId, organizationId, vacancyId },
      select: { id: true, status: true, currentStageId: true },
    });
    if (application && application.status === 'active') {
      const finalStage = await tx.pipelineStage.findFirst({
        where: { vacancyId, organizationId },
        orderBy: { order: 'desc' },
        select: { id: true },
      });
      await tx.application.update({
        where: { id: application.id },
        data: { status: 'hired', ...(finalStage ? { currentStageId: finalStage.id } : {}) },
        select: { id: true },
      });
      if (finalStage && finalStage.id !== application.currentStageId) {
        await tx.stageMovement.create({
          data: {
            organizationId,
            applicationId: application.id,
            fromStageId: application.currentStageId,
            toStageId: finalStage.id,
            movedBy: hiredById,
            reason: HIRE_STAGE_MOVE_REASON,
          },
          select: { id: true },
        });
      }
      applicationClosed = true;
    }
  }

  let vacancyClosed = false;
  const vacancy = await tx.vacancy.findFirst({
    where: { id: vacancyId, organizationId },
    select: { positions: true, status: true },
  });
  if (vacancy && CLOSABLE_VACANCY_STATUSES.includes(vacancy.status)) {
    const hires = await tx.offer.count({ where: { vacancyId, organizationId, status: 'converted' } });
    if (hires >= Math.max(1, vacancy.positions)) {
      const closed = await tx.vacancy.updateMany({
        where: { id: vacancyId, organizationId, status: { in: CLOSABLE_VACANCY_STATUSES } },
        data: { status: 'closed', closedAt: new Date(), closedReason: VACANCY_FILLED_REASON },
      });
      vacancyClosed = closed.count === 1;
    }
  }

  return { applicationClosed, vacancyClosed };
}
