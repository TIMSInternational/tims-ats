namespace Tims.Application.Hris;

/// <summary>
/// The Infrastructure-NEUTRAL signal that a concurrent invocation already inserted the run for the same
/// <c>(organization_id, connector_id, idempotency_key)</c> unique key — thrown by
/// <see cref="IHrisSyncRepository.CreatePendingRunAsync"/> when the insert hits the unique constraint.
/// The use case catches it, re-finds the winning run, and short-circuits (get-or-create) rather than
/// racing a competing run. Keeps the provider-specific unique-violation detection inside Infrastructure
/// while the Application reasons over this neutral type.
/// </summary>
public sealed class HrisSyncRunConflictException : Exception
{
    public HrisSyncRunConflictException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
