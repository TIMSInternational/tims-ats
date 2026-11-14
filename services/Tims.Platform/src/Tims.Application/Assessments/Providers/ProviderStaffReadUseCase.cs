using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Assessments.Providers;
using Tims.Domain.FitEngine;

namespace Tims.Application.Assessments.Providers;

/// <summary>A stored provider result, as the staff results view reads it (the latest revision on the attempt).</summary>
public sealed record StaffResultRecord(
    Guid ResultId,
    string Purpose,
    string InstrumentVersion,
    string? NormVersion,
    string ValidityStatus,
    IReadOnlyList<string> ValidityReasons,
    bool RequiresHumanReview,
    double? GlobalPercentile,
    string? Cefr,
    int? Level,
    decimal TimeMultiplierApplied,
    DateTimeOffset CompletedAt,
    string? ScoresJson = null,
    string? RenderedLevel = null);

public sealed record StaffAttemptRecord(
    AttemptRow Attempt, DateTimeOffset CreatedAt, DateTimeOffset? CompletedAt, StaffResultRecord? Result);

/// <summary>
/// One candidate's provider attempts (newest first) with their latest stored results, the <c>fit_requirements</c> jsonb
/// of each vacancy they belong to (keyed by vacancy id), and whether the candidate's #312 recruitment consent is
/// withdrawn. A withdrawn candidate's attempts are not returned, but their vacancy ids still key
/// <see cref="VacancyRequirements"/> (with no requirements): the caller reveals the withdrawal only to a reader with one
/// of those vacancies in scope.
/// </summary>
public sealed record StaffCandidateAttempts(
    bool ConsentWithdrawn, IReadOnlyList<StaffAttemptRecord> Attempts, IReadOnlyDictionary<Guid, string?> VacancyRequirements);

/// <summary>Staff reads over the provider tables (the same EF context and tenant scope as the connector).</summary>
public interface IProviderStaffReadRepository
{
    /// <summary>
    /// Instrument → the version every assignment of this vacancy is pinned to: the version of the EARLIEST attempt for
    /// the vacancy and instrument that carries one, in any state (the provider pins per vacancy and instrument for good).
    /// </summary>
    Task<IReadOnlyDictionary<string, string>> GetVacancyPinnedVersionsAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken);

    Task<StaffCandidateAttempts> ListCandidateAttemptsAsync(
        Guid organizationId, Guid candidateId, int max, CancellationToken cancellationToken);
}

/// <summary>One version the catalog offers for selection.</summary>
public sealed record StaffCatalogVersion(string InstrumentVersion, string Status);

/// <summary>
/// One instrument this org may assign: enabled on its binding AND offered by the provider for selection. Delivery,
/// locales and consents are those of the version a new assignment of the vacancy would get (its pinned version when the
/// catalog still lists it, else the first GA version, else the first beta).
/// </summary>
public sealed record StaffCatalogInstrument(
    string Instrument,
    string Delivery,
    IReadOnlyList<string> Locales,
    IReadOnlyList<string> RequiredConsents,
    IReadOnlyList<StaffCatalogVersion> Versions,
    string? PinnedVersion);

public sealed record StaffCatalog(bool Connected, IReadOnlyList<StaffCatalogInstrument> Instruments);

public enum StaffReadOutcome
{
    Ok,
    ProviderUnconfigured,
    ProviderUnavailable,
}

public sealed record StaffCatalogResult(StaffReadOutcome Outcome, StaffCatalog? Catalog);

/// <summary>
/// A result as staff see it. Owner default D6: a reader below company scope gets <see cref="Minimum"/> (met / not met /
/// unknown) and never the level behind it (<see cref="GlobalPercentile"/>, <see cref="Cefr"/>, <see cref="Level"/> and
/// <see cref="ValidityReasons"/> are null for them). <see cref="Profile"/> (the shape behind the result: LIA subtests,
/// English skills, Personality dimensions, PCA's DISC graphs and competencies) is for company-scope readers and only on a
/// valid result: a narrow reader, a result under review and a voided one get null. <see cref="ReportsAvailable"/> says
/// whether the reader may download a PDF report of it, by the rule the report endpoints apply (company scope; valid or
/// under review; a native report from <c>summary</c> up, a provider variant only at <c>full</c>): a result lowered to
/// summary has no profile but still has its report (Codex ats run 7).
/// </summary>
public sealed record StaffProviderResult(
    string Validity,
    IReadOnlyList<string>? ValidityReasons,
    bool RequiresHumanReview,
    bool ReviewPending,
    string? Minimum,
    double? GlobalPercentile,
    string? Cefr,
    int? Level,
    string InstrumentVersion,
    string? NormVersion,
    string CompletedAt,
    ProviderResultProfile? Profile = null,
    bool ReportsAvailable = false);

