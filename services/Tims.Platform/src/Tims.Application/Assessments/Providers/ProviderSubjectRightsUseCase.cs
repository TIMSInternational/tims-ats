namespace Tims.Application.Assessments.Providers;

public enum ProviderErasureOutcome
{
    /// <summary>Every provider subject of the candidate has an accepted erasure (or none existed).</summary>
    Requested,
    CandidateNotFound,
    ProviderUnconfigured,

    /// <summary>At least one subject's erasure could not be requested; the others are recorded. Retrying is safe.</summary>
    Incomplete,
}

public sealed record ProviderErasureResult(ProviderErasureOutcome Outcome, int Subjects, int Requested);

/// <summary>
/// Data-subject rights over the provider connector (owner default D15, 2026-11-08), on the C# path (the survival rule):
/// <list type="bullet">
/// <item><b>Access.</b> The ATS's own provider tables for one candidate (attempts and stored results), returned with a
/// fail-closed audit row. What the PROVIDER holds (media, its access log) is its own <c>GET /v1/subjects/{id}/export</c>,
/// which needs the <c>subjects:export</c> scope and is not called here.</item>
/// <item><b>Erasure.</b> ATS-initiated: <c>DELETE /v1/subjects/{id}</c> for every provider subject of the candidate. The
/// provider erases asynchronously and then emits <c>subject.erased</c>, whose existing handler deletes the ATS's stored
/// results. From the accepted request on, no result is fetched or stored for those attempts.</item>
/// </list>
/// </summary>
public sealed class ProviderSubjectRightsUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    public Task<ProviderSubjectExport?> ExportAsync(
        Guid organizationId, Guid candidateId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.ExportCandidateAsync(organizationId, candidateId, actorId, now, cancellationToken);

    public async Task<ProviderErasureResult> EraseAsync(
        Guid organizationId, Guid candidateId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var subjects = await _repository.ListProviderSubjectsAsync(organizationId, candidateId, cancellationToken)
            .ConfigureAwait(false);
        if (subjects is null)
        {
            return new ProviderErasureResult(ProviderErasureOutcome.CandidateNotFound, 0, 0);
        }

        if (subjects.Count > 0 && !_provider.IsConfigured)
        {
            return new ProviderErasureResult(ProviderErasureOutcome.ProviderUnconfigured, subjects.Count, 0);
        }

        var requested = 0;
        foreach (var subject in subjects)
        {
            var erased = await _provider.EraseSubjectAsync(subject, cancellationToken).ConfigureAwait(false);
            string? status = erased.Ok ? erased.Value!.Status : erased.Failure!.HttpStatus switch
            {
                410 => "already_erased",
                404 => "not_found",
                _ => null,
            };
            if (status is null)
            {
                continue;
            }

            await _repository.MarkErasureRequestedAsync(organizationId, candidateId, subject, status, actorId, now, cancellationToken)
                .ConfigureAwait(false);
            requested++;
        }

        return new ProviderErasureResult(
            requested == subjects.Count ? ProviderErasureOutcome.Requested : ProviderErasureOutcome.Incomplete,
            subjects.Count, requested);
    }
}
