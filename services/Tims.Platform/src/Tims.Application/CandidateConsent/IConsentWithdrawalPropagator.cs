namespace Tims.Application.CandidateConsent;

/// <summary>
/// Post-commit hook of a #312 withdrawal: drives what the withdrawal's own transaction staged to external processors
/// (today the assessment provider, owner default D15). It never throws and never fails the withdrawal, which is
/// already committed; what it cannot finish stays staged and is retried.
/// </summary>
public interface IConsentWithdrawalPropagator
{
    Task PropagateAsync(Guid organizationId, DateTimeOffset now, CancellationToken cancellationToken);
}

/// <summary>No external processor is enabled.</summary>
public sealed class NoConsentWithdrawalPropagator : IConsentWithdrawalPropagator
{
    public Task PropagateAsync(Guid organizationId, DateTimeOffset now, CancellationToken cancellationToken) => Task.CompletedTask;
}
