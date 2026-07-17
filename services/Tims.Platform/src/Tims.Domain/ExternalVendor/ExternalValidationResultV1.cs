using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.ExternalVendor;

/// <summary>
/// The STABLE, versioned external contract for a vendor validation submission — a faithful port of the TS
/// <c>ExternalValidationResultV1</c> DTO + <c>toExternalValidationResultV1</c>
/// (packages/api/src/dto/external-validation.ts). Integrators depend on this shape, so it is mapped
/// explicitly (never a reshape of an internal row): bump <see cref="SchemaVersion"/> + add a v2 mapper for
/// a breaking change. The flat field set is the validation id, its new status, and the completion instant.
///
/// <see cref="CompletedAt"/> is a <see cref="DateTimeOffset"/> serialized through
/// <see cref="NodeIsoDateTimeOffsetConverter"/> so the wire form is byte-identical to Node's
/// <c>Date.prototype.toISOString()</c> (<c>…fffZ</c>) — the same converter the Slice-1 v1 read contract uses.
/// </summary>
public sealed record ExternalValidationResultV1(
    string SchemaVersion,
    string Id,
    string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset CompletedAt)
{
    /// <summary>The constant schema tag stamped on every v1 payload.</summary>
    public const string CurrentSchemaVersion = "v1";

    /// <summary>
    /// The pure row → v1 mapper (port of <c>toExternalValidationResultV1</c>): stamps the constant
    /// <c>schemaVersion: "v1"</c> and passes id / status / completedAt through unchanged. Golden-fixtured
    /// against the real TS mapper (contracts/external-fixtures/validation-result-v1.json).
    /// </summary>
    public static ExternalValidationResultV1 Map(string id, string status, DateTimeOffset completedAt) =>
        new(CurrentSchemaVersion, id, status, completedAt);
}
