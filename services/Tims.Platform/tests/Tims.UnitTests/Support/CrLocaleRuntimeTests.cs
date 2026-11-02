using System.Globalization;
using System.Text.Json;

namespace Tims.UnitTests.Support;

/// <summary>
/// WP-02 PR-2: proves the .NET runtime this suite runs on has real ICU and tzdata for the
/// Costa Rica tenant, and that the C# copy of the tenant ids matches the TS fixture
/// (e2e/fixtures/cr-tenant.ts). The TS side pins the same JSON file in
/// tests/e2e-lib/cr-tenant-fixture.test.ts, so a change on either side turns one suite red.
///
/// Mutation proof (run once, revert): set &lt;InvariantGlobalization&gt;true&lt;/InvariantGlobalization&gt;
/// in Tims.UnitTests.csproj. The culture case must fail, because invariant mode has no es-CR
/// data and cannot render the colon sign.
/// </summary>
public sealed class CrLocaleRuntimeTests
{
    private static readonly TimeSpan CrOffset = TimeSpan.FromHours(-6);

    [Fact]
    public void Tenant_constants_are_costa_rica()
    {
        Assert.Equal("CRC", CrTenant.Currency);
        Assert.Equal("America/Costa_Rica", CrTenant.TimeZoneId);
        Assert.Equal("es-CR", CrTenant.Culture);
    }

    [Fact]
    public void Costa_rica_time_zone_resolves_with_minus_six_offset()
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(CrTenant.TimeZoneId);
        Assert.Equal(CrOffset, tz.BaseUtcOffset);
    }

    [Fact]
    public void Costa_rica_has_no_daylight_saving_in_2026()
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(CrTenant.TimeZoneId);
        var day = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var end = new DateTime(2027, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        for (; day < end; day = day.AddDays(1))
        {
            Assert.Equal(CrOffset, tz.GetUtcOffset(day));
            Assert.False(tz.IsDaylightSavingTime(day), $"DST reported on {day:yyyy-MM-dd}");
        }
    }

    [Fact]
    public void Seeded_interview_converts_to_0830_local()
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(CrTenant.TimeZoneId);
        var utc = new DateTime(2026, 11, 16, 14, 30, 0, DateTimeKind.Utc);
        var local = TimeZoneInfo.ConvertTimeFromUtc(utc, tz);
        Assert.Equal(new DateTime(2026, 11, 16, 8, 30, 0), local);
    }

    [Fact]
    public void Es_cr_culture_is_real_and_uses_the_colon_sign()
    {
        var culture = CultureInfo.GetCultureInfo(CrTenant.Culture);
        Assert.Equal("es-CR", culture.Name);
        Assert.NotEqual(CultureInfo.InvariantCulture.NumberFormat.CurrencySymbol, culture.NumberFormat.CurrencySymbol);
        Assert.Equal("₡", culture.NumberFormat.CurrencySymbol);
    }

    [Fact]
    public void Costa_rica_region_currency_is_crc()
    {
        var region = new RegionInfo("CR");
        Assert.Equal(CrTenant.Currency, region.ISOCurrencySymbol);
    }

    [Fact]
    public void Ids_json_loads_and_matches_CrTenant()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Support", "cr-tenant.ids.json");
        Assert.True(File.Exists(path), $"missing copied fixture: {path}");
        var fromJson = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(path))
                       ?? throw new InvalidOperationException("cr-tenant.ids.json deserialized to null");

        Assert.Equal(
            CrTenant.Ids.OrderBy(kv => kv.Key, StringComparer.Ordinal),
            fromJson.OrderBy(kv => kv.Key, StringComparer.Ordinal));
    }

    [Fact]
    public void Every_id_is_a_v4_guid()
    {
        Assert.NotEmpty(CrTenant.Ids);
        foreach (var (key, value) in CrTenant.Ids)
        {
            Assert.True(Guid.TryParseExact(value, "D", out var guid), $"{key} is not a GUID: {value}");
            Assert.True(guid.Version == 4, $"{key} has version {guid.Version}, expected 4");
            Assert.Equal(value, guid.ToString("D"));
        }
    }

    [Fact]
    public void Organization_id_is_the_organization_entry()
    {
        Assert.Equal(Guid.Parse(CrTenant.Ids["organization"]), CrTenant.OrganizationId);
    }
}
