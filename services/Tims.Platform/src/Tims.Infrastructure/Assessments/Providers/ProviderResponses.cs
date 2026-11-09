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

    /// <summary>
    /// <c>ConsentTemplate</c> for the purpose asked for: a <c>text_version</c> (the ContentVersion shape), a locale, a title
    /// and 1..50 plain-text blocks, each one of the four <c>RichTextBlock</c> kinds with the contract's bounds. Anything
    /// else (a markup-bearing block type, an oversized text) refuses the whole template: a consent is never shown partially.
    /// </summary>
    public static ProviderConsentTemplate? ConsentTemplate(JsonElement root, string purpose)
    {
        if (root.ValueKind != JsonValueKind.Object || Str(root, "purpose") != purpose
            || Str(root, "text_version", 64) is not { } textVersion || !ProviderFormats.IsContentVersion(textVersion)
            || Str(root, "locale") is not { } locale || !ProviderFormats.IsLocale(locale)
            || Str(root, "title", 200) is not { } title
            || !root.TryGetProperty("blocks", out var blocks) || blocks.ValueKind != JsonValueKind.Array
            || blocks.GetArrayLength() is < 1 or > 50)
        {
            return null;
        }

        var parsed = new List<ConsentTextBlock>();
        foreach (var block in blocks.EnumerateArray())
        {
            ConsentTextBlock? item = Str(block, "type") switch
            {
                "paragraph" when Str(block, "text", 4000) is { } text => new ConsentTextBlock("paragraph", text),
                "heading" when Str(block, "text", 200) is { } text && block.TryGetProperty("level", out var level)
                    && level.TryGetInt32(out var n) && n is >= 1 and <= 3 => new ConsentTextBlock("heading", text, n),
                "callout" when Str(block, "text", 1000) is { } text && Str(block, "tone") is ({ } tone and ("info" or "warning"))
                    => new ConsentTextBlock("callout", text, Tone: tone),
                "list" when block.TryGetProperty("ordered", out var ordered)
                    && ordered.ValueKind is JsonValueKind.True or JsonValueKind.False
                    && ListItems(block) is { Count: >= 1 and <= 30 } items
                    => new ConsentTextBlock("list", null, Ordered: ordered.GetBoolean(), Items: items),
                _ => null,
            };
            if (item is null)
            {
                return null;
            }

            parsed.Add(item);
        }

        return new ProviderConsentTemplate(purpose, textVersion, locale, title, parsed, StrArray(root, "disclosures") ?? []);
    }

    private static List<string>? ListItems(JsonElement block)
    {
        if (!block.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array || items.GetArrayLength() > 30)
        {
            return null;
        }

        var values = new List<string>();
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not { Length: > 0 and <= 1000 } value)
            {
                return null;
            }

            values.Add(value);
        }

        return values;
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

    /// <summary>
    /// <c>SubjectExport</c>: the subject named is the one asked for, <c>generated_at</c> is a timestamp, and the six
    /// sections are arrays. Kept verbatim (the provider's own document); unknown extra fields are kept too.
    /// </summary>
    public static ProviderHeldExport? SubjectExport(JsonElement root, Guid subjectId)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("subject", out var subject) || GuidOf(subject, "subject_id") != subjectId
            || Timestamp(root, "generated_at") is null)
        {
            return null;
        }

        foreach (var section in new[] { "consents", "assignments", "sessions", "results", "media", "access_log" })
        {
            if (!root.TryGetProperty(section, out var items) || items.ValueKind != JsonValueKind.Array)
            {
                return null;
            }
        }

        return new ProviderHeldExport(subjectId, root.GetRawText());
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

    /// <summary>
    /// A <c>mode: hosted</c> launch (D16). Refused as off contract: another assignment, a mode other than <c>hosted</c>,
    /// ANY candidate token or token type (a hosted launch never hands the host a credential for the sitting, and the ATS
    /// must never relay one), a missing or non-https <c>hosted_url</c>, and a native launch whose <c>frame_ancestors</c>
    /// is not a list of at most 20 registered origins (<c>https://host[:port]</c>, lowercase, no path). A link-out has no
    /// frame ancestors: it is never framed.
    /// </summary>
    public static ProviderLaunch? Launch(JsonElement root, Guid expectedAssignmentId)
    {
        if (root.ValueKind != JsonValueKind.Object
            || GuidOf(root, "assignment_id") != expectedAssignmentId
            || Str(root, "delivery") is not ({ } delivery and ("native" or "link_out"))
            || Str(root, "mode") != "hosted"
            || Timestamp(root, "expires_at") is not { } expiresAt
            || Str(root, "hosted_url", maxLength: 2048) is not { } hostedUrl || !IsHttps(hostedUrl)
            || !IsNullOrAbsent(root, "candidate_token") || !IsNullOrAbsent(root, "token_type"))
        {
            return null;
        }

        if (delivery == "link_out")
        {
            return new ProviderLaunch(delivery, expiresAt, hostedUrl, []);
        }

        if (!root.TryGetProperty("frame_ancestors", out var ancestors) || ancestors.ValueKind != JsonValueKind.Array
            || ancestors.GetArrayLength() > 20)
        {
            return null;
        }

        var origins = new List<string>();
        foreach (var origin in ancestors.EnumerateArray())
        {
            if (origin.ValueKind != JsonValueKind.String || origin.GetString() is not { Length: <= 262 } value
                || !RegisteredOriginRegex().IsMatch(value) || origins.Contains(value, StringComparer.Ordinal))
            {
                return null;
            }

            origins.Add(value);
        }

        return new ProviderLaunch(delivery, expiresAt, hostedUrl, origins);
    }

    private static bool IsNullOrAbsent(JsonElement obj, string name) =>
        !obj.TryGetProperty(name, out var node) || node.ValueKind == JsonValueKind.Null;

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

    // RegisteredOrigin (partner.v1 $defs): https, a lowercase host, an optional port; no path, no wildcard.
    [GeneratedRegex(
        "^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:[0-9]{1,5})?$",
        RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex RegisteredOriginRegex();
}
