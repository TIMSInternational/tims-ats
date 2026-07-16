namespace Tims.Domain.Hris;

/// <summary>
/// Base type for HRIS domain-invariant violations (pure, framework-free). Thrown when a caller tries
/// to drive the domain into an impossible state — caught/translated by the application layer.
/// </summary>
public class HrisDomainException : Exception
{
    public HrisDomainException(string message)
        : base(message)
    {
    }

    public HrisDomainException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

/// <summary>
/// Thrown when a sync run is asked to move between two states the state machine forbids
/// (<see cref="SyncRunTransitions"/>) — e.g. re-running a terminal run, or skipping <c>Running</c>.
/// </summary>
public sealed class InvalidSyncRunTransitionException(SyncRunStatus from, SyncRunStatus to)
    : HrisDomainException($"Invalid sync-run transition: {from.ToWire()} → {to.ToWire()}.")
{
    public SyncRunStatus From { get; } = from;

    public SyncRunStatus To { get; } = to;
}
