using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Proctoring;

// Prisma owns DDL for this slice. This context only maps the columns needed by
// the C# candidate and staff paths; every product query/write runs in TenantScope.
public sealed class ProctoringDbContext(DbContextOptions<ProctoringDbContext> options) : DbContext(options)
{
    public DbSet<ProctoringOrganizationRow> Organizations => Set<ProctoringOrganizationRow>();
    public DbSet<ProctoringCandidateRow> Candidates => Set<ProctoringCandidateRow>();
    public DbSet<ProctoringVacancyRow> Vacancies => Set<ProctoringVacancyRow>();
    public DbSet<ProctoringAssessmentTypeRow> AssessmentTypes => Set<ProctoringAssessmentTypeRow>();
    public DbSet<ProctoringAssignmentRow> Assignments => Set<ProctoringAssignmentRow>();
    public DbSet<ProctoringConsentRow> Consents => Set<ProctoringConsentRow>();
    public DbSet<ProctoringSessionRow> Sessions => Set<ProctoringSessionRow>();
    public DbSet<ProctoringEventRow> Events => Set<ProctoringEventRow>();
    public DbSet<ProctoringEntitlementRow> Entitlements => Set<ProctoringEntitlementRow>();
    public DbSet<ProctoringAuditLogRow> AuditLogs => Set<ProctoringAuditLogRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ProctoringOrganizationRow>(e =>
        {
            e.ToTable("organizations"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Slug).HasColumnName("slug");
            e.Property(x => x.IsActive).HasColumnName("is_active");
            e.Property(x => x.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });
        modelBuilder.Entity<ProctoringCandidateRow>(e =>
        {
            e.ToTable("candidates"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.Email).HasColumnName("email");
            e.Property(x => x.FirstName).HasColumnName("first_name");
            e.Property(x => x.LastName).HasColumnName("last_name");
            e.Property(x => x.IsActive).HasColumnName("is_active");
            e.Property(x => x.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });
        modelBuilder.Entity<ProctoringVacancyRow>(e =>
        {
            e.ToTable("vacancies"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.TeamId).HasColumnName("team_id");
            e.Property(x => x.BusinessUnitId).HasColumnName("business_unit_id");
            e.Property(x => x.AssignedTo).HasColumnName("assigned_to");
            e.Property(x => x.CreatedBy).HasColumnName("created_by");
            e.Property(x => x.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });
        modelBuilder.Entity<ProctoringAssessmentTypeRow>(e =>
        {
            e.ToTable("assessment_types"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.Name).HasColumnName("name");
            e.Property(x => x.ConfigJson).HasColumnName("config").HasColumnType("jsonb");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });
        modelBuilder.Entity<ProctoringAssignmentRow>(e =>
        {
            e.ToTable("assessment_assignments"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.CandidateId).HasColumnName("candidate_id");
            e.Property(x => x.VacancyId).HasColumnName("vacancy_id");
            e.Property(x => x.AssessmentTypeId).HasColumnName("assessment_type_id");
            e.Property(x => x.ProctoringRequired).HasColumnName("proctoring_required");
            e.Property(x => x.Status).HasColumnName("status");
            e.Property(x => x.StartedAt).HasColumnName("started_at").HasColumnType("timestamp");
            e.Property(x => x.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp");
            e.Property(x => x.ExpiresAt).HasColumnName("expires_at").HasColumnType("timestamp");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });
        modelBuilder.Entity<ProctoringConsentRow>(e =>
        {
            e.ToTable("assessment_consents"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.AssignmentId).HasColumnName("assignment_id");
            e.HasIndex(x => x.AssignmentId).IsUnique();
            e.Property(x => x.CandidateId).HasColumnName("candidate_id");
            e.Property(x => x.ConsentType).HasColumnName("consent_type");
            e.Property(x => x.TextVersion).HasColumnName("text_version");
            e.Property(x => x.AgreedAt).HasColumnName("agreed_at").HasColumnType("timestamp");
            e.Property(x => x.IpAddress).HasColumnName("ip_address");
            e.Property(x => x.UserAgent).HasColumnName("user_agent");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });
        modelBuilder.Entity<ProctoringSessionRow>(e =>
        {
            e.ToTable("proctoring_sessions"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.AssignmentId).HasColumnName("assignment_id");
            e.HasIndex(x => x.AssignmentId).IsUnique();
            e.Property(x => x.StartedAt).HasColumnName("started_at").HasColumnType("timestamp");
            e.Property(x => x.EndedAt).HasColumnName("ended_at").HasColumnType("timestamp");
            e.Property(x => x.ConsentedAt).HasColumnName("consented_at").HasColumnType("timestamp");
            e.Property(x => x.ConsentVersion).HasColumnName("consent_version");
            e.Property(x => x.LastHeartbeatAt).HasColumnName("last_heartbeat_at").HasColumnType("timestamp");
            e.Property(x => x.FlagCount).HasColumnName("flag_count");
            e.Property(x => x.Severity).HasColumnName("severity");
            e.Property(x => x.ReviewStatus).HasColumnName("review_status");
            e.Property(x => x.ReviewNotes).HasColumnName("review_notes");
            e.Property(x => x.ReviewedAt).HasColumnName("reviewed_at").HasColumnType("timestamp");
            e.Property(x => x.ReviewedById).HasColumnName("reviewed_by_id");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });
        modelBuilder.Entity<ProctoringEventRow>(e =>
        {
            e.ToTable("proctoring_events"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.SessionId).HasColumnName("session_id");
            e.Property(x => x.ClientEventId).HasColumnName("client_event_id");
            e.HasIndex(x => new { x.SessionId, x.ClientEventId }).IsUnique();
            e.Property(x => x.Type).HasColumnName("type");
            e.Property(x => x.Source).HasColumnName("source");
            e.Property(x => x.Severity).HasColumnName("severity");
            e.Property(x => x.ClientAt).HasColumnName("client_at").HasColumnType("timestamp");
            e.Property(x => x.OccurredAt).HasColumnName("occurred_at").HasColumnType("timestamp");
        });
        modelBuilder.Entity<ProctoringEntitlementRow>(e =>
        {
            e.ToTable("org_entitlements"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.ModuleCode).HasColumnName("module_code");
            e.Property(x => x.Enabled).HasColumnName("enabled");
        });
        modelBuilder.Entity<ProctoringAuditLogRow>(e =>
        {
            e.ToTable("audit_logs"); e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrganizationId).HasColumnName("organization_id");
            e.Property(x => x.ActorId).HasColumnName("actor_id");
            e.Property(x => x.Action).HasColumnName("action");
            e.Property(x => x.Entity).HasColumnName("entity");
            e.Property(x => x.EntityId).HasColumnName("entity_id");
            e.Property(x => x.MetadataJson).HasColumnName("metadata").HasColumnType("jsonb");
            e.Property(x => x.IpAddress).HasColumnName("ip_address");
            e.Property(x => x.UserAgent).HasColumnName("user_agent");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
        });
    }
}

public sealed class ProctoringOrganizationRow
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public sealed class ProctoringCandidateRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Email { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public sealed class ProctoringVacancyRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? TeamId { get; set; }
    public Guid? BusinessUnitId { get; set; }
    public Guid? AssignedTo { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public sealed class ProctoringAssessmentTypeRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? ConfigJson { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ProctoringAssignmentRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid CandidateId { get; set; }
    public Guid VacancyId { get; set; }
    public Guid AssessmentTypeId { get; set; }
    public bool ProctoringRequired { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ProctoringConsentRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid AssignmentId { get; set; }
    public Guid CandidateId { get; set; }
    public string ConsentType { get; set; } = string.Empty;
    public string TextVersion { get; set; } = string.Empty;
    public DateTime AgreedAt { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ProctoringSessionRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid AssignmentId { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public DateTime? ConsentedAt { get; set; }
    public string? ConsentVersion { get; set; }
    public DateTime? LastHeartbeatAt { get; set; }
    public int FlagCount { get; set; }
    public string? Severity { get; set; }
    public string ReviewStatus { get; set; } = "unreviewed";
    public string? ReviewNotes { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public Guid? ReviewedById { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ProctoringEventRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SessionId { get; set; }
    public Guid ClientEventId { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string Severity { get; set; } = string.Empty;
    public DateTime? ClientAt { get; set; }
    public DateTime OccurredAt { get; set; }
}

public sealed class ProctoringEntitlementRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string ModuleCode { get; set; } = string.Empty;
    public bool Enabled { get; set; }
}

public sealed class ProctoringAuditLogRow
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? ActorId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string Entity { get; set; } = string.Empty;
    public string? EntityId { get; set; }
    public string? MetadataJson { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; }
}
