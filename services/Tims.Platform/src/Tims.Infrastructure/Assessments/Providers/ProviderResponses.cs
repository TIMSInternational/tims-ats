using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// Response parsers for the TIMS Assessments API v1 objects (<c>schemas/assessments/api/*.v1.schema.json</c>). Each
/// returns null when a field the ATS relies on is missing or off contract; unknown extra fields are ignored (the
/// contract's versioning rule: clients must ignore unknown response fields).
/// </summary>
internal static partial class ProviderResponses
{
    public static IReadOnlyList<ProviderCatalogInstrument>? Catalog(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("data", out var data)
            || data.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var instruments = new List<ProviderCatalogInstrument>();
        foreach (var entry in data.EnumerateArray())
        {
            var instrument = Str(entry, "instrument");
            if (!ProviderInstruments.IsKnown(instrument)
                || !entry.TryGetProperty("versions", out var versions) || versions.ValueKind != JsonValueKind.Array)
            {
                continue; // an instrument this connector does not know is not offered to the ATS
            }

            var parsed = new List<ProviderCatalogVersion>();
            foreach (var version in versions.EnumerateArray())
            {
                var number = Str(version, "instrument_version");
                var status = Str(version, "status");
                var delivery = Str(version, "delivery");
                if (!ProviderFormats.IsInstrumentVersion(number) || status is null || delivery is not ("native" or "link_out")
                    || !version.TryGetProperty("selection_allowed", out var selection)
                    || selection.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                {
                    return null;
                }

                parsed.Add(new ProviderCatalogVersion(
                    number!, status, delivery, selection.GetBoolean(),
                    StrArray(version, "locales") ?? [], StrArray(version, "required_consents") ?? []));
            }

            instruments.Add(new ProviderCatalogInstrument(instrument!, parsed));
        }

        return instruments;
    }

    public static ProviderTenant? Tenant(JsonElement root) =>
        GuidOf(root, "tenant_id") is { } id && Str(root, "external_org_ref") is { } externalRef && Str(root, "status") is { } status
            ? new ProviderTenant(id, externalRef, status)
            : null;

    public static ProviderSubject? Subject(JsonElement root) =>
        GuidOf(root, "subject_id") is { } id && Str(root, "status") is { } status
            ? new ProviderSubject(id, status,
                Str(root, "given_name") is not null && Str(root, "family_name") is not null && Str(root, "email") is not null)
            : null;

    public static ProviderAssignment? Assignment(JsonElement root)
    {
        if (GuidOf(root, "assignment_id") is not { } id || GuidOf(root, "tenant_id") is not { } tenant
            || GuidOf(root, "subject_id") is not { } subject
            || Str(root, "instrument") is not { } instrument || !ProviderInstruments.IsKnown(instrument)
            || Str(root, "instrument_version") is not { } version || !ProviderFormats.IsInstrumentVersion(version)
            || Str(root, "content_version") is not { } content || !ProviderFormats.IsContentVersion(content)
            || Str(root, "status") is not { } status
            || StrArray(root, "required_consents") is not { } required || !required.All(ConsentPurposes.IsKnown)
            || StrArray(root, "missing_consents") is not { } missing || !missing.All(ConsentPurposes.IsKnown)
            || Timestamp(root, "expires_at") is not { } expiresAt)
        {
            return null;
        }

        // result_id and the sitting timestamps are nullable in the contract; a value that is present must be well formed.
        if (!OptionalGuid(root, "result_id", out var resultId) || !OptionalTimestamp(root, "started_at", out var startedAt)
            || !OptionalTimestamp(root, "completed_at", out var completedAt)
            || !OptionalTimestamp(root, "voided_at", out var voidedAt))
        {
            return null;
        }

        return new ProviderAssignment(
            id, tenant, subject, instrument, version, content, status, required, missing, expiresAt, Str(root, "external_ref", 128),
            resultId, startedAt, completedAt, voidedAt);
    }

    public static ProviderConsentRecord? Consent(JsonElement root) =>
        GuidOf(root, "consent_id") is { } id && Str(root, "purpose") is { } purpose && ConsentPurposes.IsKnown(purpose)
        && Str(root, "status") is { } status
            ? new ProviderConsentRecord(id, purpose, status)
            : null;

    public static IReadOnlyList<ProviderConsentRecord>? ConsentList(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("data", out var data)
            || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() > 200)
        {
            return null;
        }

        var records = new List<ProviderConsentRecord>();
        foreach (var entry in data.EnumerateArray())
        {
            if (Consent(entry) is not { } record)
            {
                return null;
            }

            records.Add(record);
        }

        return records;
    }

    public static ProviderErasureReceipt? ErasureReceipt(JsonElement root) =>
        GuidOf(root, "subject_id") is { } subject && Str(root, "status") is { } status
        && status is "accepted" or "in_progress" or "completed"
            ? new ProviderErasureReceipt(subject, status)
            : null;

