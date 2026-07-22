using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Compensation;

/// <summary>
/// Wire shapes for the RAW-model compensation reads (Phase-5 Slice 9, FX-free subset) — faithful ports of
/// what the live TS <c>compensation</c> router returns (packages/api/src/routers/compensation.ts). INTERNAL
/// staff reads = the RAW Prisma model / projection shape, NO <c>schemaVersion</c>. Dates serialize through the
/// shared Node-ISO converter (<c>…fffZ</c>, matching Node's <c>Date.toISOString()</c>).
///
/// Reads #3/#4 return the pure <see cref="CompensationKernels"/> outputs; reads #5/#6/#7 are field-authed
/// (built as JsonObject in the repository from selectFor, never select-then-null). The two records here back:
///   1 getSalaryBands → <see cref="SalaryBandRow"/> (full salaryBand rows, orderBy level asc),
///   2 getMarketComparison → <see cref="MarketComparisonRow"/> (band projection).
/// </summary>

/// <summary>getSalaryBands: the RAW SalaryBand row (Prisma findMany with no select → all scalars).</summary>
public sealed record SalaryBandRow(
    string Id,
    string OrganizationId,
    string Level,
    string? Title,
    double MinSalary,
    double MidSalary,
    double MaxSalary,
    string Currency,
    bool IsActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt);

/// <summary>getMarketComparison: the band projection {level, title, internalMin/Mid/Max, currency}.</summary>
public sealed record MarketComparisonRow(
    string Level,
    string? Title,
    double InternalMin,
    double InternalMid,
    double InternalMax,
    string Currency);
