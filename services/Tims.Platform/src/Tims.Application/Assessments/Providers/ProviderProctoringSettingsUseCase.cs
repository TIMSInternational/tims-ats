using System.Globalization;
using System.Text.Json.Nodes;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>
/// The organization's assessment security settings as HR sees them. <see cref="IdentityCheckAvailable"/> is false while
/// the identity check cannot be offered (no approved biometric consent text describes the face checks yet, and the
/// platform flag is off): the switch is then shown disabled, <see cref="IdentityCheck"/> reads false, and nothing sends
/// it. <see cref="UpdatedAt"/> is null when HR never saved the settings (every setting off).
/// </summary>
public sealed record ProctoringSettingsView(
    bool Lockdown,
    AntiCheatPolicy? AntiCheat,
    bool IdentityCheck,
    bool IdentityCheckAvailable,
    string? UpdatedAt);

public enum ProctoringSettingsOutcome
{
    Ok,

    /// <summary>The request turns the identity check on while it is unavailable: nothing was saved.</summary>
    IdentityCheckUnavailable,
}

public sealed record ProctoringSettingsResult(ProctoringSettingsOutcome Outcome, ProctoringSettingsView? View);

/// <summary>
/// Per-organization assessment proctoring, the same settings tims-suite keeps per company (owner decision 2026-11-11:
/// full proctoring parity): lockdown, anti-cheat (threshold 1..20 and the consequence) and the identity check. Every TIMS
/// assignment created after a change carries them (<see cref="AssessmentProctoring.ForAssignment"/>); an assignment
/// created earlier keeps the block it was created with. Default: every setting off, which sends no block at all.
/// </summary>
public sealed class ProviderProctoringSettingsUseCase(IAssessmentProviderRepository repository)
{
    private readonly IAssessmentProviderRepository _repository = repository;

    public async Task<ProctoringSettingsView> GetAsync(
        Guid organizationId, bool identityCheckAllowed, CancellationToken cancellationToken)
    {
        var stored = await _repository.GetProctoringSettingsAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return ToView(stored, identityCheckAllowed);
    }

    public async Task<ProctoringSettingsResult> UpdateAsync(
        Guid organizationId, Guid actorId, AssessmentProctoring settings, bool identityCheckAllowed, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (settings.IdentityCheck && !identityCheckAllowed)
        {
            return new ProctoringSettingsResult(ProctoringSettingsOutcome.IdentityCheckUnavailable, null);
        }

        var stored = await _repository.SaveProctoringSettingsAsync(organizationId, actorId, settings, now, cancellationToken)
            .ConfigureAwait(false);
        return new ProctoringSettingsResult(ProctoringSettingsOutcome.Ok, ToView(stored, identityCheckAllowed));
    }

    public static ProctoringSettingsView ToView(ProctoringSettingsRow? stored, bool identityCheckAllowed)
    {
        var settings = stored?.Settings ?? AssessmentProctoring.Off;
        return new ProctoringSettingsView(
            settings.Lockdown,
            settings.AntiCheat,
            settings.IdentityCheck && identityCheckAllowed,
            identityCheckAllowed,
            stored is null
                ? null
                : stored.UpdatedAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// Strict body: <c>{ "lockdown": bool, "antiCheat": { "threshold": 1..20, "consequence": "warn"|"auto_submit"|"void" }
    /// | null, "identityCheck": bool }</c>, every key required, no other key. Runs AFTER the auth gate (TRAP 9).
    /// </summary>
    public static bool TryParseBody(JsonNode? node, out AssessmentProctoring settings)
    {
        settings = AssessmentProctoring.Off;
        if (node is not JsonObject body || body.Count != 3
            || body.Any(p => p.Key is not ("lockdown" or "antiCheat" or "identityCheck"))
            || !body.ContainsKey("antiCheat")
            || !TryBool(body["lockdown"], out var lockdown) || !TryBool(body["identityCheck"], out var identityCheck))
        {
            return false;
        }

        AntiCheatPolicy? antiCheat = null;
        if (body["antiCheat"] is { } antiCheatNode)
        {
            if (antiCheatNode is not JsonObject policy || policy.Count != 2
                || policy.Any(p => p.Key is not ("threshold" or "consequence"))
                || policy["threshold"] is not JsonValue thresholdValue || !thresholdValue.TryGetValue(out int threshold)
                || policy["consequence"] is not JsonValue consequenceValue
                || !consequenceValue.TryGetValue(out string? consequence))
            {
                return false;
            }

            antiCheat = new AntiCheatPolicy(threshold, consequence ?? string.Empty);
            if (!antiCheat.IsValid)
            {
                return false;
            }
        }

        settings = new AssessmentProctoring(lockdown, antiCheat, identityCheck);
        return true;
    }

    private static bool TryBool(JsonNode? node, out bool value)
    {
        value = false;
        return node is JsonValue jsonValue && jsonValue.TryGetValue(out value);
    }
}
