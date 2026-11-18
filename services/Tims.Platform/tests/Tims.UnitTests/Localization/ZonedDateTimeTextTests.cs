using Tims.Domain.Localization;

namespace Tims.UnitTests.Localization;

/// <summary>Pilot UX audit E-23: server-rendered instants in the organization's zone, explicitly labelled.</summary>
public sealed class ZonedDateTimeTextTests
{
    // 03:00 UTC on 16 November is 21:00 on 15 November in Costa Rica: a UTC date reads one day late there.
    private static readonly DateTime EveningInCostaRica = new(2026, 11, 16, 3, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Costa_rica_reads_the_local_day_and_names_the_zone()
    {
        var text = ZonedDateTimeText.Format(EveningInCostaRica, "America/Costa_Rica");
        Assert.StartsWith("15 de noviembre de 2026, 9:00 ", text);
        Assert.EndsWith(", hora de Costa Rica (GMT-6)", text);
        Assert.DoesNotContain("16 de noviembre", text);
        Assert.DoesNotContain("UTC", text);
    }

    [Fact]
    public void English_uses_the_english_label()
    {
        var text = ZonedDateTimeText.Format(EveningInCostaRica, "America/Costa_Rica", "en");
        Assert.StartsWith("November 15, 2026, 9:00 PM", text);
        Assert.EndsWith(", Costa Rica time (GMT-6)", text);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Not/AZone")]
    [InlineData("UTC")]
    [InlineData("Etc/UTC")]
    public void Missing_unknown_or_utc_zone_is_stated_in_utc_labelled(string? zone)
    {
        var text = ZonedDateTimeText.Format(EveningInCostaRica, zone);
        Assert.StartsWith("16 de noviembre de 2026, 3:00 ", text);
        Assert.EndsWith(" (UTC)", text);
        Assert.Equal("UTC", ZonedDateTimeText.Label(zone, EveningInCostaRica));
        Assert.Null(ZonedDateTimeText.Resolve(zone));
    }

    [Fact]
    public void An_unlisted_zone_is_named_by_its_city_with_the_offset_in_force()
    {
        Assert.Equal("hora de Madrid (GMT+1)", ZonedDateTimeText.Label("Europe/Madrid", EveningInCostaRica));
        Assert.Equal("hora de Madrid (GMT+2)",
            ZonedDateTimeText.Label("Europe/Madrid", new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc)));
        Assert.Equal("Mexico City time (GMT-6)", ZonedDateTimeText.Label("America/Mexico_City", EveningInCostaRica, "en"));
    }

    [Fact]
    public void Unspecified_kind_is_read_as_utc()
    {
        var unspecified = DateTime.SpecifyKind(EveningInCostaRica, DateTimeKind.Unspecified);
        Assert.Equal(ZonedDateTimeText.Format(EveningInCostaRica, "America/Costa_Rica"),
            ZonedDateTimeText.Format(unspecified, "America/Costa_Rica"));
    }

    [Theory]
    [InlineData(-360, "GMT-6")]
    [InlineData(330, "GMT+5:30")]
    [InlineData(-210, "GMT-3:30")]
    [InlineData(0, "GMT+0")]
    public void Offset_label_matches_the_intl_short_offset_shape(int minutes, string expected)
    {
        Assert.Equal(expected, ZonedDateTimeText.OffsetLabel(TimeSpan.FromMinutes(minutes)));
    }
}
