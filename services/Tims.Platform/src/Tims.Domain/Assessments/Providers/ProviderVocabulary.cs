using System.Text.RegularExpressions;

namespace Tims.Domain.Assessments.Providers;

/// <summary>
/// The fixed vocabulary of the TIMS Assessments API v1 (<c>TIMSInternational/tims-interop</c>,
/// <c>contracts/openapi/tims-assessments.v1.yaml</c> and <c>schemas/assessments/common.v1.schema.json</c>), as the ATS
/// connector uses it. Every value the ATS stores or sends is checked against these sets, so a provider response with
/// an unknown value is rejected instead of persisted.
/// </summary>
public static class ProviderNames
{
    /// <summary>The one remote provider today: the headless TIMS Assessments API.</summary>
    public const string TimsAssessments = "tims-assessments";
}

/// <summary>Public instrument keys (<c>common.v1 $defs/Instrument</c>). The same ids FIT v2 uses.</summary>
public static class ProviderInstruments
{
    public const string Lia = "lia";
    public const string English = "english";
    public const string Itcia = "itcia";
    public const string Personality = "personality";
    public const string Mi = "mi";
    public const string Pca = "pca";

    public static readonly IReadOnlyList<string> All = [Lia, English, Itcia, Personality, Mi, Pca];

    public static bool IsKnown(string? instrument) => instrument is not null && All.Contains(instrument, StringComparer.Ordinal);

    /// <summary>
    /// Link-out instruments are taken on the provider's site (PCA). Their subject needs the candidate's names and
    /// email (the contract's 422 <c>subject_data_required</c>); every other instrument gets no PII at all.
    /// </summary>
    public static bool IsLinkOut(string instrument) => string.Equals(instrument, Pca, StringComparison.Ordinal);

    /// <summary>The <c>result_schema</c> discriminator each instrument's typed result carries.</summary>
    public static string? ResultSchemaFor(string instrument) => instrument switch
    {
        Lia => "LiaResultV1",
        English => "EnglishResultV1",
        Itcia => "ItciaResultV1",
        Personality => "PersonalityResultV1",
        Mi => "MiResultV1",
        Pca => "PcaResultV1",
        _ => null,
    };
}

/// <summary>Consent purposes (<c>common.v1 $defs/ConsentPurpose</c>). Each is recorded separately.</summary>
public static class ConsentPurposes
{
    public const string Assessment = "assessment";
    public const string Biometric = "biometric";
    public const string Voice = "voice";
    public const string AiScoring = "ai_scoring";

    public static readonly IReadOnlyList<string> All = [Assessment, Biometric, Voice, AiScoring];

    public static bool IsKnown(string? purpose) => purpose is not null && All.Contains(purpose, StringComparer.Ordinal);
}

/// <summary>
/// Allowed aids (<c>common.v1 $defs/AidCode</c>). Only the adjustment is ever stored or sent, never its reason.
/// </summary>
public static class AccommodationAids
{
    public static readonly IReadOnlyList<string> All =
    [
        "extended_breaks", "screen_reader", "screen_magnification", "high_contrast", "assistive_input",
        "captions_or_transcript", "reader_assistance", "separate_setting",
    ];

    public const decimal MinTimeMultiplier = 1m;
    public const decimal MaxTimeMultiplier = 3m;

    public static bool IsKnown(string? aid) => aid is not null && All.Contains(aid, StringComparer.Ordinal);
}

/// <summary>Result validity (<c>common.v1 $defs/ValidityStatus</c>). Only <c>valid</c> may feed a hiring score.</summary>
public static class ProviderValidity
{
    public const string Valid = "valid";
    public const string Voided = "voided";
    public const string NeedsReview = "needs_review";

    public static readonly IReadOnlyList<string> All = [Valid, Voided, NeedsReview];

    public static bool IsKnown(string? status) => status is not null && All.Contains(status, StringComparer.Ordinal);
}

/// <summary>The seven webhook event types of the contract (<c>WebhookEventType</c>).</summary>
public static class ProviderEventTypes
{
    public const string AssignmentStarted = "assignment.started";
    public const string SessionCompleted = "session.completed";
    public const string SessionVoided = "session.voided";
    public const string ResultReady = "result.ready";
    public const string AssignmentExpired = "assignment.expired";

    /// <summary>
    /// A sitting in progress was voided. For a native instrument it accompanies <see cref="SessionVoided"/>; for a
    /// link-out instrument (PCA), which has no session, it is the ONLY void signal and no result ever follows.
    /// </summary>
    public const string AssignmentVoided = "assignment.voided";
    public const string SubjectErased = "subject.erased";

