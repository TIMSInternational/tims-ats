using Microsoft.EntityFrameworkCore.Infrastructure;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.Infrastructure.CandidateConsent;

/// <summary>
/// Runs INSIDE a #312 withdrawal's transaction, under the per-candidate lock it holds, so what other modules must stop
/// doing for the candidate changes in the same commit as the consent row. Returns how many rows it staged.
/// </summary>
public interface IConsentWithdrawalCascade
{
    Task<int> StageAsync(
        DatabaseFacade database, Guid organizationId, Guid candidateId, DateTime timestamp, CancellationToken cancellationToken);
}

/// <summary>No module needs staging (the provider connector is off, and its tables may not exist).</summary>
public sealed class NoConsentWithdrawalCascade : IConsentWithdrawalCascade
{
    public Task<int> StageAsync(
        DatabaseFacade database, Guid organizationId, Guid candidateId, DateTime timestamp, CancellationToken cancellationToken) =>
        Task.FromResult(0);
}

/// <summary>
/// Owner default D15 (2026-11-08): the withdrawal reaches the assessment provider's attempts atomically
/// (<see cref="ProviderWithdrawalSql"/>). Registered only when <c>Platform:AssessmentProvidersEnabled</c> is on, which
/// requires the provider migration to be applied first.
/// </summary>
public sealed class ProviderConsentWithdrawalCascade : IConsentWithdrawalCascade
{
    public Task<int> StageAsync(
        DatabaseFacade database, Guid organizationId, Guid candidateId, DateTime timestamp, CancellationToken cancellationToken) =>
        ProviderWithdrawalSql.StageAsync(database, organizationId, candidateId, timestamp, cancellationToken);
}
