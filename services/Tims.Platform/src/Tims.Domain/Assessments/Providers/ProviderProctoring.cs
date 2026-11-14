using System.Text.Json.Serialization;

namespace Tims.Domain.Assessments.Providers;

/// <summary>
/// What the server does when a sitting's countable proctoring violations reach the threshold
/// (<c>session.v1 $defs/AntiCheatPolicy.consequence</c>, mirroring tims-suite's per-company
/// <c>anti_cheat_consequence</c>).
/// </summary>
public static class AntiCheatConsequences
{
    /// <summary>Keep warning; the sitting is never ended.</summary>
    public const string Warn = "warn";

    /// <summary>Complete the sitting with the answers recorded so far; the result goes to human review.</summary>
    public const string AutoSubmit = "auto_submit";

    /// <summary>Void the sitting (a used attempt; a retake is a new assignment).</summary>
    public const string Void = "void";

    public static readonly IReadOnlyList<string> All = [Warn, AutoSubmit, Void];

    public static bool IsKnown(string? value) => value is not null && All.Contains(value, StringComparer.Ordinal);
}

/// <summary>Server-enforced anti-cheat: <see cref="Threshold"/> countable violations (1..20), then <see cref="Consequence"/>.</summary>
public sealed record AntiCheatPolicy(int Threshold, string Consequence)
{
    public const int MinThreshold = 1;
    public const int MaxThreshold = 20;

    [JsonIgnore]
    public bool IsValid => Threshold is >= MinThreshold and <= MaxThreshold && AntiCheatConsequences.IsKnown(Consequence);
}

/// <summary>
/// The proctoring of one sitting (<c>partner.v1 $defs/AssignmentProctoring</c>), and the per-organization setting HR
/// keeps in the ATS, mirroring tims-suite's per-company settings: <see cref="Lockdown"/> (fullscreen, blocked shortcuts,
/// a second screen blocks the start), <see cref="AntiCheat"/> (null = violations are recorded, never acted on) and
/// <see cref="IdentityCheck"/> (camera face checks; requires the <c>biometric</c> consent and the hosted player).
/// </summary>
public sealed record AssessmentProctoring(bool Lockdown, AntiCheatPolicy? AntiCheat, bool IdentityCheck)
{
    /// <summary>Every setting off: the default, and the behaviour before proctoring settings existed.</summary>
    public static readonly AssessmentProctoring Off = new(false, null, false);

    [JsonIgnore]
    public bool IsOff => !Lockdown && AntiCheat is null && !IdentityCheck;

    [JsonIgnore]
    public bool IsValid => AntiCheat is null || AntiCheat.IsValid;

    /// <summary>
    /// The block a new assignment of <paramref name="instrument"/> carries, or null to send none (the instrument's
    /// default policy, exactly as before the field existed):
    /// <list type="bullet">
    /// <item>null for a link-out instrument (PCA): the contract refuses the block, there is no session to proctor;</item>
    /// <item>null when the organization has every setting off (or no setting at all);</item>
    /// <item><see cref="IdentityCheck"/> is sent only while <paramref name="identityCheckAllowed"/>: the face checks need
    /// a biometric consent text that says what they do, and the approved one does not (it says no assessment uses the
    /// camera), so the switch stays off until TIMS approves a new text and the platform flag is turned on.</item>
    /// </list>
    /// </summary>
    public static AssessmentProctoring? ForAssignment(
        string instrument, AssessmentProctoring? settings, bool identityCheckAllowed)
    {
        if (settings is null || ProviderInstruments.IsLinkOut(instrument) || !settings.IsValid)
        {
            return null;
        }

        var effective = identityCheckAllowed ? settings : settings with { IdentityCheck = false };
        return effective.IsOff ? null : effective;
    }
}

/// <summary>
/// Who finished a sitting (<c>session.completed</c> <c>completed_by</c>). <see cref="ProctoringAutoSubmit"/>: countable
/// violations reached the threshold with consequence <c>auto_submit</c>; its result is published as
/// <c>needs_review</c> with reason <c>proctoring_flagged</c>, so a person decides.
/// </summary>
public static class ProviderCompletionCauses
{
    public const string Candidate = "candidate";
    public const string TimeLimit = "time_limit";
    public const string ProctoringAutoSubmit = "proctoring_auto_submit";

    public static readonly IReadOnlyList<string> All = [Candidate, TimeLimit, ProctoringAutoSubmit];

    public static bool IsKnown(string? value) => value is not null && All.Contains(value, StringComparer.Ordinal);
}

/// <summary>
/// Why a sitting was voided (<c>partner.v1 $defs/AssignmentVoidReason</c>, the same as <c>session.voided</c>).
/// <see cref="ProctoringVoid"/>: countable violations reached the threshold with consequence <c>void</c>; the sitting
/// counts as a used attempt and a retake is a new assignment.
/// </summary>
public static class ProviderVoidReasons
{
    public const string ProctoringVoid = "proctoring_void";
    public const string IdentityCheckFailed = "identity_check_failed";
    public const string AdministrativeVoid = "administrative_void";
    public const string ConsentWithdrawn = "consent_withdrawn";

    public static readonly IReadOnlyList<string> All = [ProctoringVoid, IdentityCheckFailed, AdministrativeVoid, ConsentWithdrawn];

    public static bool IsKnown(string? value) => value is not null && All.Contains(value, StringComparer.Ordinal);
}

/// <summary>
/// What proctoring did to a sitting, as HR sees it (company scope only; owner default D6 keeps narrow readers' view
/// unchanged, and the candidate portal never shows it, D9). Null when proctoring ended nothing.
/// <list type="bullet">
/// <item><see cref="AutoSubmitted"/>: the server completed the sitting with the answers recorded so far; its result
/// arrives as needs_review (<c>proctoring_flagged</c>) and a person decides.</item>
/// <item><see cref="Voided"/>: the server voided the sitting (<c>proctoring_void</c>); it used the attempt, and a retake
/// is a new assignment.</item>
/// </list>
/// </summary>
public static class ProviderProctoringOutcomes
{
    public const string AutoSubmitted = "auto_submitted";
    public const string Voided = "voided";

    public static string? For(string? completedBy, string? voidReason) =>
        voidReason == ProviderVoidReasons.ProctoringVoid ? Voided
        : completedBy == ProviderCompletionCauses.ProctoringAutoSubmit ? AutoSubmitted
        : null;
}
