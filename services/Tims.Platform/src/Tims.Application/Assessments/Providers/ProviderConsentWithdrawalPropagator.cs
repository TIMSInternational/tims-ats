using Tims.Application.CandidateConsent;

namespace Tims.Application.Assessments.Providers;

/// <summary>
/// The #312 post-commit hook when the provider connector is enabled (D15): one propagation pass for the org. Any
/// failure is swallowed: the attempts stay <c>pending</c>, and the scheduled sweep (or the next webhook or withdrawal)
/// retries them.
/// </summary>
public sealed class ProviderConsentWithdrawalPropagator(ProviderConsentWithdrawalUseCase useCase) : IConsentWithdrawalPropagator
{
    public async Task PropagateAsync(Guid organizationId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        try
        {
            await useCase.PropagateAsync(organizationId, now, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Staged state is durable; a later pass retries it.
        }
    }
}