/// <summary>
/// One attempt as staff see it: the status chip (<see cref="ProviderStaffStatuses"/>), how the vacancy counts the
/// instrument (<see cref="ProviderCountsIn"/>, D3/D20), and the result. The accommodation (multiplier and aids) is for
/// company-scope readers only. <c>SpeakingNotAssessed</c> (English only): <c>no_voice_consent</c> or
/// <c>no_ai_scoring_consent</c> when the candidate declined an optional purpose the speaking section needs.
/// <c>ProctoringOutcome</c> (<see cref="ProviderProctoringOutcomes"/>, company scope only, like the validity reasons):
/// <c>auto_submitted</c> or <c>voided</c> when the sitting's proctoring ended it; null otherwise and for narrow readers.
/// </summary>
public sealed record StaffProviderAttempt(
    Guid AttemptId,
    Guid VacancyId,
    string Instrument,
    string Status,
    string? InstrumentVersion,
    IReadOnlyList<string> MissingConsents,
    string? ExpiresAt,
    string CreatedAt,
    string? CompletedAt,
    string? LastErrorCode,
    decimal? TimeMultiplier,
    IReadOnlyList<string>? Aids,
    string CountsIn,
    StaffProviderResult? Result,
    string? SpeakingNotAssessed = null,
    string? ProctoringOutcome = null);

public sealed record StaffCandidateAttemptList(bool ConsentWithdrawn, IReadOnlyList<StaffProviderAttempt> Attempts);

