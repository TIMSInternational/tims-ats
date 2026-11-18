using System.Text.RegularExpressions;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>
/// One report HR may download for a provider result. <see cref="Variant"/> null = the provider's own interpretive report
/// of a native instrument (<c>format=pdf</c>, no variant); otherwise a provider report variant the result's <c>full</c>
/// projection lists (PCA: TIMS's own PDFs), with the provider's title.
/// </summary>
public sealed record ProviderReportOption(string? Variant, string? Title);

/// <summary>A downloaded report: the PDF bytes, checked to be a PDF.</summary>
public sealed record ProviderReportFile(byte[] Content);

/// <summary>
/// What the report reads need of one attempt, under its tenant scope: the vacancy (for the caller's scope probe), the
/// instrument and locale, and its latest stored result's provider id, validity and rendered level. Null result fields:
/// no stored result.
/// </summary>
public sealed record ProviderReportTarget(
    Guid CandidateId,
    Guid VacancyId,
    string Instrument,
    string Locale,
    Guid? ProviderResultId,
    string? ValidityStatus,
    string? RenderedLevel,
    bool ResultsStopped,
    bool ConsentWithdrawn,
    int? ResultRevision = null);

/// <summary>The provider-table reads and the audit row the report use case needs.</summary>
public interface IProviderReportRepository
{
    Task<ProviderReportTarget?> GetReportTargetAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken);

    /// <summary>One audit row per download: who, which attempt, instrument and variant; never the content.</summary>
    Task AuditReportDownloadAsync(
        Guid organizationId, Guid actorId, Guid attemptId, Guid candidateId, string instrument, string? variant,
        CancellationToken cancellationToken);
}

public enum ProviderReportOutcome
{
    Ok,

    /// <summary>No such attempt in this organization, or its vacancy is outside the caller's scope.</summary>
    NotFound,

    /// <summary>The attempt has no report to give: no stored result, a voided one, results stopped (erasure or
    /// withdrawal), a #312-withdrawn candidate, a projection that carries none, or a variant the provider does not
    /// list for it.</summary>
    NoReport,

    InvalidInput,

    ProviderUnconfigured,

    ProviderUnavailable,
}

public sealed record ProviderReportListResult(ProviderReportOutcome Outcome, IReadOnlyList<ProviderReportOption> Reports);

public sealed record ProviderReportDownloadResult(ProviderReportOutcome Outcome, ProviderReportFile? File, string? Instrument);

