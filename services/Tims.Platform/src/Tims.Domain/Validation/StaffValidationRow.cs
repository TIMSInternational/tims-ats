using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Validation;

/// <summary>
/// The staff <c>updateValidation</c> response — the RAW <c>preemployment_validations</c> row the TS mutation
/// returns (<c>db.preemploymentValidation.update(...)</c>). This is an INTERNAL staff surface, so it is the
/// raw model shape with NO <c>schemaVersion</c> (versioning is external-vendor-ONLY — the Slice-3 billing
/// lesson). <see cref="Result"/> is the jsonb payload passed through unchanged (object or null); the three
/// timestamps serialize through <see cref="NodeIsoDateTimeOffsetConverter"/> so the wire form is byte-identical
/// to Node's <c>Date.toISOString()</c> (<c>…fffZ</c>).
/// </summary>
public sealed record StaffValidationRow(
    string Id,
    string OrganizationId,
    string OfferId,
    string Type,
    string Status,
    bool IsBlocking,
    JsonNode? Result,
    string? CompletedById,
    string? CompletedByApiKeyId,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? CompletedAt,
    string? Notes,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset UpdatedAt);
