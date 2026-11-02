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
  candidateId: string;
  hiredById: string;
};

/** The candidate's application for this vacancy was rejected; the hire must not complete. */
export class HireRejectedApplicationError extends Error {
  constructor() {
    super('hire refused: the application was rejected');
    this.name = 'HireRejectedApplicationError';
  }
}

export type HireClosureResult = { applicationClosed: boolean; vacancyClosed: boolean };

export async function closeHireRecords(
  tx: Prisma.TransactionClient,
  input: HireClosureInput,
): Promise<HireClosureResult> {
  const { organizationId, vacancyId, applicationId, candidateId, hiredById } = input;
  let applicationClosed = false;

  // The offer's linked application, or — when the offer was created without the link — the candidate's
  // applications for this vacancy. A hire for a candidate whose application(s) were rejected is refused, and
  // because this runs inside the hire transaction the refusal rolls back the whole conversion.
  const applications = await tx.application.findMany({
    where: applicationId
      ? { id: applicationId, organizationId, vacancyId }
      : { organizationId, vacancyId, candidateId },
    select: { id: true, status: true, currentStageId: true },
  });
  if (
    applications.length > 0 &&
    applications.every((candidateApplication) => candidateApplication.status === 'rejected')
  ) {
    throw new HireRejectedApplicationError();
  }
  const application = applications.find((candidateApplication) => candidateApplication.status === 'active');
  if (application) {
    const finalStage = await tx.pipelineStage.findFirst({
      where: { vacancyId, organizationId },
      orderBy: { order: 'desc' },
      select: { id: true },
    });
    // Conditional transition: only an application that is STILL active becomes hired. Postgres re-checks
    // the WHERE after waiting on a concurrent writer's row lock, so a rejection that commits first makes
    // this match 0 rows — then the hire is refused (rolled back). The reject writer is conditional the
    // same way, so a hire that commits first makes the rejection fail instead.
    const transitioned = await tx.application.updateMany({
      where: { id: application.id, organizationId, status: 'active' },
      data: { status: 'hired', ...(finalStage ? { currentStageId: finalStage.id } : {}) },
    });
    if (transitioned.count !== 1) {
      const current = await tx.application.findFirst({
        where: { id: application.id, organizationId },
        select: { status: true },
      });
      if (current?.status === 'rejected') throw new HireRejectedApplicationError();
    } else {
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
  // Lock the vacancy row BEFORE counting conversions. Two hires on different offers of the same vacancy
  // otherwise each count only their own (uncommitted) conversion under READ COMMITTED, both skip the
  // closure, and a fully staffed vacancy stays published. With the lock, the second transaction waits for
  // the first to commit, and its count (a new statement) then sees the first hire.
  // FOR NO KEY UPDATE, not FOR UPDATE: the hire snapshot inserted earlier in this transaction holds a
  // FOR KEY SHARE lock on the vacancy through its foreign key. FOR UPDATE conflicts with KEY SHARE, so two
  // concurrent hires would deadlock; NO KEY UPDATE is compatible with KEY SHARE but still serializes with
  // itself (and with the status update below, which takes the same lock mode).
  const locked = await tx.$queryRaw<Array<{ positions: number; status: string }>>`
    SELECT positions, status FROM vacancies
    WHERE id = ${vacancyId}::uuid AND organization_id = ${organizationId}::uuid
    FOR NO KEY UPDATE`;
  const vacancy = locked[0];
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