    public static readonly IReadOnlyList<string> All =
        [AssignmentStarted, SessionCompleted, SessionVoided, ResultReady, AssignmentExpired, AssignmentVoided, SubjectErased];

    public static bool IsKnown(string? type) => type is not null && All.Contains(type, StringComparer.Ordinal);
}

/// <summary>
/// The ATS-side state of one provider attempt (one instrument assigned to one candidate for one vacancy).
/// <c>pending_create</c> is the crash-safe intermediate: the row exists before the provider is called, and a retry
/// re-drives the provider call with the same idempotency key.
/// </summary>
public static class ProviderAttemptStates
{
    public const string PendingCreate = "pending_create";
    public const string Created = "created";
    public const string Launched = "launched";
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string ResultReady = "result_ready";
    public const string Voided = "voided";
    public const string Expired = "expired";
    public const string Cancelled = "cancelled";
    public const string Erased = "erased";

    public static readonly IReadOnlyList<string> All =
        [PendingCreate, Created, Launched, InProgress, Completed, ResultReady, Voided, Expired, Cancelled, Erased];

    /// <summary>
    /// States that make a new assignment of the same instrument (same candidate, same vacancy) return the existing
    /// attempt instead of creating a second one. A voided, expired, cancelled or erased attempt can be re-assigned.
    /// Mirrored by the partial unique index <c>ux_assessment_provider_attempts_open</c>.
    /// </summary>
    public static readonly IReadOnlyList<string> Open = [PendingCreate, Created, Launched, InProgress, Completed, ResultReady];

    public static bool IsOpen(string state) => Open.Contains(state, StringComparer.Ordinal);

    /// <summary>A candidate may (re)launch only before the sitting has finished.</summary>
    public static bool IsLaunchable(string state) => state is Created or Launched or InProgress;

    /// <summary>
    /// Staff may cancel an attempt only before its sitting has finished. A completed sitting has (or will have) a
    /// result, which is voided by the provider's own review, never by a cancel.
    /// </summary>
    public static bool IsCancellable(string state) => state is PendingCreate or Created or Launched or InProgress;

    /// <summary>
    /// Forward order of the non-terminal lifecycle. Webhooks are delivered unordered, so a lifecycle event only
    /// moves an attempt forward (a late <c>assignment.started</c> never rewinds a completed attempt).
    /// </summary>
    public static int Rank(string state) => state switch
    {
        PendingCreate => 0,
        Created => 1,
        Launched => 2,
        InProgress => 3,
        Completed => 4,
        ResultReady => 5,
        _ => 6, // voided / expired / cancelled / erased: terminal
    };

    /// <summary>Terminal states no lifecycle event (other than a newer result revision) may leave.</summary>
    public static bool IsTerminal(string state) => state is Voided or Expired or Cancelled or Erased;

    /// <summary>
    /// Lifecycle moves a webhook event may make (deliveries are unordered and at-least-once): lifecycle states only move
    /// forward; a terminal state is left only by a newer result revision (handled where results are stored); a void
    /// wins over anything except cancel/erase and a published result; an expiry never overrides a finished sitting.
    /// <para>Once a result is published, its revisions alone decide validity. The provider finalizes a sitting once
    /// (voided XOR completed with a result), and a later void of a scored sitting is re-published as a new result
    /// revision with <c>validity.status = voided</c>. A <c>session.voided</c> arriving after the attempt reached
    /// <c>result_ready</c> is therefore a stale, reordered delivery: applying it would undo a corrected revision that no
    /// re-fetch could restore (the stored revision is already the latest).</para>
    /// </summary>
    public static bool CanTransition(string from, string to)
    {
        if (from == to || from is Cancelled or Erased || !All.Contains(to, StringComparer.Ordinal))
        {
            return false;
        }

        return to switch
        {
            Voided => from != ResultReady,
            Expired => !IsTerminal(from) && Rank(from) < Rank(Completed),
            Cancelled or Erased or PendingCreate => false,
            _ => !IsTerminal(from) && Rank(from) < Rank(to),
        };
    }
}

