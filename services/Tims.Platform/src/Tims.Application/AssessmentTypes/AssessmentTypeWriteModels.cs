namespace Tims.Application.AssessmentTypes;

/// <summary>
/// One <c>assessment_types</c> row as the tenant authoring surface returns it. Explicit projection — the Prisma
/// <c>config</c> jsonb column is deliberately NOT exposed (nothing in the authoring UI reads it, and the create/update
/// surface never writes it). Timestamps are pre-formatted ISO-8601 UTC strings with milliseconds and a trailing
/// <c>Z</c> (the <c>Date.prototype.toISOString()</c> shape) so the OpenAPI contract stays a plain string (TRAP 6).
/// </summary>
public sealed record AssessmentTypeRow(
    string Id,
    string OrganizationId,
    string Name,
    string Code,
    string? Description,
    int? Duration,
    bool IsActive,
    string CreatedAt,
    string UpdatedAt);

/// <summary>Validated create input (name trimmed; description null when blank; code derived from the name).</summary>
public sealed record AssessmentTypeCreateInput(string Name, string Code, string? Description, int? Duration);

/// <summary>
/// Validated partial update. A <c>Has*</c> flag false means the field was ABSENT (leave the column alone);
/// <c>HasDescription</c>/<c>HasDuration</c> true with a null value means "clear it". Name can never be cleared.
/// The <c>code</c> column is intentionally immutable: it is the stable identifier other rows and reports key on.
/// </summary>
public sealed record AssessmentTypeUpdateInput(
    string? Name,
    bool HasDescription,
    string? Description,
    bool HasDuration,
    int? Duration);

public enum AssessmentTypeWriteOutcome
{
    Ok,
    NotFound,
    Conflict,
}

public sealed record AssessmentTypeWriteResult(AssessmentTypeWriteOutcome Outcome, AssessmentTypeRow? Row)
{
    public static AssessmentTypeWriteResult Ok(AssessmentTypeRow row) => new(AssessmentTypeWriteOutcome.Ok, row);

    public static readonly AssessmentTypeWriteResult NotFound = new(AssessmentTypeWriteOutcome.NotFound, null);

    public static readonly AssessmentTypeWriteResult Conflict = new(AssessmentTypeWriteOutcome.Conflict, null);
}
