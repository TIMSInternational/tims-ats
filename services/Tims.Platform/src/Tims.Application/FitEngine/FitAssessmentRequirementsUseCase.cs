using System.Text.Json.Nodes;
using Tims.Domain.FitEngine;

namespace Tims.Application.FitEngine;

/// <summary>A vacancy's stored <c>assessments[]</c> (raw jsonb text, null when absent) and its version token.</summary>
public sealed record StoredAssessmentRequirements(string? AssessmentsJson, string Version);

/// <summary>
/// The conditional replace's outcome: <see cref="Written"/> false means the stored version was no longer the expected
/// one (nothing written); either way the CURRENT stored array and version come back.
/// </summary>
public sealed record AssessmentRequirementsWriteResult(bool Written, string? AssessmentsJson, string Version);

/// <summary>
/// Persistence of the vacancy assessments editor: <c>job_profiles.fit_requirements -&gt; 'assessments'</c> only. The other
/// keys (the v1 requirements the requirements card owns) are never read or written here.
/// </summary>
public interface IFitAssessmentRequirementsRepository
{
    /// <summary>The stored array and its version (<c>md5</c> of the jsonb text; the version of "absent" when none).</summary>
    Task<StoredAssessmentRequirements> ReadAsync(Guid organizationId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary>
    /// In ONE transaction under the tenant scope: locks the vacancy's profile row (<c>FOR UPDATE</c>), and replaces only
    /// its <c>assessments</c> key with <paramref name="assessmentsJson"/> when the stored version still equals
    /// <paramref name="expectedVersion"/>; a missing row is inserted only when the editor read "absent", and a concurrent
    /// insert loses (<c>ON CONFLICT DO NOTHING</c>). Marks the transaction as a FIT v2-aware writer, which the
    /// <c>job_profiles_keep_assessments</c> trigger requires.
    /// </summary>
    Task<AssessmentRequirementsWriteResult> ReplaceAsync(
        Guid organizationId, Guid vacancyId, string assessmentsJson, string expectedVersion, DateTimeOffset now,
        CancellationToken cancellationToken);
}

public enum AssessmentRequirementsOutcome
{
    Saved,
    Invalid,

    /// <summary>Another writer changed the array after the editor read it: nothing written, the current one returned.</summary>
    Conflict,
}

/// <summary>The array an editor shows, its version, and the findings (stored entries the parser drops, or notes).</summary>
public sealed record AssessmentRequirementsView(
    IReadOnlyList<AssessmentRequirement> Assessments, string Version, IReadOnlyList<FitRequirementIssue> Issues);

public sealed record AssessmentRequirementsReplace(
    AssessmentRequirementsOutcome Outcome, AssessmentRequirementsView? View, string? Error,
    IReadOnlyList<FitRequirementIssue> Issues);

/// <summary>
/// The vacancy assessments editor's read and write (FIT v2, <c>fit_requirements.assessments[]</c>). The read shows the
/// entries exactly as FIT v2 parses them (so an entry FIT would ignore is reported, not shown as configured); the write
/// is strict (<see cref="FitAssessmentRequirementsInput"/>) and conditional on the version the editor read, so two HR
/// users editing the same vacancy can never silently overwrite each other.
/// </summary>
public sealed class FitAssessmentRequirementsUseCase(IFitAssessmentRequirementsRepository repository)
{
    private readonly IFitAssessmentRequirementsRepository _repository = repository;

    public async Task<AssessmentRequirementsView> GetAsync(
        Guid organizationId, Guid vacancyId, bool liaScoredAllowed, CancellationToken cancellationToken)
    {
        var stored = await _repository.ReadAsync(organizationId, vacancyId, cancellationToken).ConfigureAwait(false);
        return ToView(stored.AssessmentsJson, stored.Version, liaScoredAllowed);
    }

    public async Task<AssessmentRequirementsReplace> ReplaceAsync(
        Guid organizationId, Guid vacancyId, JsonNode? body, bool liaScoredAllowed, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (FitAssessmentRequirementsInput.Validate(body, liaScoredAllowed, out var error, out var issues) is not { } write)
        {
            return new AssessmentRequirementsReplace(AssessmentRequirementsOutcome.Invalid, null, error, issues);
        }

        var result = await _repository.ReplaceAsync(
                organizationId, vacancyId, write.Assessments.ToJsonString(), write.ExpectedVersion, now, cancellationToken)
            .ConfigureAwait(false);
        var view = ToView(result.AssessmentsJson, result.Version, liaScoredAllowed);
        return result.Written
            ? new AssessmentRequirementsReplace(AssessmentRequirementsOutcome.Saved, view with { Issues = write.Issues }, null, write.Issues)
            : new AssessmentRequirementsReplace(AssessmentRequirementsOutcome.Conflict, view, "requirements_changed", []);
    }

    private static AssessmentRequirementsView ToView(string? assessmentsJson, string version, bool liaScoredAllowed)
    {
        if (assessmentsJson is null || JsonNode.Parse(assessmentsJson) is not JsonArray entries)
        {
            return new AssessmentRequirementsView([], version, []);
        }

        var (kept, found) = FitRequirementsInput.NormalizeAssessments(entries, liaScoredAllowed);
        var parsed = FitV2Kernels.ParseAssessmentRequirements(new JsonObject { ["assessments"] = kept }) ?? [];
        return new AssessmentRequirementsView(parsed, version, found);
    }
}
