using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.CandidateConsent;

/// <summary>
/// Candidate consent context (#312, #313), all Prisma-OWNED tables (Prisma keeps every DDL):
/// <list type="bullet">
///   <item><description><c>data_consents</c> — efcoreStranglerWrite: INSERT a withdrawal-only marker or UPDATE the
///   withdrawal columns (+updated_at). Never DELETE, never rewrites text_version/agreed_at of an existing row.</description></item>
///   <item><description><c>data_subject_requests</c> — efcoreStranglerWrite: INSERT deletion requests.</description></item>
///   <item><description><c>application_consent_evidence</c>, <c>candidates</c>, <c>organizations</c> — read only.</description></item>
///   <item><description><c>audit_logs</c> — efcoreAppendOnly, same transaction as the withdrawal.</description></item>
/// </list>
/// No navigation properties. Prisma <c>timestamp(3) without time zone</c> columns hold UTC wall-clock values
/// (TRAP 6/11): the store type is pinned and Kind=Unspecified values are written.
/// </summary>
public sealed class CandidateConsentDbContext(DbContextOptions<CandidateConsentDbContext> options) : DbContext(options)
{
    public DbSet<DataConsentEntity> DataConsents => Set<DataConsentEntity>();

    public DbSet<ConsentEvidenceEntity> Evidence => Set<ConsentEvidenceEntity>();

    public DbSet<DataSubjectRequestEntity> SubjectRequests => Set<DataSubjectRequestEntity>();

    public DbSet<ConsentCandidateEntity> Candidates => Set<ConsentCandidateEntity>();

    public DbSet<ConsentOrganizationEntity> Organizations => Set<ConsentOrganizationEntity>();

    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ConfigureAuditLogs();

        modelBuilder.Entity<DataConsentEntity>(entity =>
        {
            entity.ToTable("data_consents");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.SubjectUserId).HasColumnName("subject_user_id");
            entity.Property(c => c.ConsentType).HasColumnName("consent_type");
            entity.Property(c => c.TextVersion).HasColumnName("text_version");
            entity.Property(c => c.AgreedAt).HasColumnName("agreed_at").HasColumnType("timestamp");
            entity.Property(c => c.WithdrawnAt).HasColumnName("withdrawn_at").HasColumnType("timestamp");
            entity.Property(c => c.WithdrawalChannel).HasColumnName("withdrawal_channel");
            entity.Property(c => c.WithdrawalReason).HasColumnName("withdrawal_reason");
            entity.Property(c => c.WithdrawnByUserId).HasColumnName("withdrawn_by_user_id");
            entity.Property(c => c.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(c => c.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<ConsentEvidenceEntity>(entity =>
        {
            entity.ToTable("application_consent_evidence");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.ApplicationId).HasColumnName("application_id");
            entity.Property(e => e.CandidateId).HasColumnName("candidate_id");
            entity.Property(e => e.ConsentType).HasColumnName("consent_type");
            entity.Property(e => e.TextVersion).HasColumnName("text_version");
            entity.Property(e => e.TextSha256).HasColumnName("text_sha256");
            entity.Property(e => e.Locale).HasColumnName("locale");
            entity.Property(e => e.AgreedAt).HasColumnName("agreed_at").HasColumnType("timestamp");
            entity.Property(e => e.IpHash).HasColumnName("ip_hash");
            entity.Property(e => e.UserAgent).HasColumnName("user_agent");
            entity.Property(e => e.CaptchaVerified).HasColumnName("captcha_verified");
            entity.Property(e => e.IsBackfilled).HasColumnName("is_backfilled");
        });

        modelBuilder.Entity<DataSubjectRequestEntity>(entity =>
        {
            entity.ToTable("data_subject_requests");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.CandidateId).HasColumnName("candidate_id");
            entity.Property(r => r.RequestType).HasColumnName("request_type");
            entity.Property(r => r.Status).HasColumnName("status");
            entity.Property(r => r.Source).HasColumnName("source");
            entity.Property(r => r.Reason).HasColumnName("reason");
            entity.Property(r => r.RequestedByUserId).HasColumnName("requested_by_user_id");
            entity.Property(r => r.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp");
            entity.Property(r => r.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<ConsentCandidateEntity>(entity =>
        {
            entity.ToTable("candidates");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.Email).HasColumnName("email");
        });

        modelBuilder.Entity<ConsentOrganizationEntity>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Slug).HasColumnName("slug");
            entity.Property(o => o.IsActive).HasColumnName("is_active");
        });
    }
}

public sealed class DataConsentEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid SubjectUserId { get; set; }

    public string ConsentType { get; set; } = string.Empty;

    public string TextVersion { get; set; } = string.Empty;

    public DateTime AgreedAt { get; set; }

    public DateTime? WithdrawnAt { get; set; }

    public string? WithdrawalChannel { get; set; }

    public string? WithdrawalReason { get; set; }

    public Guid? WithdrawnByUserId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class ConsentEvidenceEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid ApplicationId { get; set; }

    public Guid CandidateId { get; set; }

    public string ConsentType { get; set; } = string.Empty;

    public string TextVersion { get; set; } = string.Empty;

    public string? TextSha256 { get; set; }

    public string? Locale { get; set; }

    public DateTime AgreedAt { get; set; }

    public string? IpHash { get; set; }

    public string? UserAgent { get; set; }

    public bool? CaptchaVerified { get; set; }

    public bool IsBackfilled { get; set; }
}

public sealed class DataSubjectRequestEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CandidateId { get; set; }

    public string RequestType { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public string Source { get; set; } = string.Empty;

    public string? Reason { get; set; }

    public Guid? RequestedByUserId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class ConsentCandidateEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Email { get; set; } = string.Empty;
}

public sealed class ConsentOrganizationEntity
{
    public Guid Id { get; set; }

    public string Slug { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
