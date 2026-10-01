// In-memory model of ONE parent row (an offer or a vacancy) plus its approval rows, with the
// PostgreSQL READ COMMITTED semantics the approval-state races depend on:
//
//  - every transaction stages its writes privately and publishes them only on commit; a throw
//    discards them (runTenantTransaction);
//  - each statement reads the latest COMMITTED state plus the transaction's own staged writes;
//  - an UPDATE of the parent row takes a row lock held until commit/rollback. A second
//    transaction's UPDATE of that row blocks, and after the holder commits it re-evaluates its
//    WHERE predicate against the newly committed row (EvalPlanQual) - the behaviour a
//    compare-and-set on `status` relies on;
//  - every operation yields to the event loop first, so two concurrent procedures interleave
//    statement by statement instead of running back to back.
//
// Old-code shape it reproduces: approve() flipping its own row then COUNTing pending rows, with
// no parent lock, sees the other approver's still-pending row in both transactions (write skew)
// and neither moves the parent to approved.

type Where = Record<string, unknown>;

export interface ParentRow {
  id: string;
  organizationId: string;
  status: string;
  deletedAt: Date | null;
}

export interface ApprovalRow {
  id: string;
  organizationId: string;
  parentId: string;
  approverId: string;
  status: string;
}

interface Staged {
  parent?: Partial<ParentRow>;
  approvals: Map<string, Partial<ApprovalRow>>;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function createApprovalRaceStore(opts: {
  parentModel: 'offer' | 'vacancy';
  approvalModel: 'offerApproval' | 'vacancyApproval';
  parentKey: 'offerId' | 'vacancyId';
  parent: ParentRow;
  approvals: ApprovalRow[];
}) {
  const committed = {
    parent: { ...opts.parent },
    approvals: opts.approvals.map((a) => ({ ...a })),
  };
  let lockHolder: Staged | null = null;
  const lockWaiters: Array<() => void> = [];

  const viewParent = (tx: Staged | null): ParentRow => ({ ...committed.parent, ...(tx?.parent ?? {}) });
  const viewApprovals = (tx: Staged | null): ApprovalRow[] =>
    committed.approvals.map((a) => ({ ...a, ...(tx?.approvals.get(a.id) ?? {}) }));

  function matchParent(row: ParentRow, where: Where): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (k === 'deletedAt') return v === null ? row.deletedAt === null : true;
      return (row as unknown as Record<string, unknown>)[k] === v;
    });
  }

  function matchApproval(row: ApprovalRow, where: Where, tx: Staged | null): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (k === opts.parentKey) return row.parentId === v;
      if (k === opts.parentModel) return matchParent(viewParent(tx), v as Where);
      return (row as unknown as Record<string, unknown>)[k] === v;
    });
  }

  async function acquireParentLock(tx: Staged) {
    while (lockHolder !== null && lockHolder !== tx) {
      await new Promise<void>((resolve) => lockWaiters.push(resolve));
    }
    lockHolder = tx;
  }

  function releaseLock(tx: Staged) {
    if (lockHolder !== tx) return;
    lockHolder = null;
    const waiters = lockWaiters.splice(0);
    for (const w of waiters) w();
  }

  function parentFacade(tx: Staged | null) {
    return {
      updateMany: async ({ where, data }: { where: Where; data: Partial<ParentRow> }) => {
        await tick();
        if (!tx) throw new Error('parent writes must run inside a transaction in this model');
        await acquireParentLock(tx);
        // Re-evaluated AFTER acquiring the lock, against the newest committed row.
        if (!matchParent(viewParent(tx), where)) return { count: 0 };
        tx.parent = { ...(tx.parent ?? {}), ...data };
        return { count: 1 };
      },
      update: async ({ data }: { where: Where; data: Partial<ParentRow> }) => {
        await tick();
        if (!tx) throw new Error('parent writes must run inside a transaction in this model');
        await acquireParentLock(tx);
        tx.parent = { ...(tx.parent ?? {}), ...data };
        return viewParent(tx);
      },
      findFirstOrThrow: async () => {
        await tick();
        return { ...viewParent(tx), approvals: [], settings: {} };
      },
      findUniqueOrThrow: async () => {
        await tick();
        return { ...viewParent(tx), approvals: [], settings: {} };
      },
      findUnique: async () => {
        await tick();
        return { ...viewParent(tx), settings: {} };
      },
    };
  }

  function approvalFacade(tx: Staged | null) {
    return {
      findFirst: async ({ where }: { where: Where }) => {
        await tick();
        const row = viewApprovals(tx).find((a) => matchApproval(a, where, tx));
        return row ? { ...row } : null;
      },
      count: async ({ where }: { where: Where }) => {
        await tick();
        return viewApprovals(tx).filter((a) => matchApproval(a, where, tx)).length;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ApprovalRow> }) => {
        await tick();
        if (!tx) throw new Error('approval writes must run inside a transaction in this model');
        tx.approvals.set(where.id, { ...(tx.approvals.get(where.id) ?? {}), ...data });
        return { id: where.id };
      },
      updateMany: async ({ where, data }: { where: Where; data: Partial<ApprovalRow> }) => {
        await tick();
        if (!tx) throw new Error('approval writes must run inside a transaction in this model');
        const hits = viewApprovals(tx).filter((a) => matchApproval(a, where, tx));
        for (const a of hits) tx.approvals.set(a.id, { ...(tx.approvals.get(a.id) ?? {}), ...data });
        return { count: hits.length };
      },
    };
  }

  async function runTenantTransaction<T>(_org: string, fn: (tx: unknown) => Promise<T>): Promise<T> {
    const tx: Staged = { approvals: new Map() };
    const client = { [opts.parentModel]: parentFacade(tx), [opts.approvalModel]: approvalFacade(tx) };
    try {
      const result = await fn(client);
      if (tx.parent) committed.parent = { ...committed.parent, ...tx.parent };
      committed.approvals = committed.approvals.map((a) => ({ ...a, ...(tx.approvals.get(a.id) ?? {}) }));
      return result;
    } finally {
      releaseLock(tx);
    }
  }

  return {
    committed,
    runTenantTransaction,
    /** Non-transactional client (tenantDb): reads see committed state only. */
    db: { [opts.parentModel]: parentFacade(null), [opts.approvalModel]: approvalFacade(null) },
  };
}
