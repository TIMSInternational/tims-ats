namespace Tims.Application.Assessments.Providers;

/// <summary>The outcome of one sweep: organizations visited, attempts confirmed, organizations whose pass failed.</summary>
public sealed record WithdrawalSweep(int Organizations, int Confirmed, int FailedOrganizations);

/// <summary>One scheduled retry of every organization's pending #312 withdrawal cascade.</summary>
public interface IProviderWithdrawalSweep
{
    Task<WithdrawalSweep> RunAsync(DateTimeOffset now, CancellationToken cancellationToken);
}

/// <summary>
/// The durable retry of the #312 withdrawal cascade (D15, D17). A cascade pass runs after each withdrawal, on every
/// webhook for an attempt in the cascade, and on a launch that sees a withdrawal. Without this sweep, an attempt left
/// <c>pending</c> by a provider outage, an unconfirmed 404 or a consent capture still in flight could wait forever for
/// one of those triggers: a completed assignment never emits another webhook, and its provider consent would stay
/// active. The sweep needs no trigger:
/// <list type="bullet">
/// <item>it lists, pre-tenant, the organizations holding pending attempts, and propagates each under its own tenant
/// scope with <see cref="ProviderConsentWithdrawalUseCase.PropagateAsync"/> (every write there is conditional, so two
/// instances sweeping at once, or a sweep racing a webhook's pass, cannot complete an attempt wrongly);</item>
/// <item>an organization with more pending attempts than one pass takes is propagated again while the previous pass made
/// progress, up to <see cref="MaxPassesPerOrganization"/> passes per sweep;</item>
/// <item>a failing organization never stops the others; its attempts stay pending for the next sweep.</item>
/// </list>
/// </summary>
public sealed class ProviderWithdrawalSweepUseCase(
    IAssessmentProviderRepository repository, ProviderConsentWithdrawalUseCase cascade) : IProviderWithdrawalSweep
{
    public const int MaxOrganizations = 200;
    public const int MaxPassesPerOrganization = 20;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly ProviderConsentWithdrawalUseCase _cascade = cascade;

    public async Task<WithdrawalSweep> RunAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        var organizations = await _repository.ListOrganizationsWithPendingWithdrawalsAsync(MaxOrganizations, cancellationToken)
            .ConfigureAwait(false);
        var confirmed = 0;
        var failed = 0;
        foreach (var organizationId in organizations)
        {
            try
            {
                for (var pass = 0; pass < MaxPassesPerOrganization; pass++)
                {
                    var outcome = await _cascade.PropagateAsync(organizationId, now, cancellationToken).ConfigureAwait(false);
                    confirmed += outcome.Confirmed;
                    if (outcome.Confirmed == 0 || outcome.StillPending > 0)
                    {
                        // No progress, or this pass left work it could not finish (blocked): retried by the next sweep.
                        break;
                    }
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                failed++;
            }
        }

        return new WithdrawalSweep(organizations.Count, confirmed, failed);
    }
}