/// <summary>
/// The D17 polling fallback (owner default 2026-11-08: "the ATS also polls stale attempts, so correctness never depends
/// on cron frequency"). Webhooks stay the primary signal; the poller re-reads, with <c>GET /v1/assignments/{id}</c> and
/// <c>GET /v1/results/{id}</c>, every mapped attempt whose sitting or result may still change and that nothing has
/// touched for a while, and applies what it finds through the same guarded writes a webhook uses.
/// </summary>
public static class ProviderAttemptPolling
{
    /// <summary>
    /// States whose sitting or result can still change at the provider. <c>result_ready</c> stays pollable for
    /// <see cref="ResultRevisionWindow"/> after completion, because a later void or a staff review publishes a new
    /// result revision.
    /// </summary>
    public static readonly IReadOnlyList<string> PollableStates =
    [
        ProviderAttemptStates.Created, ProviderAttemptStates.Launched, ProviderAttemptStates.InProgress,
        ProviderAttemptStates.Completed, ProviderAttemptStates.ResultReady,
    ];

    /// <summary>A sitting-state attempt untouched (no write, no poll) for this long is polled.</summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(15);

    /// <summary>A <c>result_ready</c> attempt is re-read at most this often, for revisions.</summary>
    public static readonly TimeSpan ResultRevisionStaleAfter = TimeSpan.FromHours(6);

    /// <summary>How long after completion a <c>result_ready</c> attempt is still re-read for revisions.</summary>
    public static readonly TimeSpan ResultRevisionWindow = TimeSpan.FromDays(30);

    /// <summary>
    /// How long a claim holds an attempt. Longer than one attempt's worst case (two provider GETs, each bounded by the
    /// client's per-call timeout of at most 30 s, plus token requests); an instance that dies mid-poll frees its claims
    /// when they expire.
    /// </summary>
    public static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(5);

    /// <summary>
    /// The ATS state a provider <c>AssignmentStatus</c> moves an attempt to, or null when it moves nothing:
    /// <c>created</c> is where every ATS attempt already is, and <c>cancelled</c> is never applied from the provider (only
    /// an ATS cancel or the #312 cascade cancels an attempt). Unknown values are ignored (an extensible enum).
    /// </summary>
    public static string? StateFor(string providerStatus) => providerStatus switch
    {
        "in_progress" => ProviderAttemptStates.InProgress,
        "completed" => ProviderAttemptStates.Completed,
        "voided" => ProviderAttemptStates.Voided,
        "expired" => ProviderAttemptStates.Expired,
        _ => null,
    };
}

/// <summary>
/// Where an attempt stands in the #312 consent-withdrawal cascade to the provider (owner default D15, 2026-11-08). Set to
/// <see cref="Pending"/> in the SAME transaction, under the same per-candidate lock, as the recruitment-consent
/// withdrawal; <see cref="Done"/> once the provider confirmed the assignment's cancel and the subject's consent
/// withdrawal. Any value stops result fetching for the attempt.
/// </summary>
public static class ProviderWithdrawalStates
{
    public const string Pending = "pending";
    public const string Done = "done";

    public static readonly IReadOnlyList<string> All = [Pending, Done];
}

/// <summary>Format checks for the contract's string fragments (<c>common.v1 $defs</c>).</summary>
public static partial class ProviderFormats
{
    public const int MaxReasonLength = 500;
    public const int MinReasonLength = 3;

    /// <summary><c>Locale</c>: language or language-REGION.</summary>
    public static bool IsLocale(string? value) => value is { Length: >= 2 and <= 5 } && LocaleRegex().IsMatch(value);

    /// <summary><c>InstrumentVersion</c>: major.minor.</summary>
    public static bool IsInstrumentVersion(string? value) => value is { Length: <= 7 } && InstrumentVersionRegex().IsMatch(value);

    /// <summary><c>ContentVersion</c>: an opaque content-bundle id.</summary>
    public static bool IsContentVersion(string? value) => value is { Length: >= 1 and <= 64 } && ContentVersionRegex().IsMatch(value);

    /// <summary><c>Sha256</c>: lowercase hex.</summary>
    public static bool IsSha256(string? value) => value is { Length: 64 } && Sha256Regex().IsMatch(value);

    /// <summary>A job-relatedness reason: trimmed, 3..500 chars, no control characters.</summary>
    public static bool IsReason(string? value) =>
        value is not null
        && value.Length is >= MinReasonLength and <= MaxReasonLength
        && value == value.Trim()
        && !value.Any(char.IsControl);

    [GeneratedRegex("^[a-z]{2}(-[A-Z]{2})?$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex LocaleRegex();

    [GeneratedRegex("^[0-9]{1,3}\\.[0-9]{1,3}$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex InstrumentVersionRegex();

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex ContentVersionRegex();

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex Sha256Regex();
}
