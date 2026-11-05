import { runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';

// ---------------------------------------------------------------------------
// Vacancy lifecycle repository: edit, freeze ("Congelar") and resume ("Reanudar"). Each write is a
// compare-and-set on the vacancy status inside ONE runTenantTransaction (tenantDb.$transaction does not
// compose, #45), together with its audit row, so a concurrent approve/close/hire either wins or loses whole.
// ---------------------------------------------------------------------------

/**
 * Statuses whose content may be edited. Not `pending_approval` (the approver is deciding on what was
 * submitted: withdraw the request first) and not `closed` (a finished process).
 */
export const VACANCY_EDITABLE_STATUSES = ['draft', 'approved', 'published', 'frozen'] as const;

/** Only a vacancy that is live on the careers portal can be frozen. */
export const VACANCY_FREEZABLE_STATUS = 'published';

export const vacancyLifecycleSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  positions: true,
  createdAt: true,
} satisfies Prisma.VacancySelect;

export type VacancyLifecycleRow = Prisma.VacancyGetPayload<{ select: typeof vacancyLifecycleSelect }>;

/** Who acted: the signed-in user, and the real person behind an impersonated session. */
export interface VacancyLifecycleActor {
  userId: string;
  actorId: string;
}

export type ResumeResult =
  | { kind: 'not_frozen' }
  | { kind: 'resumed'; vacancy: VacancyLifecycleRow; status: 'published' | 'approved' };

type Tx = Parameters<Parameters<typeof runTenantTransaction>[1]>[0];

function writeAudit(
  tx: Tx,
  organizationId: string,
  actor: VacancyLifecycleActor,
  action: string,
  vacancyId: string,
  metadata: Prisma.InputJsonValue,
) {
  return tx.auditLog.create({
    data: {
      organizationId,
      userId: actor.userId,
      actorId: actor.actorId,
      action,
      entity: 'vacancy',
      entityId: vacancyId,
      metadata,
    },
  });
}

export const vacancyLifecycleRepository = {
  /**
   * Writes the edited fields while the vacancy is still in an editable status. Returns null when it is not
   * (pending approval, closed, deleted or gone). The audit row names the changed fields, never their values.
   */
  updateContent(
    organizationId: string,
    vacancyId: string,
    data: Prisma.VacancyUncheckedUpdateManyInput,
    fields: string[],
    actor: VacancyLifecycleActor,
  ): Promise<VacancyLifecycleRow | null> {
    return runTenantTransaction(organizationId, async (tx) => {
      const moved = await tx.vacancy.updateMany({
        where: { id: vacancyId, organizationId, deletedAt: null, status: { in: [...VACANCY_EDITABLE_STATUSES] } },
        data,
      });
      if (moved.count !== 1) return null;
      await writeAudit(tx, organizationId, actor, 'vacancy_updated', vacancyId, { fields });
      return tx.vacancy.findFirstOrThrow({ where: { id: vacancyId, organizationId }, select: vacancyLifecycleSelect });
    });
  },

  /** published -> frozen. Returns null when the vacancy is not published (already frozen, closed, a draft...). */
  freeze(organizationId: string, vacancyId: string, actor: VacancyLifecycleActor): Promise<VacancyLifecycleRow | null> {
    return runTenantTransaction(organizationId, async (tx) => {
      const moved = await tx.vacancy.updateMany({
        where: { id: vacancyId, organizationId, deletedAt: null, status: VACANCY_FREEZABLE_STATUS },
        data: { status: 'frozen' },
      });
      if (moved.count !== 1) return null;
      await writeAudit(tx, organizationId, actor, 'vacancy_frozen', vacancyId, { from: VACANCY_FREEZABLE_STATUS });
      return tx.vacancy.findFirstOrThrow({ where: { id: vacancyId, organizationId }, select: vacancyLifecycleSelect });
    });
  },

  /**
   * frozen -> back where it was. A vacancy reaches `published` only by publishing a channel, and freezing
   * leaves its channels untouched, so one still-published channel means it was live: it returns to
   * `published` (back on the careers portal and in the pipeline selector). A frozen vacancy with none never
   * went live and returns to `approved` (only possible for rows frozen before freeze required `published`).
   * Never to draft or pending_approval: resuming cannot skip an approval.
   */
  resume(organizationId: string, vacancyId: string, actor: VacancyLifecycleActor): Promise<ResumeResult> {
    return runTenantTransaction(organizationId, async (tx) => {
      const frozen = await tx.vacancy.findFirst({
        where: { id: vacancyId, organizationId, deletedAt: null, status: 'frozen' },
        select: { id: true, channels: { where: { status: 'published' }, select: { id: true }, take: 1 } },
      });
      if (!frozen) return { kind: 'not_frozen' } as const;
      const status = frozen.channels.length > 0 ? ('published' as const) : ('approved' as const);

      // Compare-and-set: a concurrent close or hire that committed after the read above wins.
      const moved = await tx.vacancy.updateMany({
        where: { id: vacancyId, organizationId, deletedAt: null, status: 'frozen' },
        data: { status },
      });
      if (moved.count !== 1) return { kind: 'not_frozen' } as const;
      await writeAudit(tx, organizationId, actor, 'vacancy_resumed', vacancyId, { to: status });
      const vacancy = await tx.vacancy.findFirstOrThrow({
        where: { id: vacancyId, organizationId },
        select: vacancyLifecycleSelect,
      });
      return { kind: 'resumed', vacancy, status } as const;
    });
  },
};
