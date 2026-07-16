namespace Tims.Infrastructure.ExternalVendor;

/// <summary>
/// EF row for the Prisma-OWNED <c>preemployment_validations</c> table — the WRITE-CAPABLE subset the
/// external-vendor submit path touches (docs/architecture/table-ownership.md <c>efcoreStranglerWrite</c>).
/// Prisma owns the DDL/migrations; EF performs the ONE documented vendor <c>UPDATE</c> during the
/// in-progress strangler. Column names mirror the Prisma <c>@map</c>s exactly. <see cref="Result"/> is the
/// raw jsonb text (written as a compact JSON string). Timestamps are the Prisma <c>timestamp(3) without
/// time zone</c> columns (Npgsql <c>Unspecified</c>-kind <see cref="DateTime"/>).
/// </summary>
public sealed class ExternalValidationEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Status { get; set; } = string.Empty;

    public string? Result { get; set; }

    public string? Notes { get; set; }

    public Guid? CompletedById { get; set; }

    public Guid? CompletedByApiKeyId { get; set; }

    public DateTime? CompletedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