/// <summary>
/// The HR and recruiter reads of the provider connector: the org's assignable catalog (for the vacancy assessments
/// editor and the assign dialog) and one candidate's attempts with their results (status chips and the per-instrument
/// results view).
/// </summary>
public sealed class ProviderStaffReadUseCase(
    IAssessmentProviderRepository repository, IProviderStaffReadRepository staffRepository, IAssessmentProvider provider)
{
    public const int MaxAttempts = 100;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IProviderStaffReadRepository _staffRepository = staffRepository;
    private readonly IAssessmentProvider _provider = provider;

    public async Task<StaffCatalogResult> GetCatalogAsync(
        Guid organizationId, Guid? vacancyId, CancellationToken cancellationToken)
    {
        if (!_provider.IsConfigured)
        {
            return new StaffCatalogResult(StaffReadOutcome.ProviderUnconfigured, null);
        }

        var binding = await _repository.GetActiveBindingAsync(organizationId, cancellationToken).ConfigureAwait(false);
        if (binding is null)
        {
            return new StaffCatalogResult(StaffReadOutcome.Ok, new StaffCatalog(false, []));
        }

        var catalog = await _provider.ListInstrumentsAsync(cancellationToken).ConfigureAwait(false);
        if (!catalog.Ok)
        {
            return new StaffCatalogResult(StaffReadOutcome.ProviderUnavailable, null);
        }

        var pinned = vacancyId is { } vacancy
            ? await _staffRepository.GetVacancyPinnedVersionsAsync(organizationId, vacancy, cancellationToken)
                .ConfigureAwait(false)
            : new Dictionary<string, string>();
        var offered = catalog.Value!.ToDictionary(i => i.Instrument, StringComparer.Ordinal);
        var instruments = new List<StaffCatalogInstrument>();
        foreach (var id in ProviderInstruments.All)
        {
            if (!binding.EnabledInstruments.Contains(id, StringComparer.Ordinal)
                || !offered.TryGetValue(id, out var entry) || !entry.OfferedForSelection)
            {
                continue;
            }

            var versions = entry.Versions.Where(v => v.SelectionAllowed && v.Status is "ga" or "beta").ToList();
            var pin = pinned.TryGetValue(id, out var p) ? p : null;
            var effective = versions.FirstOrDefault(v => v.InstrumentVersion == pin)
                ?? versions.FirstOrDefault(v => v.Status == "ga") ?? versions[0];
            instruments.Add(new StaffCatalogInstrument(
                id, effective.Delivery, effective.Locales, effective.RequiredConsents,
                versions.Select(v => new StaffCatalogVersion(v.InstrumentVersion, v.Status)).ToList(), pin));
        }

        return new StaffCatalogResult(StaffReadOutcome.Ok, new StaffCatalog(true, instruments));
    }

    /// <param name="hidesLevels">Owner default D6: the reader is below company scope.</param>
    /// <param name="isVacancyInScope">The vacancy scope probe; an attempt of an out-of-scope vacancy is omitted.</param>
    public async Task<StaffCandidateAttemptList> ListCandidateAttemptsAsync(
        Guid organizationId, Guid candidateId, bool hidesLevels, bool liaScoredAllowed,
        Func<Guid, Task<bool>> isVacancyInScope, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(isVacancyInScope);
        var stored = await _staffRepository.ListCandidateAttemptsAsync(organizationId, candidateId, MaxAttempts, cancellationToken)
            .ConfigureAwait(false);
        if (stored.ConsentWithdrawn)
        {
            // #312: a withdrawn candidate's results leave FIT and every staff view (the fit-scores read hides them too).
            // The withdrawal itself is told only to a reader who could see one of the candidate's attempts: anyone else
            // gets the plain empty answer an unknown candidate gets (Codex atsux run 1: no oracle).
            foreach (var vacancyId in stored.VacancyRequirements.Keys)
            {
                if (await isVacancyInScope(vacancyId).ConfigureAwait(false))
                {
                    return new StaffCandidateAttemptList(true, []);
                }
            }

            return new StaffCandidateAttemptList(false, []);
        }

        var inScope = new Dictionary<Guid, bool>();
        var requirements = new Dictionary<Guid, IReadOnlyList<AssessmentRequirement>>();
        var attempts = new List<StaffProviderAttempt>();
        foreach (var record in stored.Attempts)
        {
            var vacancyId = record.Attempt.VacancyId;
            if (!inScope.TryGetValue(vacancyId, out var visible))
            {
                visible = await isVacancyInScope(vacancyId).ConfigureAwait(false);
                inScope[vacancyId] = visible;
                requirements[vacancyId] = ParseRequirements(
                    stored.VacancyRequirements.TryGetValue(vacancyId, out var json) ? json : null, liaScoredAllowed);
            }

            if (visible)
            {
                attempts.Add(ToView(record, requirements[vacancyId], hidesLevels, now));
            }
        }

        return new StaffCandidateAttemptList(false, attempts);
    }

    private static StaffProviderAttempt ToView(
        StaffAttemptRecord record, IReadOnlyList<AssessmentRequirement> requirements, bool hidesLevels, DateTimeOffset now)
    {
        var a = record.Attempt;
        var requirement = requirements.FirstOrDefault(r => r.Instrument == a.Instrument);
        var withdrawn = a.WithdrawalState is not null;
        var erased = a.ErasureRequestedAt is not null || a.State == ProviderAttemptStates.Erased;

        // A result is never shown once the cascade or an erasure reached the attempt (#312, D15).
        var result = withdrawn || erased ? null : record.Result;
        bool? valid = result is null ? null : ProviderFitMapping.IsValid(new ProviderFitRow(
            a.Id, a.Instrument, a.State, result.ResultId, result.Purpose, result.ValidityStatus, result.RequiresHumanReview,
            result.CompletedAt, result.GlobalPercentile, result.Cefr, result.Level, null, result.NormVersion, record.CreatedAt,
            a.TimeMultiplier, result.TimeMultiplierApplied));
        var status = ProviderStaffStatuses.For(
            a.State, a.MissingConsents, a.ExpiresAt, valid, withdrawn, erased, now);

        StaffProviderResult? view = null;
        if (result is not null)
        {
            view = new StaffProviderResult(
                result.ValidityStatus,
                hidesLevels ? null : result.ValidityReasons,
                result.RequiresHumanReview,
                ReviewPending: valid != true,
                ProviderMinimumStatus.Evaluate(requirement, valid == true, result.GlobalPercentile, result.Cefr, result.Level,
                    a.Instrument == ProviderInstruments.Pca ? PcaJobFits.FromScoresJson(result.ScoresJson) : null),
                hidesLevels ? null : result.GlobalPercentile,
                hidesLevels ? null : result.Cefr,
                hidesLevels ? null : result.Level,
                result.InstrumentVersion,
                result.NormVersion,
                Format(result.CompletedAt),
                hidesLevels || valid != true ? null : ProviderResultProfiles.Parse(a.Instrument, result.ScoresJson),
                !hidesLevels && result.ValidityStatus is ProviderValidity.Valid or ProviderValidity.NeedsReview
                    && (ProviderInstruments.IsLinkOut(a.Instrument)
                        ? result.RenderedLevel == "full"
                        : result.RenderedLevel is "summary" or "full"));
        }

        return new StaffProviderAttempt(
            a.Id, a.VacancyId, a.Instrument, status, a.InstrumentVersion,
            status == ProviderStaffStatuses.ConsentNeeded ? a.MissingConsents ?? [] : [],
            a.ExpiresAt is { } e ? Format(e) : null, Format(record.CreatedAt),
            record.CompletedAt is { } c ? Format(c) : null,
            status == ProviderStaffStatuses.Pending ? a.LastErrorCode : null,
            hidesLevels ? null : a.TimeMultiplier,
            hidesLevels ? null : a.Aids,
            ProviderCountsIn.For(a.Instrument, requirement),
            view,
            // The candidate declined an optional English purpose: the provider does not administer speaking, and HR is
            // told why instead of reading a gap in the result as a provider fault.
            OptionalConsents.SpeakingNotAssessedReason(a.Instrument, a.DeclinedOptionalConsents ?? []),
            // Owner default D6: a narrow reader's view is unchanged (no reasons, no proctoring detail). A withdrawn or
            // erased attempt shows nothing about its sitting.
            hidesLevels || withdrawn || erased ? null : ProviderProctoringOutcomes.For(a.CompletedBy, a.VoidReason));
    }

    private static IReadOnlyList<AssessmentRequirement> ParseRequirements(string? json, bool liaScoredAllowed)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            var parsed = FitV2Kernels.ParseAssessmentRequirements(JsonNode.Parse(json));
            return parsed is null ? [] : FitV2Kernels.ApplyLiaThresholdPolicy(parsed, liaScoredAllowed);
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string Format(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
