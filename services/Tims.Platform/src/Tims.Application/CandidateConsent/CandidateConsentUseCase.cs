using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Tims.Application.CandidateConsent;

/// <summary>
/// Candidate data-processing consent: status + per-application evidence (#313), staff-recorded withdrawal and the
/// candidate's own self-service withdrawal (#312). Greenfield C# (the survival rule: no new endpoints in
/// <c>packages/api</c>); the TS public apply flow keeps writing the consent rows and refusing withdrawn candidates.
///
/// <para><b>What a withdrawal does.</b> It marks the subject-level <c>data_consents</c> row withdrawn (who, how,
/// why), optionally files a deletion request in <c>data_subject_requests</c> for a human to resolve, and audits.
/// It never deletes data: Ley 1581 lets the controller retain what a legal duty requires, and that is a human
/// decision. The TS side then refuses new public applications for that email and stops candidate emails.</para>
///
/// <para>The parsers are pure and live here so they unit-test without a host: strict object (unknown key → 400),
/// bounded strings.</para>
/// </summary>
public sealed partial class CandidateConsentUseCase(ICandidateConsentRepository repository)
{
    public const int MaxSlugLength = 100;

    private static readonly HashSet<string> StaffAllowedKeys = new(StringComparer.Ordinal) { "channel", "reason", "requestDeletion" };

    private readonly ICandidateConsentRepository _repository = repository;

    public Task<CandidateConsentResult> GetAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
        _repository.GetAsync(organizationId, candidateId, cancellationToken);

    public Task<CandidateConsentResult> WithdrawByStaffAsync(
        Guid organizationId, Guid actorId, Guid candidateId, StaffWithdrawalInput input, DateTime now,
        CancellationToken cancellationToken) =>
        _repository.WithdrawAsync(
            organizationId,
            candidateId,
            new WithdrawalActor(actorId, input.Channel, input.Reason, input.RequestDeletion, CandidateConsentConstants.StaffSource),
            now,
            cancellationToken);

    /// <summary>
    /// Self-service withdrawal by the holder of a VERIFIED email. Always files a deletion request (the candidate's
    /// "revocar autorización" is also the supresión request the consent text promises). Unknown org → not found;
    /// no candidate with that email → nothing written (the caller still gets the uniform answer).
    /// </summary>
    public async Task<PortalWithdrawalResult> WithdrawBySubjectAsync(
        string organizationSlug, string verifiedEmail, DateTime now, CancellationToken cancellationToken)
    {
        var organizationId = await _repository.FindActiveOrganizationBySlugAsync(organizationSlug, cancellationToken)
            .ConfigureAwait(false);
        if (organizationId is not { } orgId)
        {
            return new PortalWithdrawalResult(false, 0, 0);
        }

        return await _repository.WithdrawByEmailAsync(
            orgId,
            NormalizeEmail(verifiedEmail),
            new WithdrawalActor(null, CandidateConsentConstants.PortalChannel, null, RequestDeletion: true,
                CandidateConsentConstants.CandidatePortalSource),
            now,
            cancellationToken).ConfigureAwait(false);
    }

    public Task<DataSubjectRequestListView> ListRequestsAsync(
        Guid organizationId, string? status, CancellationToken cancellationToken) =>
        _repository.ListRequestsAsync(organizationId, status, cancellationToken);

    /// <summary>
    /// The optional <c>status</c> query of the staff list: absent/empty → no filter; otherwise exactly one of
    /// <c>pending|completed|rejected</c> (case-sensitive) or false (→ 400).
    /// </summary>
    public static bool TryParseStatusFilter(string? raw, out string? status)
    {
        status = null;
        if (string.IsNullOrEmpty(raw))
        {
            return true;
        }

        if (!CandidateConsentConstants.RequestStatuses.Contains(raw))
        {
            return false;
        }

        status = raw;
        return true;
    }

    /// <summary>Trimmed, lower-cased — the canonical identity the public apply flow stores and matches on.</summary>
    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    /// <summary>Parses the staff withdrawal body. Returns false (→ 400) on any shape/bound violation.</summary>
    public static bool TryParseStaffWithdrawal(JsonNode? node, out StaffWithdrawalInput input)
    {
        input = new StaffWithdrawalInput(string.Empty, null, false);
        if (!TryReadFields(node, StaffAllowedKeys, out var fields)
            || !fields.TryGetValue("channel", out var channelNode)
            || !TryGetString(channelNode, out var channel)
            || !CandidateConsentConstants.StaffChannels.Contains(channel))
        {
            return false;
        }

        string? reason = null;
        if (fields.TryGetValue("reason", out var reasonNode) && reasonNode is not null)
        {
            if (!TryGetString(reasonNode, out var raw))
            {
                return false;
            }

            var trimmed = raw.Trim();
            if (trimmed.Length > CandidateConsentConstants.MaxReasonLength || HasControlCharacters(trimmed))
            {
                return false;
            }

            reason = trimmed.Length == 0 ? null : trimmed;
        }

        var requestDeletion = false;
        if (fields.TryGetValue("requestDeletion", out var deletionNode))
        {
            if (deletionNode is not JsonValue value || value.GetValueKind() is not (JsonValueKind.True or JsonValueKind.False))
            {
                return false;
            }

            requestDeletion = value.GetValue<bool>();
        }

        input = new StaffWithdrawalInput(channel, reason, requestDeletion);
        return true;
    }

    /// <summary>Parses the self-service body: exactly <c>{ "organizationSlug": "&lt;slug&gt;" }</c>.</summary>
    public static bool TryParsePortalWithdrawal(JsonNode? node, out string organizationSlug)
    {
        organizationSlug = string.Empty;
        if (!TryReadFields(node, new HashSet<string>(StringComparer.Ordinal) { "organizationSlug" }, out var fields)
            || !fields.TryGetValue("organizationSlug", out var slugNode)
            || !TryGetString(slugNode, out var slug)
            || slug.Length is 0 or > MaxSlugLength
            || !SlugPattern().IsMatch(slug))
        {
            return false;
        }

        organizationSlug = slug;
        return true;
    }

    private static bool TryReadFields(JsonNode? node, HashSet<string> allowed, out Dictionary<string, JsonNode?> fields)
    {
        fields = new Dictionary<string, JsonNode?>(StringComparer.Ordinal);
        if (node is not JsonObject obj)
        {
            return false;
        }

        try
        {
            foreach (var (key, value) in obj)
            {
                if (!allowed.Contains(key))
                {
                    return false;
                }

                fields[key] = value;
            }
        }
        catch (ArgumentException)
        {
            return false;
        }

        return true;
    }

    private static bool TryGetString(JsonNode? node, out string value)
    {
        value = string.Empty;
        if (node is not JsonValue jsonValue || jsonValue.GetValueKind() != JsonValueKind.String)
        {
            return false;
        }

        value = jsonValue.GetValue<string>();
        return true;
    }

    private static bool HasControlCharacters(string value)
    {
        foreach (var ch in value)
        {
            if (char.IsControl(ch) && ch is not ('\n' or '\r' or '\t'))
            {
                return true;
            }
        }

        return false;
    }

    [GeneratedRegex("^[a-z0-9-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex SlugPattern();
}
