using Tims.Domain.FitEngine;

namespace Tims.Domain.Assessments.Providers;

/// <summary>
/// What HR and recruiters see for one provider attempt (the per-candidate status chip). Richer than the candidate
/// portal's statuses (<c>ProviderPortalStatuses</c>, owner default D9): staff see review and validity states, never the
/// candidate.
/// <list type="bullet">
/// <item><see cref="Pending"/>: reserved, not yet created at the provider (a re-send re-drives it).</item>
/// <item><see cref="ConsentNeeded"/>: created; the candidate still has to accept a consent text before starting.</item>
/// <item><see cref="Sent"/>: created and launchable; the candidate has not started.</item>
/// <item><see cref="InProgress"/>: a sitting has started.</item>
/// <item><see cref="Scoring"/>: finished at the provider, the result has not arrived yet.</item>
/// <item><see cref="ResultReady"/>: a result that may count toward FIT (<see cref="ProviderFitMapping.IsValid"/>).</item>
/// <item><see cref="NeedsReview"/>: a result awaiting review, voided (also by a later revision, D12), sat at another
/// time multiplier, or a sitting voided before any result (D4): never shown as a low score.</item>
/// <item><see cref="Expired"/>, <see cref="Cancelled"/>: no sitting happened.</item>
/// <item><see cref="Withdrawn"/>: the candidate's #312 withdrawal reached the attempt (D15); nothing more is fetched.</item>
/// <item><see cref="Erased"/>: the provider subject was erased, or its erasure was requested.</item>
/// </list>
/// </summary>
public static class ProviderStaffStatuses
{
    public const string Pending = "pending";
    public const string ConsentNeeded = "consent_needed";
    public const string Sent = "sent";
    public const string InProgress = "in_progress";
    public const string Scoring = "scoring";
    public const string ResultReady = "result_ready";
    public const string NeedsReview = "needs_review";
    public const string Expired = "expired";
    public const string Cancelled = "cancelled";
    public const string Withdrawn = "withdrawn";
    public const string Erased = "erased";

    public static readonly IReadOnlyList<string> All =
        [Pending, ConsentNeeded, Sent, InProgress, Scoring, ResultReady, NeedsReview, Expired, Cancelled, Withdrawn, Erased];

    /// <param name="state">The attempt's state.</param>
    /// <param name="missingConsents">The purposes the provider still lacks.</param>
    /// <param name="expiresAt">The start deadline, when known.</param>
    /// <param name="resultValid">Null without a stored result; else whether it may count toward FIT.</param>
    /// <param name="withdrawn">The #312 cascade reached the attempt.</param>
    /// <param name="erasureRequested">An ATS-initiated erasure of the attempt's provider subject was accepted.</param>
    /// <param name="now">The clock the start deadline is judged by.</param>
    public static string For(
        string state, IReadOnlyCollection<string>? missingConsents, DateTimeOffset? expiresAt, bool? resultValid,
        bool withdrawn, bool erasureRequested, DateTimeOffset now)
    {
        if (erasureRequested || state == ProviderAttemptStates.Erased)
        {
            return Erased;
        }

        if (withdrawn)
        {
            return Withdrawn;
        }

        if (resultValid is { } valid)
        {
            // A stored result decides, whatever the attempt reads now: a later voided revision (D12) leaves the attempt
            // voided but holding a result, and that is a review case, never a fresh sitting.
            return valid ? ResultReady : NeedsReview;
        }

        return state switch
        {
            ProviderAttemptStates.PendingCreate => Pending,
            ProviderAttemptStates.Created or ProviderAttemptStates.Launched when expiresAt is { } e && e <= now => Expired,
            ProviderAttemptStates.Created or ProviderAttemptStates.Launched
                => missingConsents is { Count: > 0 } ? ConsentNeeded : Sent,
            ProviderAttemptStates.InProgress => InProgress,
            ProviderAttemptStates.Completed or ProviderAttemptStates.ResultReady => Scoring,
            ProviderAttemptStates.Voided => NeedsReview,
            ProviderAttemptStates.Expired => Expired,
            _ => Cancelled,
        };
    }
}

/// <summary>How a vacancy uses one instrument, as the staff results view explains it.</summary>
public static class ProviderCountsIn
{
    /// <summary>Feeds the <c>assessment</c> dimension (a scored entry).</summary>
    public const string Assessment = "assessment";

    /// <summary>English, scored or gated: counted ONCE, in the <c>languages</c> dimension (owner default D3).</summary>
    public const string Languages = "languages";

    /// <summary>Shown as met / not met; never part of a number (includes LIA while its norms are unconfirmed, D20).</summary>
    public const string Gate = "gate";

    /// <summary>Shown to HR only, never scored.</summary>
    public const string Advisory = "advisory";

    /// <summary>The vacancy no longer lists the instrument.</summary>
    public const string NotListed = "not_listed";

    /// <summary>
    /// The role of <paramref name="instrument"/> in the vacancy's requirements, after the LIA threshold policy (D20):
    /// English is <see cref="Languages"/> whenever it is scored or gated (D3).
    /// </summary>
    public static string For(string instrument, AssessmentRequirement? requirement)
    {
        if (requirement is null)
        {
            return NotListed;
        }

        return requirement.Use switch
        {
            FitInstrumentUses.Advisory => Advisory,
            _ when instrument == FitInstruments.English => Languages,
            FitInstrumentUses.Scored => Assessment,
            _ => Gate,
        };
    }
}

/// <summary>A result judged against the vacancy's minimum for the instrument.</summary>
public static class ProviderMinimumStatus
{
    public const string Met = "met";
    public const string NotMet = "not_met";
    public const string Unknown = "unknown";

    /// <summary>
    /// <see cref="Met"/> / <see cref="NotMet"/> against the requirement's minimum (LIA global percentile, English CEFR,
    /// ITC-IA level); <see cref="Unknown"/> when the result carries no value of that kind (or is not valid); null when
    /// the vacancy sets no minimum for the instrument (advisory, or not listed).
    /// </summary>
    public static string? Evaluate(
        AssessmentRequirement? requirement, bool resultValid, double? globalPercentile, string? cefr, int? level)
    {
        if (requirement?.Min is not { } min)
        {
            return null;
        }

        if (!resultValid)
        {
            return Unknown;
        }

        if (min.GlobalPercentile is { } minimumPercentile)
        {
            return globalPercentile is { } p ? (p >= minimumPercentile ? Met : NotMet) : Unknown;
        }

        if (min.Cefr is { } minimumCefr)
        {
            return FitV2Kernels.CefrOrdinal(cefr) is { } achieved && FitV2Kernels.CefrOrdinal(minimumCefr) is { } required
                ? (achieved >= required ? Met : NotMet)
                : Unknown;
        }

        if (min.Level is { } minimumLevel)
        {
            return level is { } l ? (l >= minimumLevel ? Met : NotMet) : Unknown;
        }

        return Unknown;
    }
}
