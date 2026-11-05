import { runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { vacancyHireRepository } from './vacancy-hire.repository';
import { isVacancyFilled } from '../services/hire-closure.service';

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

export type ResumeStatus = 'published' | 'approved' | 'pending_approval' | 'draft';

export type ResumeResult =
  | { kind: 'not_frozen' }
  | { kind: 'not_resumable' }
  | { kind: 'filled'; hires: number; positions: number }
  | { kind: 'resumed'; vacancy: VacancyLifecycleRow; status: ResumeStatus };

/** What a frozen vacancy carries about the state it was frozen from. */
export interface FrozenVacancyFacts {
  closedAt: Date | null;
  hasPublishedChannel: boolean;
  /** Its approval rows, any order. Rows written by one submitForApproval share one createdAt (one transaction). */
  approvals: ReadonlyArray<{ status: string; createdAt: Date }>;
}

/**
 * The status a frozen vacancy returns to, or null when it must not be resumed. Freeze now requires
 * `published`, but rows frozen before that could have come from any status, so the target is derived from
 * evidence and fails closed (never a status that skips an approval):
 *  - closed before it was frozen (closedAt set) -> not resumable (a filled or cancelled process stays closed);
 *  - a still-published channel -> `published` (publishing needs an approved vacancy);
 *  - otherwise the LATEST approval request decides: a pending step -> `pending_approval` (its chain is live
 *    again), every step approved -> `approved`;
 *  - anything else (no request, rejected, withdrawn) -> `draft`, which must go through approval.
 */
export function resumeTargetFor(facts: FrozenVacancyFacts): ResumeStatus | null {
  if (facts.closedAt !== null) return null;
  if (facts.hasPublishedChannel) return 'published';
  if (facts.approvals.length === 0) return 'draft';
  const latest = Math.max(...facts.approvals.map((a) => a.createdAt.getTime()));
  const cycle = facts.approvals.filter((a) => a.createdAt.getTime() === latest);
  if (cycle.some((a) => a.status === 'pending')) return 'pending_approval';
  if (cycle.every((a) => a.status === 'approved')) return 'approved';
  return 'draft';
}

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
   * A vacancy with a still-pending approval step is never edited either: only a legacy row frozen in the
   * middle of a request has one outside pending_approval, and resuming it revives that chain (Codex P1), so
   * an edit would let the remaining approvers sign off content the earlier ones never saw.
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
        where: {
          id: vacancyId,
          organizationId,
          deletedAt: null,
          status: { in: [...VACANCY_EDITABLE_STATUSES] },
          approvals: { none: { status: 'pending' } },
        },
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
   * frozen -> back where it was (resumeTargetFor). A vacancy frozen by today's freeze was published and
   * keeps its published channels, so it returns to `published`: back on the careers portal and in the
   * pipeline selector. Resuming never skips an approval.
   */
  resume(organizationId: string, vacancyId: string, actor: VacancyLifecycleActor): Promise<ResumeResult> {
    return runTenantTransaction(organizationId, async (tx) => {
      // A hire leaves a FROZEN vacancy's status alone (hire-closure closes only published ones), so its
      // positions can fill while it is frozen. Take the hire path's vacancy lock and count first: a vacancy
      // whose hires already cover its positions is never reopened, and a hire racing this resume serializes
      // on the same row lock (Codex review of release/pilot-ux-wave2).
      const counts = await vacancyHireRepository.lockAndCount(tx, organizationId, vacancyId);
      const frozen = await tx.vacancy.findFirst({
        where: { id: vacancyId, organizationId, deletedAt: null, status: 'frozen' },
        select: {
          id: true,
          closedAt: true,
          channels: { where: { status: 'published' }, select: { id: true }, take: 1 },
          approvals: { select: { status: true, createdAt: true } },
        },
      });
      if (!frozen) return { kind: 'not_frozen' } as const;
      const status = resumeTargetFor({
        closedAt: frozen.closedAt,
        hasPublishedChannel: frozen.channels.length > 0,
        approvals: frozen.approvals,
      });
      if (status === null) return { kind: 'not_resumable' } as const;
      if (counts && isVacancyFilled(counts.hires, counts.positions)) {
        return { kind: 'filled', hires: counts.hires, positions: counts.positions } as const;
      }

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
