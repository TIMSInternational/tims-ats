using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Application.PlatformOrganizations;

namespace Tims.Api.PlatformOrganizations;

/// <summary>
/// Reads the optional <c>localeProfile</c> member of the organization-creation bodies
/// (<c>POST /platform/organizations</c>, <c>POST /platform/invitations/organizations</c>) exactly as Zod's
/// <c>orgLocaleProfileSchema.optional()</c> does: absent → null; present → an object with exactly the four
/// string keys country/timezone/currency/locale (<c>.strict()</c>: an unknown key is rejected); an explicit
/// <c>null</c>, another JSON type, a missing or non-string key → invalid (400). The VALUE rules are applied
/// afterwards by <see cref="OrgLocaleProfileRules.IsValid"/>, in the use case.
/// </summary>
public static class OrgLocaleProfileJson
{
    public const string Key = "localeProfile";

    private static readonly string[] Members = ["country", "timezone", "currency", "locale"];

    /// <returns>False when the member is present but malformed.</returns>
    public static bool TryRead(JsonElement root, out OrgLocaleProfile? profile)
    {
        profile = null;
        if (!root.TryGetProperty(Key, out var element)) return true;
        if (element.ValueKind != JsonValueKind.Object) return false;
        var names = element.EnumerateObject().Select(p => p.Name).ToArray();
        if (names.Length != Members.Length || names.Distinct(StringComparer.Ordinal).Count() != names.Length
            || !Members.All(m => names.Contains(m, StringComparer.Ordinal)))
            return false;
        var values = new string[Members.Length];
        for (var i = 0; i < Members.Length; i++)
        {
            var value = element.GetProperty(Members[i]);
            if (value.ValueKind != JsonValueKind.String) return false;
            values[i] = value.GetString()!;
        }
        profile = new OrgLocaleProfile(values[0], values[1], values[2], values[3]);
        return true;
    }

    /// <returns>False when the member is present but malformed.</returns>
    public static bool TryRead(JsonObject body, out OrgLocaleProfile? profile)
    {
        profile = null;
        if (!body.TryGetPropertyValue(Key, out var raw)) return true;
        if (raw is not JsonObject nested) return false;
        try
        {
            // JsonObject materialises lazily: a duplicate key throws here, and must be a 400, not a 500.
            if (nested.Count != Members.Length) return false;
        }
        catch (ArgumentException)
        {
            return false;
        }
        var values = new string[Members.Length];
        for (var i = 0; i < Members.Length; i++)
        {
            if (!nested.TryGetPropertyValue(Members[i], out var member)
                || member is not JsonValue jsonValue
                || !jsonValue.TryGetValue<string>(out var parsed))
                return false;
            values[i] = parsed;
        }
        profile = new OrgLocaleProfile(values[0], values[1], values[2], values[3]);
        return true;
    }
}

/// <summary>The published shape of <c>localeProfile</c> (OpenAPI only; parsing is <see cref="OrgLocaleProfileJson"/>).</summary>
public sealed class OrgLocaleProfileBody
{
    /// <summary>ISO 3166-1 alpha-2, upper case (<c>GT</c>).</summary>
    [Required]
    [RegularExpression("^[A-Z]{2}$")]
    public string Country { get; init; } = string.Empty;

    /// <summary>IANA time zone (<c>America/Guatemala</c>).</summary>
    [Required]
    [MaxLength(OrgLocaleProfileRules.MaxTimeZoneLength)]
    public string Timezone { get; init; } = string.Empty;

    /// <summary>ISO 4217 code from the platform's currency list (<c>GTQ</c>).</summary>
    [Required]
    [RegularExpression("^[A-Z]{3}$")]
    public string Currency { get; init; } = string.Empty;

    /// <summary>Number locale, <c>language[-REGION]</c> (<c>es-GT</c>).</summary>
    [Required]
    [RegularExpression("^[a-z]{2}(-[A-Z]{2})?$")]
    public string Locale { get; init; } = string.Empty;
}
