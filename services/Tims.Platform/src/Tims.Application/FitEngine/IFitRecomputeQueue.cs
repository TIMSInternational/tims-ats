namespace Tims.Application.FitEngine;

/// <summary>
/// The FIT v2 recompute queue (<c>fit_recompute_requests</c>, migration 20261109100000_fit_v2_integrity). Database
/// triggers enqueue one request per (candidate, vacancy) whenever an input a FIT v2 row depends on changes (an
/// assignment's status, a result's score or grading, a proctoring session's severity or review, a provider attempt or
/// result), for vacancies configured for FIT v2. Every change bumps the request's sequence, so completing a request at
/// the sequence it was claimed at never loses a change that landed during the recompute.
/// </summary>
public interface IFitRecomputeQueue
{
    /// <summary>
    /// PRE-TENANT (the privileged connection, no TenantScope): the organizations holding at least one due request.
    /// Only organization ids leave this query.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListOrganizationsWithDueRequestsAsync(int max, CancellationToken cancellationToken);

    /// <summary>
    /// Under the organization's TenantScope: claims up to <paramref name="max"/> due requests (<c>FOR UPDATE SKIP
    /// LOCKED</c>), leasing each one (its <c>available_at</c> moves forward with exponential backoff and
    /// <c>attempts</c> counts the claim), so a second worker skips it and a crashed recompute is retried.
    /// </summary>
    Task<IReadOnlyList<FitRecomputeRequest>> ClaimAsync(Guid organizationId, int max, CancellationToken cancellationToken);

    /// <summary>Deletes the request if it is still at the claimed sequence; false when a newer change re-armed it.</summary>
    Task<bool> CompleteAsync(Guid organizationId, FitRecomputeRequest request, CancellationToken cancellationToken);

    /// <summary>Records why a recompute failed (an error kind, never data) on the request at the claimed sequence.</summary>
    Task RecordFailureAsync(
        Guid organizationId, FitRecomputeRequest request, string error, CancellationToken cancellationToken);
}

/// <summary>One claimed request: the pair to recompute, the sequence it was claimed at, and how many claims it has had.</summary>
public sealed record FitRecomputeRequest(Guid CandidateId, Guid VacancyId, long RequestSeq, int Attempts);

/// <summary>What one drain pass did.</summary>
public sealed record FitRecomputeOutcome(int Organizations, int Recomputed, int Skipped, int Failed, int FailedOrganizations);
