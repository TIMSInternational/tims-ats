using System.Globalization;

namespace Tims.Domain.Localization;

/// <summary>
/// A server-rendered instant in the organization's time zone with an explicit zone label: the C# twin of
/// <c>timeZoneLabel</c> (packages/shared/src/time-zone.ts) and <c>formatZonedDateTime</c>
/// (packages/api/src/services/email-templates.service.ts). Reads "15 de noviembre de 2026, 9:00 p. m., hora de
/// Costa Rica (GMT-6)". A missing, unknown or UTC zone is rendered in UTC and labelled "(UTC)": never a
/// hard-coded country default.
/// </summary>
public static class ZonedDateTimeText
{
    /// <summary>The explicit last-resort zone. Its label is the literal "UTC".</summary>
    public const string Utc = "UTC";

    // Place names for the zones a label names by country rather than by city (ZONE_PLACES in time-zone.ts).
    private static readonly IReadOnlyDictionary<string, (string Es, string En)> Places =
        new Dictionary<string, (string Es, string En)>(StringComparer.Ordinal)
        {
            ["America/Costa_Rica"] = ("Costa Rica", "Costa Rica"),
            ["America/Panama"] = ("Panamá", "Panama"),
            ["America/Guatemala"] = ("Guatemala", "Guatemala"),
            ["America/El_Salvador"] = ("El Salvador", "El Salvador"),
            ["America/Tegucigalpa"] = ("Honduras", "Honduras"),
            ["America/Managua"] = ("Nicaragua", "Nicaragua"),
            ["America/Mexico_City"] = ("Ciudad de México", "Mexico City"),
            ["America/Bogota"] = ("Colombia", "Colombia"),
            ["America/Lima"] = ("Perú", "Peru"),
            ["America/Santo_Domingo"] = ("República Dominicana", "Dominican Republic"),
            ["America/Santiago"] = ("Chile", "Chile"),
        };

    private static readonly HashSet<string> UtcAliases =
        new(StringComparer.Ordinal) { "UTC", "Etc/UTC", "Etc/GMT", "GMT", "Etc/Universal", "Universal" };

    /// <summary>The zone named by <paramref name="timeZone"/>; null for a missing, unknown or UTC zone.</summary>
    public static TimeZoneInfo? Resolve(string? timeZone)
    {
        if (string.IsNullOrWhiteSpace(timeZone) || timeZone.Length > 64 || UtcAliases.Contains(timeZone)) return null;
        return TimeZoneInfo.TryFindSystemTimeZoneById(timeZone, out var zone) ? zone : null;
    }

    /// <summary>"GMT-6", "GMT+5:30"; "GMT+0" for a zero offset (the Intl <c>shortOffset</c> shape).</summary>
    public static string OffsetLabel(TimeSpan offset)
    {
        if (offset == TimeSpan.Zero) return "GMT+0";
        var sign = offset < TimeSpan.Zero ? "-" : "+";
        var magnitude = offset.Duration();
        var hours = (int)magnitude.TotalHours;
        return magnitude.Minutes == 0
            ? string.Create(CultureInfo.InvariantCulture, $"GMT{sign}{hours}")
            : string.Create(CultureInfo.InvariantCulture, $"GMT{sign}{hours}:{magnitude.Minutes:00}");
    }

    /// <summary>
    /// "hora de Costa Rica (GMT-6)" / "Costa Rica time (GMT-6)", with the offset in force at
    /// <paramref name="instant"/>; "UTC" for a missing, unknown or UTC zone.
    /// </summary>
    public static string Label(string? timeZone, DateTime instant, string locale = "es")
    {
        var zone = Resolve(timeZone);
        if (zone is null) return Utc;
        var en = locale == "en";
        var place = Places.TryGetValue(timeZone!, out var known)
            ? (en ? known.En : known.Es)
            : timeZone!.Split('/')[^1].Replace('_', ' ');
        var offset = OffsetLabel(zone.GetUtcOffset(AsUtc(instant)));
        return en ? $"{place} time ({offset})" : $"hora de {place} ({offset})";
    }

    /// <summary>
    /// "15 de noviembre de 2026, 9:00 p. m., hora de Costa Rica (GMT-6)" / "November 15, 2026, 9:00 PM, Costa
    /// Rica time (GMT-6)"; in UTC with a "(UTC)" suffix when the zone is missing, unknown or UTC. An instant
    /// whose kind is unspecified is read as UTC (database timestamps are stored in UTC).
    /// </summary>
    public static string Format(DateTime instant, string? timeZone, string locale = "es")
    {
        var en = locale == "en";
        var utc = AsUtc(instant);
        var zone = Resolve(timeZone);
        var local = zone is null ? utc : TimeZoneInfo.ConvertTimeFromUtc(utc, zone);
        // es-CR, not es-CO: the pilot tenant is Costa Rican (Pilot UX audit E-23/E-24).
        var culture = CultureInfo.GetCultureInfo(en ? "en-US" : "es-CR");
        var text = local.ToString(en ? "MMMM d, yyyy, h:mm tt" : "d 'de' MMMM 'de' yyyy, h:mm tt", culture);
        return zone is null ? $"{text} ({Utc})" : $"{text}, {Label(timeZone, utc, locale)}";
    }

    private static DateTime AsUtc(DateTime instant) => instant.Kind switch
    {
        DateTimeKind.Utc => instant,
        DateTimeKind.Local => instant.ToUniversalTime(),
        _ => DateTime.SpecifyKind(instant, DateTimeKind.Utc),
    };
}