/// <summary>
/// HR downloads of the provider's reports (contract <c>getResultReport</c>, <c>reports:read</c>). Never wider than the
/// result the ATS already shows: the attempt's latest stored result must exist, be valid or under review (a voided result
/// has no report), still feed the ATS (no erasure, no withdrawal) and be rendered for <c>tenant_hr</c> at
/// <c>summary</c> or <c>full</c>; a provider report variant (PCA) needs <c>full</c>. The provider applies the same gate
/// again and its refusal (403 <c>result_not_visible</c>, 410 <c>result_voided</c>, 404, 422 <c>unknown_variant</c>) is
/// <see cref="ProviderReportOutcome.NoReport"/>. The caller has already refused readers below company scope (owner
/// default D6: a report is the full interpretation) and passes the vacancy scope probe. Every download is audited.
/// </summary>
public sealed class ProviderReportUseCase(IProviderReportRepository repository, IAssessmentProvider provider)
{
    /// <summary>The contract's <c>variant</c> pattern.</summary>
    public static readonly Regex VariantPattern =
        new("^[a-z0-9_]{1,64}$", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

    private static readonly string[] ReportLevels = ["summary", "full"];

    private readonly IProviderReportRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    public async Task<ProviderReportListResult> ListAsync(
        Guid organizationId, Guid attemptId, Func<Guid, Task<bool>> inScope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(inScope);
        var (outcome, resolved) = await ResolveAsync(organizationId, attemptId, inScope, cancellationToken).ConfigureAwait(false);
        if (outcome != ProviderReportOutcome.Ok || resolved is not { } target)
        {
            return new ProviderReportListResult(outcome, []);
        }

        var linkOut = ProviderInstruments.IsLinkOut(target.Instrument);
        if (linkOut && target.RenderedLevel != "full")
        {
            return new ProviderReportListResult(ProviderReportOutcome.NoReport, []);
        }

        var listed = await _provider.ListResultReportsAsync(target.ProviderResultId!.Value, cancellationToken)
            .ConfigureAwait(false);
        if (!listed.Ok)
        {
            return new ProviderReportListResult(Map(listed.Failure!), []);
        }

        var reports = new List<ProviderReportOption>();
        if (!linkOut)
        {
            reports.Add(new ProviderReportOption(null, null));
        }

        if (target.RenderedLevel == "full")
        {
            reports.AddRange(listed.Value!.Where(r => r.Variant is not null));
        }

        return reports.Count == 0
            ? new ProviderReportListResult(ProviderReportOutcome.NoReport, [])
            : new ProviderReportListResult(ProviderReportOutcome.Ok, reports);
    }

    public async Task<ProviderReportDownloadResult> DownloadAsync(
        Guid organizationId, Guid actorId, Guid attemptId, string? variant, string? locale, Func<Guid, Task<bool>> inScope,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(inScope);
        if ((variant is not null && !VariantPattern.IsMatch(variant)) || (locale is not null && !ProviderFormats.IsLocale(locale)))
        {
            return new ProviderReportDownloadResult(ProviderReportOutcome.InvalidInput, null, null);
        }

        var (outcome, resolved) = await ResolveAsync(organizationId, attemptId, inScope, cancellationToken).ConfigureAwait(false);
        if (outcome != ProviderReportOutcome.Ok || resolved is not { } target)
        {
            return new ProviderReportDownloadResult(outcome, null, null);
        }

        // A link-out instrument's interpretation is the provider's own report (a variant); a variant needs `full`.
        if ((variant is null && ProviderInstruments.IsLinkOut(target.Instrument))
            || (variant is not null && target.RenderedLevel != "full"))
        {
            return new ProviderReportDownloadResult(ProviderReportOutcome.NoReport, null, target.Instrument);
        }

        var got = await _provider.GetResultReportPdfAsync(
                target.ProviderResultId!.Value, variant, locale ?? target.Locale, cancellationToken)
            .ConfigureAwait(false);
        if (!got.Ok)
        {
            return new ProviderReportDownloadResult(Map(got.Failure!), null, target.Instrument);
        }

        // Codex ats run 4 [P1]: a #312 withdrawal, an erasure or a newer result that committed during the provider call
        // wins; the bytes are dropped, never delivered or audited as delivered. Run 5 [P1]: a newer REVISION keeps the
        // result's id, and a lowered visibility (full -> summary) keeps both: the revision and the rendered level are
        // compared too.
        var after = await _repository.GetReportTargetAsync(organizationId, attemptId, cancellationToken).ConfigureAwait(false);
        if (after is null || after.ConsentWithdrawn || after.ResultsStopped || after.ProviderResultId != target.ProviderResultId
            || after.ResultRevision != target.ResultRevision
            || !string.Equals(after.RenderedLevel, target.RenderedLevel, StringComparison.Ordinal)
            || after.ValidityStatus is not ("valid" or "needs_review"))
        {
            return new ProviderReportDownloadResult(ProviderReportOutcome.NoReport, null, target.Instrument);
        }

        await _repository.AuditReportDownloadAsync(
                organizationId, actorId, attemptId, target.CandidateId, target.Instrument, variant, cancellationToken)
            .ConfigureAwait(false);
        return new ProviderReportDownloadResult(ProviderReportOutcome.Ok, got.Value, target.Instrument);
    }

    private async Task<(ProviderReportOutcome Outcome, ProviderReportTarget? Target)> ResolveAsync(
        Guid organizationId, Guid attemptId, Func<Guid, Task<bool>> inScope, CancellationToken cancellationToken)
    {
        var target = await _repository.GetReportTargetAsync(organizationId, attemptId, cancellationToken).ConfigureAwait(false);
        if (target is null || !await inScope(target.VacancyId).ConfigureAwait(false))
        {
            return (ProviderReportOutcome.NotFound, null);
        }

        if (target.ConsentWithdrawn || target.ResultsStopped || target.ProviderResultId is null
            || target.ValidityStatus is not ("valid" or "needs_review")
            || !ReportLevels.Contains(target.RenderedLevel, StringComparer.Ordinal))
        {
            return (ProviderReportOutcome.NoReport, target);
        }

        return _provider.IsConfigured
            ? (ProviderReportOutcome.Ok, target)
            : (ProviderReportOutcome.ProviderUnconfigured, target);
    }

    // The provider's refusal of THIS report is NoReport. Anything else (a missing reports:read grant answers 403
    // insufficient_scope or no token at all, an outage, an off-contract body) is ProviderUnavailable, never hidden as
    // "this candidate has no report".
    private static ProviderReportOutcome Map(ProviderFailure failure) => failure.Code switch
    {
        ProviderFailure.Unconfigured => ProviderReportOutcome.ProviderUnconfigured,
        "result_not_visible" or "result_voided" or "not_found" or "validation_failed" => ProviderReportOutcome.NoReport,
        _ when failure.HttpStatus is 404 or 410 => ProviderReportOutcome.NoReport,
        _ => ProviderReportOutcome.ProviderUnavailable,
    };
}
