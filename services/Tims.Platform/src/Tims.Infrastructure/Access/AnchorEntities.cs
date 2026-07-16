namespace Tims.Infrastructure.Access;

/// <summary>
/// READ-ONLY EF mappings of the Prisma-OWNED tables the anchor loader reads (only the columns the
/// anchor queries need). Never written by this backend — every query uses <c>.AsNoTracking()</c>
/// and <c>SaveChanges</c> is never called. Mirrors the explicit ToTable/HasColumnName style of
/// <see cref="Tims.Infrastructure.Identity.IdentityDbContext"/>. Run under <c>TenantScope</c>
/// (SET LOCAL ROLE app_tenant + org GUC) so RLS isolates the org — defense in depth with the
/// explicit organization_id filters the anchor queries also carry.
/// </summary>
public sealed class AnchorTeamEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid? BusinessUnitId { get; set; }

    public Guid? LeaderId { get; set; }

    public bool IsActive { get; set; }
}

/// <summary>READ-ONLY mapping of the <c>user_teams</c> join (user ↔ team membership).</summary>
public sealed class AnchorUserTeamEntity
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid TeamId { get; set; }
}

/// <summary>READ-ONLY mapping of the <c>user_business_units</c> join (user ↔ business-unit assignment).</summary>
public sealed class AnchorUserBusinessUnitEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid UserId { get; set; }

    public Guid BusinessUnitId { get; set; }
}

/// <summary>READ-ONLY mapping of <c>business_units</c> (only id, org, is_active).</summary>
public sealed class AnchorBusinessUnitEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public bool IsActive { get; set; }
}

/// <summary>READ-ONLY mapping of <c>interview_evaluators</c> (panel membership).</summary>
public sealed class AnchorInterviewEvaluatorEntity
{
    public Guid Id { get; set; }

    public Guid InterviewId { get; set; }

    public Guid UserId { get; set; }
}

/// <summary>READ-ONLY mapping of <c>interviews</c> (only id, org, vacancy — for the panel org filter).</summary>
public sealed class AnchorInterviewEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid VacancyId { get; set; }
}

/// <summary>READ-ONLY mapping of <c>users</c> for the unit-member union (id, org, nullable business_unit_id).</summary>
public sealed class AnchorUserEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid? BusinessUnitId { get; set; }
}
