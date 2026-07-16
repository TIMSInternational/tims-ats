namespace Tims.Domain.Hris;

/// <summary>
/// The HRIS providers the platform can connect to. Slice 1 defines only BambooHR (the first and
/// only connector built in Phase 3); the enum exists so later slices key an
/// <c>IHrisConnectorFactory</c> on it. Values cross the DB/config boundary as lower-case wire
/// strings (<see cref="HrisProviders.ToWire"/>), stored in the <c>hris_connectors.provider</c>
/// text column.
/// </summary>
public enum HrisProvider
{
    BambooHr,
}

public static class HrisProviders
{
    /// <summary>The wire/DB string form ('bamboohr'), matching the connector config key.</summary>
    public static string ToWire(this HrisProvider provider) => provider switch
    {
        HrisProvider.BambooHr => "bamboohr",
        _ => throw new ArgumentOutOfRangeException(nameof(provider), provider, "Unknown HrisProvider"),
    };

    public static bool TryParse(string? value, out HrisProvider provider)
    {
        switch (value)
        {
            case "bamboohr":
                provider = HrisProvider.BambooHr;
                return true;
            default:
                provider = default;
                return false;
        }
    }

    /// <summary>
    /// Strict parse for values the platform itself wrote to an EF-OWNED column. An unknown string is
    /// data corruption, not an expected legacy value, so it throws rather than silently defaulting.
    /// </summary>
    public static HrisProvider FromWire(string value) =>
        TryParse(value, out var provider)
            ? provider
            : throw new ArgumentOutOfRangeException(nameof(value), value, "Unknown HrisProvider wire value");
}