    /// <summary>
    /// A lookup page: <c>data</c> holds at most one assignment, and it must be this tenant's and carry exactly the
    /// external ref asked for (anything else is off contract, never silently taken as ours).
    /// </summary>
    public static ProviderAssignmentLookup? AssignmentLookup(JsonElement root, Guid tenantId, string externalRef)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("data", out var data)
            || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() > 1)
        {
            return null;
        }

        if (data.GetArrayLength() == 0)
        {
            return new ProviderAssignmentLookup(null);
        }

        return Assignment(data[0]) is { } found && found.TenantId == tenantId
            && string.Equals(found.ExternalRef, externalRef, StringComparison.Ordinal)
                ? new ProviderAssignmentLookup(found)
                : null;
    }

    public static ProviderLaunch? Launch(JsonElement root, Guid expectedAssignmentId)
    {
        if (GuidOf(root, "assignment_id") != expectedAssignmentId
            || Str(root, "delivery") is not { } delivery
            || Timestamp(root, "expires_at") is not { } expiresAt
            || Str(root, "api_base_url") is not { } apiBaseUrl || !IsHttps(apiBaseUrl))
        {
            return null;
        }

        var token = Str(root, "candidate_token", maxLength: 4096);
        var hostedUrl = Str(root, "hosted_url", maxLength: 2048);
        if (hostedUrl is not null && !IsHttps(hostedUrl))
        {
            return null;
        }

        return delivery switch
        {
            "native" when token is { Length: >= 32 } && Str(root, "token_type") == "Bearer" =>
                new ProviderLaunch(delivery, token, expiresAt, apiBaseUrl, hostedUrl),
            "link_out" when token is null && hostedUrl is not null =>
                new ProviderLaunch(delivery, null, expiresAt, apiBaseUrl, hostedUrl),
            _ => null,
        };
    }

    /// <summary>
    /// An RFC 9457 problem → a failure with the stable code. 429, 5xx and 409 <c>idempotency_key_in_use</c> (an earlier
    /// request with the same key is still being processed; the amended contract's Idempotency section) are transient.
    /// </summary>
    public static ProviderFailure Problem(int status, string text, TimeSpan? retryAfter = null)
    {
        var transient = status == 429 || status >= 500;
        var code = status switch
        {
            404 => "not_found",
            429 => "rate_limited",
            >= 500 => ProviderFailure.Unavailable,
            _ => "provider_error",
        };
        IReadOnlyList<string> missing = [];
        try
        {
            using var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 8 });
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
            {
                if (Str(root, "code") is { } problemCode && ProblemCodeRegex().IsMatch(problemCode))
                {
                    code = problemCode;
                }

                missing = (StrArray(root, "missing_consents") ?? []).Where(ConsentPurposes.IsKnown).ToList();
            }
        }
        catch (JsonException)
        {
            // Not a problem document (a proxy's HTML error page, for example): keep the status-derived code.
        }

        if (status == 409 && code == ProviderFailure.IdempotencyKeyInUse)
        {
            transient = true;
        }

        return new ProviderFailure(status, code, transient, missing) { RetryAfter = retryAfter };
    }

    /// <summary>
    /// <c>Retry-After</c> as delay-seconds (RFC 9110 §10.2.3) or an HTTP date, relative to <paramref name="now"/>; null
    /// when absent or unreadable. Bounded to a day so a hostile value cannot park a caller.
    /// </summary>
    public static TimeSpan? RetryAfter(System.Net.Http.Headers.RetryConditionHeaderValue? header, DateTimeOffset now)
    {
        var delay = header switch
        {
            { Delta: { } delta } => delta,
            { Date: { } date } => date - now,
            _ => (TimeSpan?)null,
        };
        if (delay is not { } value)
        {
            return null;
        }

        return value < TimeSpan.Zero ? TimeSpan.Zero : value > TimeSpan.FromDays(1) ? TimeSpan.FromDays(1) : value;
    }

    private static bool IsHttps(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.UserInfo.Length == 0;

    private static string? Str(JsonElement obj, string name, int maxLength = 256) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.String
        && node.GetString() is { Length: > 0 } value && value.Length <= maxLength
            ? value
            : null;

    private static Guid? GuidOf(JsonElement obj, string name) =>
        Str(obj, name) is { } raw && Guid.TryParseExact(raw, "D", out var value) ? value : null;

    // Absent or null: true with no value. Present: true only when it parses.
    private static bool OptionalGuid(JsonElement obj, string name, out Guid? value)
    {
        value = null;
        if (!obj.TryGetProperty(name, out var node) || node.ValueKind == JsonValueKind.Null)
        {
            return true;
        }

        value = GuidOf(obj, name);
        return value is not null;
    }

    private static bool OptionalTimestamp(JsonElement obj, string name, out DateTimeOffset? value)
    {
        value = null;
        if (!obj.TryGetProperty(name, out var node) || node.ValueKind == JsonValueKind.Null)
        {
            return true;
        }

        value = Timestamp(obj, name);
        return value is not null;
    }

    private static DateTimeOffset? Timestamp(JsonElement obj, string name) =>
        Str(obj, name) is { } raw && DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value)
            ? value
            : null;

    private static List<string>? StrArray(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var node)
            || node.ValueKind != JsonValueKind.Array || node.GetArrayLength() > 50)
        {
            return null;
        }

        var values = new List<string>();
        foreach (var item in node.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not { Length: > 0 and <= 64 } value)
            {
                return null;
            }

            values.Add(value);
        }

        return values;
    }

    [GeneratedRegex("^[a-z][a-z0-9_]{0,63}$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex ProblemCodeRegex();
}
