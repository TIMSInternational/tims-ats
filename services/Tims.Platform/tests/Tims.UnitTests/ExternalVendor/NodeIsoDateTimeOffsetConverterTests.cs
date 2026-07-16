using System.Text.Json;
using Tims.Domain.ExternalVendor;

namespace Tims.UnitTests.ExternalVendor;

/// <summary>
/// FIX 4 BITE: the Node-ISO converter must emit EXACTLY Node's toISOString() form
/// (<c>yyyy-MM-ddTHH:mm:ss.fffZ</c>) even for a non-UTC offset and sub-millisecond precision — always
/// normalized to UTC, always 3-digit ms, always a trailing <c>Z</c>. A naive <c>ToString()</c> / the
/// default STJ writer would emit the offset form (<c>+05:00</c>) and/or extra precision, so this test
/// goes RED under any regression to a non-canonical writer.
/// </summary>
public sealed class NodeIsoDateTimeOffsetConverterTests
{
    private sealed record DateBox(
        [property: System.Text.Json.Serialization.JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
        DateTimeOffset When,
        [property: System.Text.Json.Serialization.JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
        DateTimeOffset? MaybeWhen);

    [Fact]
    public void Non_utc_offset_and_sub_millisecond_still_emit_canonical_fffZ()
    {
        // +05:00 offset, 7 fractional digits (.1234567). In UTC this is 05:00:00 and truncates to .123.
        var instant = new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.FromHours(5)).AddTicks(1_234_567);

        Assert.Equal("2026-05-01T05:00:00.123Z", NodeIsoDateTimeOffsetConverter.ToNodeIso(instant));
    }

    [Fact]
    public void Serializes_utc_instant_with_three_ms_digits_and_z()
    {
        var box = new DateBox(new DateTimeOffset(2026, 4, 1, 9, 0, 0, TimeSpan.Zero), null);

        var json = JsonSerializer.Serialize(box);

        Assert.Contains("\"When\":\"2026-04-01T09:00:00.000Z\"", json);
        Assert.Contains("\"MaybeWhen\":null", json);
    }

    [Fact]
    public void Round_trips_through_read()
    {
        var box = new DateBox(
            new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 7, 2, 3, 4, 5, TimeSpan.Zero));

        var restored = JsonSerializer.Deserialize<DateBox>(JsonSerializer.Serialize(box))!;

        Assert.Equal(box.When, restored.When);
        Assert.Equal(box.MaybeWhen, restored.MaybeWhen);
    }
}
