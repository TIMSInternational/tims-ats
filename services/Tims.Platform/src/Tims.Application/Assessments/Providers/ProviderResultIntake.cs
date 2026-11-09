using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>What one result fetch did: an inbox status, a reason code, and whether to retry later.</summary>
public sealed record ResultIntake(string Status, string? Code, bool Retry);

/// <summary>
/// Fetches one result with <c>GET /v1/results/{id}?audience=tenant_hr</c>, checks it belongs to the attempt, and stores
/// it through the repository's guarded, revision-ordered write. Shared by the <c>result.ready</c> webhook and the D17
/// poller, so a result reaches the ATS the same way whichever signal brought it.
/// </summary>
public static class ProviderResultIntake
{
    public static async Task<ResultIntake> FetchAndStoreAsync(
        IAssessmentProviderRepository repository, IAssessmentProvider provider, Guid organizationId, Guid providerTenantId,
        AttemptRow attempt, Guid resultId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(provider);
        ArgumentNullException.ThrowIfNull(attempt);
        var fetched = await provider.GetResultAsync(resultId, cancellationToken).ConfigureAwait(false);
        if (!fetched.Ok)
        {
            var failure = fetched.Failure!;
            if (failure.Transient || failure.Code == ProviderFailure.Unconfigured)
            {
                return new ResultIntake(InboxStatuses.Failed, failure.Code, true);
            }

            if (failure.Code == "result_not_visible")
            {
                // tenant_hr may see the status only: the attempt is finished, but there is nothing to store or score.
                await repository.AdvanceAttemptAsync(organizationId, attempt.Id, ProviderAttemptStates.ResultReady,
                    null, now, cancellationToken).ConfigureAwait(false);
                return new ResultIntake(InboxStatuses.Processed, failure.Code, false);
            }

            return failure.HttpStatus is 404 or 410
                ? new ResultIntake(InboxStatuses.Ignored, "result_gone", false)
                : new ResultIntake(InboxStatuses.Failed, failure.Code, false);
        }

        var result = fetched.Value!;
        var matches = result.ResultId == resultId
            && result.TenantId == providerTenantId
            && result.AssignmentId == attempt.ProviderAssignmentId
            && result.SubjectId == attempt.ProviderSubjectId
            && result.Instrument == attempt.Instrument
            && result.Purpose == "selection"
            && result.ExternalVacancyRef == attempt.VacancyId.ToString()
            && result.RenderedFor == "tenant_hr";
        if (!matches)
        {
            return new ResultIntake(InboxStatuses.Failed, "result_mismatch", false);
        }

        await repository.StoreResultAsync(organizationId, attempt, result, now, cancellationToken).ConfigureAwait(false);
        return new ResultIntake(InboxStatuses.Processed, null, false);
    }
}
