namespace Tims.Domain.FitEngine;

/// <summary>
/// The assessment instruments FIT v2 knows. A vacancy lists the ones it uses in
/// <c>job_profiles.fit_requirements.assessments[]</c>; an id outside this set is dropped by the parse.
/// </summary>
public static class FitInstruments
{
    public const string Lia = "lia";
    public const string English = "english";
    public const string Itcia = "itcia";
    public const string Personality = "personality";
    public const string Mi = "mi";
    public const string Pca = "pca";
    public const string NativeQuiz = "native_quiz";

    public static readonly IReadOnlyList<string> All = [Lia, English, Itcia, Personality, Mi, Pca, NativeQuiz];

    /// <summary>
    /// Personality, MI and PCA are never scored and never gate: there is no evidence that a higher or lower
    /// result predicts job performance (assessment-platform design §6.2). Any configured <c>use</c> is coerced to
    /// <see cref="FitInstrumentUses.Advisory"/>.
    /// </summary>
    public static bool IsAdvisoryOnly(string instrument) => instrument is Personality or Mi or Pca;
}

/// <summary>How a vacancy uses an instrument.</summary>
public static class FitInstrumentUses
{
    /// <summary>Feeds the <c>assessment</c> dimension.</summary>
    public const string Scored = "scored";

    /// <summary>Shown as met / not met / unknown. Never changes the score and never rejects a candidate.</summary>
    public const string Gate = "gate";

    /// <summary>Shown to HR only. Never scored.</summary>
    public const string Advisory = "advisory";
}

/// <summary>Per-instrument status in the breakdown.</summary>
public static class FitInstrumentStatuses
{
    /// <summary>A valid result with the value this instrument needs.</summary>
    public const string Completed = "completed";

    /// <summary>No result for this candidate and vacancy.</summary>
    public const string NoResult = "no_result";

    /// <summary>The result is voided, flagged or awaiting human review. It never counts as a low score.</summary>
    public const string NeedsReview = "needs_review";

    /// <summary>A valid result that lacks the value this instrument is judged on (e.g. a partial LIA battery).</summary>
    public const string NoValue = "no_value";
}

/// <summary>Gate states. A gate never rejects: a person decides.</summary>
public static class FitGateStates
{
    public const string Met = "met";
    public const string NotMet = "not_met";
    public const string Unknown = "unknown";
}

/// <summary>
/// The vacancy minimum for one instrument. Exactly one field is set, depending on the instrument:
/// <c>GlobalPercentile</c> (lia, 0..100), <c>Cefr</c> (english, A1..C2), <c>Level</c> (itcia, 1..5) or
/// <c>Score</c> (native_quiz, 0..100 on the normalized score).
/// </summary>
public sealed record InstrumentMinimum(double? GlobalPercentile, string? Cefr, int? Level, double? Score);

/// <summary>
/// One parsed <c>fit_requirements.assessments[]</c> entry. <c>Min</c> is null for advisory entries and for a
/// scored native_quiz without a minimum. <c>Weight</c> is set only on scored entries that declared a valid one.
/// </summary>
public sealed record AssessmentRequirement(
    string Instrument,
    string Use,
    InstrumentMinimum? Min,
    double? Weight,
    string? Reason);

/// <summary>Whether a result may count toward FIT.</summary>
public enum ResultIntegrity
{
    /// <summary>Server-timed, server-scored, not voided, not flagged.</summary>
    Valid,

    /// <summary>Voided, flagged or awaiting human review: shown as needs review, excluded from the score.</summary>
    NeedsReview,
}

/// <summary>
/// One completed assessment result as an <c>IAssessmentResultSource</c> adapter reports it. Only the value the
/// instrument is judged on is read: <c>NormalizedScore</c> (native_quiz), <c>GlobalPercentile</c> (lia),
/// <c>Cefr</c> (english) or <c>Level</c> (itcia). Advisory instruments need none.
/// </summary>
/// <param name="ResultId">The source's own id for the result (the assignment id for ATS native quizzes).</param>
/// <param name="Source">Which adapter produced it: <c>ats</c> or <c>provider</c>.</param>
public sealed record InstrumentResult(
    string Instrument,
    string ResultId,
    string Source,
    ResultIntegrity Integrity,
    DateTimeOffset? CompletedAt,
    double? NormalizedScore,
    double? GlobalPercentile,
    string? Cefr,
    int? Level,
    string? ContentVersion,
    string? NormVersion);

/// <summary>
/// One per-instrument entry of the v2 breakdown.
/// </summary>
/// <param name="Score">The 0..100 fit for a scored entry with a usable result, else null.</param>
/// <param name="Gate">The gate state for a gate entry, else null.</param>
/// <param name="Weight">The declared relative weight that was applied (null when the equal split applied).</param>
/// <param name="AssessmentShare">This instrument's share of the <c>assessment</c> dimension (scored + scored only).</param>
/// <param name="EffectiveWeight">
/// <c>AssessmentShare</c> × the weight profile's <c>assessment</c> weight, before the five-dimension
/// renormalization (scored + scored only).
/// </param>
/// <param name="LanguagesEvidence">
/// English only: <c>assessment</c> when the CEFR result decided English in the <c>languages</c> dimension,
/// <c>cv</c> when the CV self-report stood, null when the vacancy does not require English in
/// <c>requiredLanguages</c>.
/// </param>
public sealed record InstrumentFitEntry(
    string Instrument,
    string Use,
    string Status,
    double? Score,
    string? Gate,
    double? Weight,
    double? AssessmentShare,
    double? EffectiveWeight,
    InstrumentMinimum? Min,
    string? Reason,
    string? ResultId,
    string? Source,
    string? ContentVersion,
    string? NormVersion,
    string? LanguagesEvidence);

/// <summary>The FIT v2 result: the two dimensions it changes, plus the per-instrument entries.</summary>
public sealed record FitV2Evaluation(
    double? AssessmentScore,
    double? LanguagesScore,
    IReadOnlyList<InstrumentFitEntry> Entries);
