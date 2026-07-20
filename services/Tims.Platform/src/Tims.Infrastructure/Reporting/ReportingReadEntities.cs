namespace Tims.Infrastructure.Reporting;

/// <summary>
/// Minimal read-only EF entities for the recruitment-analytics aggregation surface. Only the columns the
/// six reports read are mapped (never full HR rows). All are Prisma-OWNED (efcoreReadOnly); EF SELECTs only.
/// </summary>
public sealed class OfferReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid VacancyId { get; set; }
    public Guid? ApplicationId { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime? SentAt { get; set; }
    public DateTime? RespondedAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public VacancyReadEntity Vacancy { get; set; } = null!;
    public ApplicationReadEntity? Application { get; set; }
}

public sealed class ApplicationReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid VacancyId { get; set; }
    public Guid CurrentStageId { get; set; }
    public string Source { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime AppliedAt { get; set; }
    public DateTime? RejectedAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public PipelineStageReadEntity CurrentStage { get; set; } = null!;
    public ICollection<StageMovementReadEntity> Movements { get; set; } = new List<StageMovementReadEntity>();
    public ICollection<OfferReadEntity> Offers { get; set; } = new List<OfferReadEntity>();
}

public sealed class PipelineStageReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid VacancyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int Order { get; set; }
    public int? SlaHours { get; set; }
    public DateTime CreatedAt { get; set; }

    public VacancyReadEntity Vacancy { get; set; } = null!;
}

public sealed class StageMovementReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid ApplicationId { get; set; }
    public DateTime MovedAt { get; set; }
}

public sealed class VacancyReadEntity
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Status { get; set; } = string.Empty;
    public Guid? AssignedTo { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public UserReadEntity? Assignee { get; set; }
}

public sealed class UserReadEntity
{
    public Guid Id { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
}
