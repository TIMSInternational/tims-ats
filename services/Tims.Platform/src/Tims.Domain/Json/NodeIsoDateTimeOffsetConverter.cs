using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Tims.Domain.Json;

/// <summary>
/// Serializes a <see cref="DateTimeOffset"/> EXACTLY as Node's <c>Date.prototype.toISOString()</c> —
/// always UTC, always 3-digit milliseconds, <c>Z</c> suffix (<c>yyyy-MM-ddTHH:mm:ss.fffZ</c>). SHARED
/// across the v1 wire contracts (external-vendor + billing): applied via <c>[JsonConverter]</c> on each
/// DTO's date properties, so it never changes global serialization for other endpoints.
///
/// This closes the known "STJ ≠ Node Z" gotcha: the default STJ writer emits the offset form
/// (<c>+00:00</c>) which is NOT byte-identical to the TS contract's <c>toISOString()</c> output, so the
/// golden fixture would give false cross-stack assurance for dates. The converter normalizes to UTC and
/// truncates to milliseconds so a non-UTC offset or sub-millisecond precision still emits the canonical
/// wire form.
/// </summary>
public sealed class NodeIsoDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
{
    // 'T'/'Z' quoted as literals; ".fff" truncates (never rounds) to exactly 3 millisecond digits.
    internal const string NodeIsoFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    /// <summary>Formats the instant as Node's toISOString(): UTC, 3-digit ms, trailing Z.</summary>
    public static string ToNodeIso(DateTimeOffset value) =>
        value.ToUniversalTime().ToString(NodeIsoFormat, CultureInfo.InvariantCulture);

    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateTimeOffset.Parse(
            reader.GetString() ?? throw new JsonException("expected an ISO-8601 date string"),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind);

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
        writer.WriteStringValue(ToNodeIso(value));
}

/// <summary>
/// Nullable variant of <see cref="NodeIsoDateTimeOffsetConverter"/> for the v1 contracts' optional date
/// fields — a <c>null</c> serializes as JSON <c>null</c> (matching the TS <c>Date | null → null</c>).
/// </summary>
public sealed class NodeIsoNullableDateTimeOffsetConverter : JsonConverter<DateTimeOffset?>
{
    public override DateTimeOffset? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null
            ? null
            : DateTimeOffset.Parse(
                reader.GetString() ?? throw new JsonException("expected an ISO-8601 date string"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind);

    public override void Write(Utf8JsonWriter writer, DateTimeOffset? value, JsonSerializerOptions options)
    {
        if (value is { } instant)
        {
            writer.WriteStringValue(NodeIsoDateTimeOffsetConverter.ToNodeIso(instant));
        }
        else
        {
            writer.WriteNullValue();
        }
    }
}

/// <summary>
/// Plain-<see cref="DateTime"/> variant of <see cref="NodeIsoDateTimeOffsetConverter"/>, for columns
/// mapped as Postgres <c>timestamp without time zone</c> (e.g. <c>audit_logs.created_at</c> — Npgsql
/// reads these back with <see cref="DateTimeKind.Unspecified"/>, never <c>Utc</c>). Deliberately does
/// NOT call <c>ToUniversalTime()</c>: for an Unspecified-Kind value that would apply the machine's
/// LOCAL offset — wrong, since the stored value already IS the UTC instant (Prisma/Postgres store
/// these columns as UTC wall-clock by convention). It just prints the value's own components in the
/// Node <c>toISOString()</c> shape (UTC, 3-digit ms, trailing <c>Z</c>), matching
/// <see cref="NodeIsoDateTimeOffsetConverter"/> byte-for-byte regardless of the source Kind.
/// </summary>
public sealed class NodeIsoDateTimeConverter : JsonConverter<DateTime>
{
    /// <summary>Formats the value as Node's toISOString(): 3-digit ms, trailing Z, NO Kind conversion.</summary>
    public static string ToNodeIso(DateTime value) =>
        value.ToString(NodeIsoDateTimeOffsetConverter.NodeIsoFormat, CultureInfo.InvariantCulture);

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateTime.Parse(
            reader.GetString() ?? throw new JsonException("expected an ISO-8601 date string"),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind);

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(ToNodeIso(value));
}

/// <summary>
/// Nullable variant of <see cref="NodeIsoDateTimeConverter"/> — for `timestamp without time zone`
/// columns that are also nullable (e.g. `users.last_login_at`, `user_roles.expires_at`). A `null`
/// serializes as JSON `null` (matching the TS `Date | null → null`).
/// </summary>
public sealed class NodeIsoNullableDateTimeConverter : JsonConverter<DateTime?>
{
    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null
            ? null
            : DateTime.Parse(
                reader.GetString() ?? throw new JsonException("expected an ISO-8601 date string"),
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind);

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is { } instant)
        {
            writer.WriteStringValue(NodeIsoDateTimeConverter.ToNodeIso(instant));
        }
        else
        {
            writer.WriteNullValue();
        }
    }
}
