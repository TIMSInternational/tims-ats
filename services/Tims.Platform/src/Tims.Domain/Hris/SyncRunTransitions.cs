namespace Tims.Domain.Hris;

/// <summary>
/// The guarded state machine for a sync run (pure, unit-testable). Legal edges:
/// <list type="bullet">
///   <item><c>Pending → Running</c> — the run is picked up and starts.</item>
///   <item><c>Running → Succeeded | Failed | Partial</c> — the run reaches a terminal outcome.</item>
/// </list>
/// The three terminal states (<c>Succeeded</c>, <c>Failed</c>, <c>Partial</c>) are FINAL: any edge out
/// of them — or any other unlisted edge (e.g. skipping <c>Running</c>) — is invalid and throws
/// <see cref="InvalidSyncRunTransitionException"/>. This encodes the idempotency invariant the sync
/// use case (Slice 3) relies on: a completed run can never be re-driven.
/// </summary>
public static class SyncRunTransitions
{
    /// <summary>The terminal outcomes — a run in one of these can never transition again.</summary>
    public static bool IsTerminal(SyncRunStatus status) =>
        status is SyncRunStatus.Succeeded or SyncRunStatus.Failed or SyncRunStatus.Partial;

    /// <summary>True only for the legal edges above; every other pairing is false.</summary>
    public static bool CanTransition(SyncRunStatus from, SyncRunStatus to) => (from, to) switch
    {
        (SyncRunStatus.Pending, SyncRunStatus.Running) => true,
        (SyncRunStatus.Running, SyncRunStatus.Succeeded) => true,
        (SyncRunStatus.Running, SyncRunStatus.Failed) => true,
        (SyncRunStatus.Running, SyncRunStatus.Partial) => true,
        _ => false,
    };

    /// <summary>
    /// Guard: returns <paramref name="to"/> if the transition is legal, else throws
    /// <see cref="InvalidSyncRunTransitionException"/>. Callers advancing a run use this so an
    /// illegal move fails loudly at the domain boundary rather than corrupting the run's state.
    /// </summary>
    public static SyncRunStatus EnsureCanTransition(SyncRunStatus from, SyncRunStatus to) =>
        CanTransition(from, to)
            ? to
            : throw new InvalidSyncRunTransitionException(from, to);
}
