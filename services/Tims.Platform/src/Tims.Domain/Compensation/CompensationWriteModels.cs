namespace Tims.Domain.Compensation;

/// <summary>
/// The write-side models for the Phase-5 Slice-12 compensation WRITE surface — faithful ports of the
/// <c>createAdjustment</c> + <c>approveAdjustment</c> inputs/outputs of the TS <c>compensation</c> router.
/// </summary>

/// <summary>
/// The validated createAdjustment input (Zod-parity). <see cref="Currency"/> is the raw (optional) 3-char code
/// the endpoint bounds; the use case runs the <c>normalizeCurrencyCode</c> fallback against the subject's
/// current comp currency. <see cref="EffectiveDate"/> is the parsed ISO instant.
/// </summary>
public sealed record CreateAdjustmentCommand(
    Guid UserId,
    string Type,
    double PreviousSalary,
    double NewSalary,
    string? Currency,
    string? Reason,
    DateTimeOffset EffectiveDate);

/// <summary>§21 minimal-select create response — ONLY id + status ('pending'); no restricted field is echoed.</summary>
public sealed record CreateAdjustmentResult(string Id, string Status);

/// <summary>The minimal pending-adjustment row the approve path loads (findFirst select {userId,newSalary,currency}).</summary>
public sealed record PendingAdjustmentRow(Guid UserId, double NewSalary, string Currency);

/// <summary>Outcome of an approve attempt.</summary>
public enum ApproveOutcome
{
    /// <summary>No pending row found for the id (findFirst null) → 404 "Ajuste no encontrado o ya procesado".</summary>
    NotFound,

    /// <summary>The conditional status transition matched 0 rows (TOCTOU race) → 409.</summary>
    Conflict,

    /// <summary>The transition + (if approved) the comp propagation committed together → 200 {id, status}.</summary>
    Applied,
}

/// <summary>Approve result: the outcome + (when Applied) the new status string ('approved' | 'rejected').</summary>
public sealed record ApproveAdjustmentResult(ApproveOutcome Outcome, string? Status);

/// <summary>The accepted salary-adjustment types (Zod enum merit/promotion/market/equity/other).</summary>
public static class AdjustmentTypes
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "merit", "promotion", "market", "equity", "other",
    };

    public static bool IsValid(string? type) => type is not null && All.Contains(type);
}
