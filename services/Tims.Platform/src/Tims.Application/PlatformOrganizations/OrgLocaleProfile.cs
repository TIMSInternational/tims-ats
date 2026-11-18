using System.Text.Encodings.Web;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Tims.Domain.Compensation;

namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// An organization's locale profile: ISO 3166-1 alpha-2 country, IANA time zone, ISO 4217 currency and the
/// BCP 47 number locale. The C# twin of <c>OrgLocaleProfile</c> in <c>packages/shared/src/org-locale-profile.ts</c>.
/// Stored as the <c>country</c>/<c>timezone</c>/<c>currency</c>/<c>locale</c> keys of
/// <c>organizations.settings</c> and, at creation, on the default company row (country, currency, timezone).
/// </summary>
public sealed record OrgLocaleProfile(string Country, string Timezone, string Currency, string Locale);

/// <summary>
/// The presets and validation rules shared with TypeScript (<c>ORG_COUNTRY_PRESETS</c>, <c>isOrgCountryCode</c>,
/// <c>isOrgTimeZone</c>, <c>isOrgCurrencyCode</c>, <c>isOrgLocaleTag</c>). <c>tests/organization/org-locale-profile.test.ts</c>
/// pins the preset table equal in both stacks.
/// </summary>
public static partial class OrgLocaleProfileRules
{
    public const int MaxTimeZoneLength = 64;

    /// <summary>The countries the creation forms offer, in display order (ORG_COUNTRY_PRESETS).</summary>
    public static readonly IReadOnlyList<OrgLocaleProfile> Presets =
    [
        new("CR", "America/Costa_Rica", "CRC", "es-CR"),
        new("GT", "America/Guatemala", "GTQ", "es-GT"),
        new("HN", "America/Tegucigalpa", "HNL", "es-HN"),
        new("SV", "America/El_Salvador", "USD", "es-SV"),
        new("NI", "America/Managua", "NIO", "es-NI"),
        new("PA", "America/Panama", "USD", "es-PA"),
        new("DO", "America/Santo_Domingo", "DOP", "es-DO"),
        new("MX", "America/Mexico_City", "MXN", "es-MX"),
        new("CO", "America/Bogota", "COP", "es-CO"),
        new("PE", "America/Lima", "PEN", "es-PE"),
        new("CL", "America/Santiago", "CLP", "es-CL"),
        new("US", "America/New_York", "USD", "en-US"),
    ];

    // JSON.stringify-equivalent: "Panamá"-style values must not become á (same encoder as the audit JSON).
    private static readonly System.Text.Json.JsonSerializerOptions JsonEncoding =
        new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary><c>^[A-Z]{2}$</c>.</summary>
    public static bool IsCountry(string? value) => value is not null && CountryPattern().IsMatch(value);

    /// <summary><c>^[a-z]{2}(-[A-Z]{2})?$</c>.</summary>
    public static bool IsLocale(string? value) => value is not null && LocalePattern().IsMatch(value);

    /// <summary>A code on the platform's ISO 4217 list (<see cref="CurrencyCodes.IsCurrencyCode"/>).</summary>
    public static bool IsCurrency(string? value) => CurrencyCodes.IsCurrencyCode(value);

    /// <summary>A zone this runtime knows, at most 64 characters (TS <c>isValidTimeZone</c>).</summary>
    public static bool IsTimeZone(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= MaxTimeZoneLength
        && TimeZoneInfo.TryFindSystemTimeZoneById(value, out _);

    public static bool IsValid(OrgLocaleProfile profile) =>
        IsCountry(profile.Country) && IsTimeZone(profile.Timezone) && IsCurrency(profile.Currency) && IsLocale(profile.Locale);

    /// <summary>The <c>organizations.settings</c> a new organization starts with (TS <c>orgLocaleSettings</c>).</summary>
    public static string SettingsJson(OrgLocaleProfile profile) =>
        new JsonObject
        {
            ["country"] = profile.Country,
            ["timezone"] = profile.Timezone,
            ["currency"] = profile.Currency,
            ["locale"] = profile.Locale,
        }.ToJsonString(JsonEncoding);

    // \A...\z, not ^...$: .NET $ also matches before a trailing "\n", which the TS /^...$/ rejects.
    [GeneratedRegex(@"\A[A-Z]{2}\z", RegexOptions.CultureInvariant)]
    private static partial Regex CountryPattern();

    [GeneratedRegex(@"\A[a-z]{2}(-[A-Z]{2})?\z", RegexOptions.CultureInvariant)]
    private static partial Regex LocalePattern();
}
