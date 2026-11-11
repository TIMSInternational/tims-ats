using Microsoft.EntityFrameworkCore;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// The assessment-provider connector's context (AS-5). It OWNS the DDL of four org-scoped tables (ledger
/// <c>efcore[]</c>, migration <c>20261107232524_assessment_providers</c>, RLS ENABLE + FORCE + <c>tenant_isolation</c>,
/// no grants to <c>anon</c>/<c>authenticated</c>):
/// <list type="bullet">
/// <item><c>assessment_provider_bindings</c> — one per org: the provider tenant id and the enabled instruments. Written
/// only by the platform owner on the privileged connection; <c>app_tenant</c> may only SELECT it.</item>
/// <item><c>assessment_provider_attempts</c> — one per (candidate, vacancy, instrument) assignment, with the provider's
/// external refs, the pinned instrument/content versions, the job-relatedness reason and the accommodations.</item>
/// <item><c>assessment_provider_results</c> — the typed result (latest revision) with its content/norm/scoring versions,
/// validity, the FIT value, and the provider's <c>scores</c> object for the HR view.</item>
/// <item><c>assessment_provider_webhook_inbox</c> — one row per received event id: de-duplication and an audit trail
/// of what each delivery did.</item>
/// <item><c>assessment_provider_settings</c> — one per org: HR's assessment security settings (proctoring), migration
/// <c>assessment_provider_proctoring</c>. <c>app_tenant</c> may SELECT, INSERT and UPDATE it (never DELETE).</item>
/// </list>
/// It also maps Prisma-owned rows READ-ONLY (candidates, applications, vacancies, job_profiles, data_consents,
/// organizations) and appends <c>audit_logs</c>; those are <c>ExcludeFromMigrations</c>, so the migration can never
/// create or alter a table this context does not own. No navigation properties.
/// </summary>
public sealed class AssessmentProviderDbContext(DbContextOptions<AssessmentProviderDbContext> options) : DbContext(options)
{
    public const string BindingsTable = "assessment_provider_bindings";
    public const string AttemptsTable = "assessment_provider_attempts";
    public const string ResultsTable = "assessment_provider_results";
    public const string InboxTable = "assessment_provider_webhook_inbox";
    public const string SettingsTable = "assessment_provider_settings";

    public DbSet<ProviderBindingEntity> Bindings => Set<ProviderBindingEntity>();

    public DbSet<ProviderAttemptEntity> Attempts => Set<ProviderAttemptEntity>();

    public DbSet<ProviderResultEntity> Results => Set<ProviderResultEntity>();

    public DbSet<ProviderWebhookInboxEntity> Inbox => Set<ProviderWebhookInboxEntity>();

    public DbSet<ProviderSettingsEntity> Settings => Set<ProviderSettingsEntity>();

    public DbSet<ProviderCandidateRef> Candidates => Set<ProviderCandidateRef>();

    public DbSet<ProviderApplicationRef> Applications => Set<ProviderApplicationRef>();

    public DbSet<ProviderVacancyRef> Vacancies => Set<ProviderVacancyRef>();

    public DbSet<ProviderJobProfileRef> JobProfiles => Set<ProviderJobProfileRef>();

    public DbSet<ProviderDataConsentRef> DataConsents => Set<ProviderDataConsentRef>();

    public DbSet<ProviderOrganizationRef> Organizations => Set<ProviderOrganizationRef>();

    public DbSet<AuditLogEntity> AuditLogs => Set<AuditLogEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureOwnedTables(modelBuilder);
        ConfigurePrismaReadModels(modelBuilder);
    }

    private static string InList(IEnumerable<string> values) =>
        string.Join(", ", values.Select(v => "'" + v.Replace("'", "''", StringComparison.Ordinal) + "'"));

    private static string TextArray(IEnumerable<string> values) => $"ARRAY[{InList(values)}]::text[]";

    private static void ConfigureOwnedTables(ModelBuilder modelBuilder)
    {
        var instruments = InList(ProviderInstruments.All);
        var localeCheck = "~ '^[a-z]{2}(-[A-Z]{2})?$'";

        modelBuilder.Entity<ProviderBindingEntity>(entity =>
        {
            entity.ToTable(BindingsTable, t =>
            {
                t.HasCheckConstraint("ck_assessment_provider_bindings_provider", $"provider = '{ProviderNames.TimsAssessments}'");
                t.HasCheckConstraint("ck_assessment_provider_bindings_instruments",
                    $"enabled_instruments <@ {TextArray(ProviderInstruments.All)}");
                t.HasCheckConstraint("ck_assessment_provider_bindings_locale", $"default_locale {localeCheck}");
            });
            entity.HasKey(b => b.Id);
            entity.Property(b => b.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(b => b.OrganizationId).HasColumnName("organization_id");
            entity.Property(b => b.Provider).HasColumnName("provider");
            entity.Property(b => b.ProviderTenantId).HasColumnName("provider_tenant_id");
            entity.Property(b => b.EnabledInstruments).HasColumnName("enabled_instruments").HasDefaultValueSql("'{}'::text[]");
            entity.Property(b => b.DefaultLocale).HasColumnName("default_locale");
            entity.Property(b => b.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            entity.Property(b => b.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(b => b.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("now()");
            entity.HasIndex(b => new { b.OrganizationId, b.Provider }).IsUnique()
                .HasDatabaseName("ux_assessment_provider_bindings_org_provider");
            entity.HasIndex(b => new { b.Provider, b.ProviderTenantId }).IsUnique()
                .HasDatabaseName("ux_assessment_provider_bindings_provider_tenant");
        });

        modelBuilder.Entity<ProviderAttemptEntity>(entity =>
        {
            entity.ToTable(AttemptsTable, t =>
            {
                t.HasCheckConstraint("ck_assessment_provider_attempts_instrument", $"instrument IN ({instruments})");
                t.HasCheckConstraint("ck_assessment_provider_attempts_state", $"state IN ({InList(ProviderAttemptStates.All)})");
                t.HasCheckConstraint("ck_assessment_provider_attempts_purpose", "purpose = 'selection'");
                t.HasCheckConstraint("ck_assessment_provider_attempts_reason",
                    $"char_length(job_relatedness_reason) BETWEEN {ProviderFormats.MinReasonLength} AND {ProviderFormats.MaxReasonLength}");
                t.HasCheckConstraint("ck_assessment_provider_attempts_locale", $"locale {localeCheck}");
                t.HasCheckConstraint("ck_assessment_provider_attempts_time_multiplier", "time_multiplier BETWEEN 1 AND 3");
                t.HasCheckConstraint("ck_assessment_provider_attempts_aids", $"aids <@ {TextArray(AccommodationAids.All)}");
                t.HasCheckConstraint("ck_assessment_provider_attempts_required_consents",
                    $"required_consents <@ {TextArray(ConsentPurposes.All)}");
                t.HasCheckConstraint("ck_assessment_provider_attempts_instrument_version",
                    "instrument_version IS NULL OR instrument_version ~ '^[0-9]{1,3}\\.[0-9]{1,3}$'");
                t.HasCheckConstraint("ck_assessment_provider_attempts_content_version",
                    "content_version IS NULL OR char_length(content_version) <= 64");
                t.HasCheckConstraint("ck_assessment_provider_attempts_error_code",
                    "last_error_code IS NULL OR char_length(last_error_code) <= 64");
                t.HasCheckConstraint("ck_assessment_provider_attempts_withdrawal_state",
                    $"withdrawal_state IS NULL OR withdrawal_state IN ({InList(ProviderWithdrawalStates.All)})");
                t.HasCheckConstraint("ck_assessment_provider_attempts_consent_capture",
                    "consent_capture_generation >= 0 AND consent_captures_in_flight >= 0");
                t.HasCheckConstraint("ck_assessment_provider_attempts_missing_consents",
                    $"missing_consents <@ {TextArray(ConsentPurposes.All)}");
                t.HasCheckConstraint("ck_assessment_provider_attempts_poll_lease",
                    "(poll_lease_owner IS NULL) = (poll_lease_until IS NULL)");
                t.HasCheckConstraint("ck_assessment_provider_attempts_age_band",
                    $"age_band IS NULL OR age_band IN ({InList(ProviderAgeBands.All)})");
                t.HasCheckConstraint("ck_assessment_provider_attempts_withdrawal_lease",
                    "(withdrawal_lease_owner IS NULL) = (withdrawal_lease_until IS NULL)");
                t.HasCheckConstraint("ck_assessment_provider_attempts_optional_consents",
                    $"granted_optional_consents <@ {TextArray(ConsentPurposes.All)} "
                    + $"AND declined_optional_consents <@ {TextArray(ConsentPurposes.All)} "
                    + "AND NOT (granted_optional_consents && declined_optional_consents)");
                // The proctoring snapshot is all-or-nothing (the anti-cheat pair may be null inside a block).
                t.HasCheckConstraint("ck_assessment_provider_attempts_proctoring",
                    "(proctoring_lockdown IS NULL) = (proctoring_identity_check IS NULL) "
                    + "AND (proctoring_anti_cheat_threshold IS NULL) = (proctoring_anti_cheat_consequence IS NULL) "
                    + "AND (proctoring_anti_cheat_threshold IS NULL OR proctoring_lockdown IS NOT NULL) "
                    + $"AND (proctoring_anti_cheat_threshold IS NULL OR proctoring_anti_cheat_threshold BETWEEN {AntiCheatPolicy.MinThreshold} AND {AntiCheatPolicy.MaxThreshold}) "
                    + $"AND (proctoring_anti_cheat_consequence IS NULL OR proctoring_anti_cheat_consequence IN ({InList(AntiCheatConsequences.All)}))");
                t.HasCheckConstraint("ck_assessment_provider_attempts_completed_by",
                    $"completed_by IS NULL OR completed_by IN ({InList(ProviderCompletionCauses.All)})");
                t.HasCheckConstraint("ck_assessment_provider_attempts_void_reason",
                    $"void_reason IS NULL OR void_reason IN ({InList(ProviderVoidReasons.All)})");
                // Past pending_create every attempt must carry the provider's ids (a cancelled one may never have had them).
                t.HasCheckConstraint("ck_assessment_provider_attempts_external_ids",
                    "state IN ('pending_create', 'cancelled') OR (provider_assignment_id IS NOT NULL AND provider_subject_id IS NOT NULL)");
            });
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.BindingId).HasColumnName("binding_id");
            entity.Property(a => a.CandidateId).HasColumnName("candidate_id");
            entity.Property(a => a.VacancyId).HasColumnName("vacancy_id");
            entity.Property(a => a.Instrument).HasColumnName("instrument");
            entity.Property(a => a.State).HasColumnName("state");
            entity.Property(a => a.Purpose).HasColumnName("purpose");
            entity.Property(a => a.JobRelatednessReason).HasColumnName("job_relatedness_reason");
            entity.Property(a => a.Locale).HasColumnName("locale");
            entity.Property(a => a.TimeMultiplier).HasColumnName("time_multiplier").HasColumnType("numeric(3,2)");
            entity.Property(a => a.Aids).HasColumnName("aids").HasDefaultValueSql("'{}'::text[]");
            entity.Property(a => a.RequestedExpiresAt).HasColumnName("requested_expires_at");
            entity.Property(a => a.ProviderSubjectId).HasColumnName("provider_subject_id");
            entity.Property(a => a.ProviderAssignmentId).HasColumnName("provider_assignment_id");
            entity.Property(a => a.InstrumentVersion).HasColumnName("instrument_version");
            entity.Property(a => a.ContentVersion).HasColumnName("content_version");
            entity.Property(a => a.RequiredConsents).HasColumnName("required_consents").HasDefaultValueSql("'{}'::text[]");
            entity.Property(a => a.ExpiresAt).HasColumnName("expires_at");
            entity.Property(a => a.StartedAt).HasColumnName("started_at");
            entity.Property(a => a.CompletedAt).HasColumnName("completed_at");
            entity.Property(a => a.LastLaunchedAt).HasColumnName("last_launched_at");
            entity.Property(a => a.LatestResultId).HasColumnName("latest_result_id");
            entity.Property(a => a.ResultVisibilityGeneration).HasColumnName("result_visibility_generation").HasDefaultValue(0);
            entity.Property(a => a.LastErrorCode).HasColumnName("last_error_code");
            entity.Property(a => a.WithdrawalState).HasColumnName("withdrawal_state");
            entity.Property(a => a.ProviderErasureRequestedAt).HasColumnName("provider_erasure_requested_at");
            entity.Property(a => a.ConsentCaptureGeneration).HasColumnName("consent_capture_generation").HasDefaultValue(0);
            entity.Property(a => a.ConsentCapturesInFlight).HasColumnName("consent_captures_in_flight").HasDefaultValue(0);
            entity.Property(a => a.ConsentCaptureStartedAt).HasColumnName("consent_capture_started_at");
            entity.Property(a => a.MissingConsents).HasColumnName("missing_consents").HasDefaultValueSql("'{}'::text[]");
            entity.Property(a => a.PollLeaseOwner).HasColumnName("poll_lease_owner");
            entity.Property(a => a.PollLeaseUntil).HasColumnName("poll_lease_until");
            entity.Property(a => a.LastPolledAt).HasColumnName("last_polled_at");
            entity.Property(a => a.AgeBand).HasColumnName("age_band");
            entity.Property(a => a.CreateStartedAt).HasColumnName("create_started_at");
            entity.Property(a => a.CreateFences).HasColumnName("create_fences")
                .HasColumnType("timestamp with time zone[]").HasDefaultValueSql("'{}'::timestamptz[]");
            entity.Property(a => a.WithdrawalLeaseOwner).HasColumnName("withdrawal_lease_owner");
            entity.Property(a => a.WithdrawalLeaseUntil).HasColumnName("withdrawal_lease_until");
            entity.Property(a => a.GrantedOptionalConsents).HasColumnName("granted_optional_consents")
                .HasDefaultValueSql("'{}'::text[]");
            entity.Property(a => a.DeclinedOptionalConsents).HasColumnName("declined_optional_consents")
                .HasDefaultValueSql("'{}'::text[]");
            entity.Property(a => a.ProctoringLockdown).HasColumnName("proctoring_lockdown");
            entity.Property(a => a.ProctoringAntiCheatThreshold).HasColumnName("proctoring_anti_cheat_threshold");
            entity.Property(a => a.ProctoringAntiCheatConsequence).HasColumnName("proctoring_anti_cheat_consequence");
            entity.Property(a => a.ProctoringIdentityCheck).HasColumnName("proctoring_identity_check");
            entity.Property(a => a.CompletedBy).HasColumnName("completed_by");
            entity.Property(a => a.VoidReason).HasColumnName("void_reason");
            entity.Property(a => a.AssignedById).HasColumnName("assigned_by_id");
            entity.Property(a => a.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(a => a.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("now()");
            entity.HasOne<ProviderBindingEntity>().WithMany().HasForeignKey(a => a.BindingId)
                .OnDelete(DeleteBehavior.Restrict).HasConstraintName("fk_assessment_provider_attempts_binding");
            entity.HasIndex(a => a.BindingId).HasDatabaseName("ix_assessment_provider_attempts_binding");
            entity.HasIndex(a => new { a.OrganizationId, a.CandidateId, a.VacancyId })
                .HasDatabaseName("ix_assessment_provider_attempts_candidate_vacancy");
            entity.HasIndex(a => new { a.OrganizationId, a.ProviderSubjectId })
                .HasDatabaseName("ix_assessment_provider_attempts_subject");
            entity.HasIndex(a => new { a.OrganizationId, a.ProviderAssignmentId }).IsUnique()
                .HasDatabaseName("ux_assessment_provider_attempts_provider_assignment");
            // The withdrawal cascade's work queue (D15): attempts whose provider-side withdrawal is not confirmed yet.
            entity.HasIndex(a => new { a.OrganizationId, a.CandidateId })
                .HasFilter($"withdrawal_state = '{ProviderWithdrawalStates.Pending}'")
                .HasDatabaseName("ix_assessment_provider_attempts_withdrawal_pending");
            // The D17 poller's work queue: mapped attempts whose sitting or result may still change, by staleness.
            entity.HasIndex(a => new { a.OrganizationId, a.LastPolledAt })
                .HasFilter("provider_assignment_id IS NOT NULL AND withdrawal_state IS NULL "
                    + "AND provider_erasure_requested_at IS NULL "
                    + $"AND state IN ({InList(ProviderAttemptPolling.PollableStates)})")
                .HasDatabaseName("ix_assessment_provider_attempts_poll");
            // Idempotency backstop: at most one OPEN attempt per candidate + vacancy + instrument, even under a race.
            entity.HasIndex(a => new { a.OrganizationId, a.CandidateId, a.VacancyId, a.Instrument }).IsUnique()
                .HasFilter($"state IN ({InList(ProviderAttemptStates.Open)})")
                .HasDatabaseName("ux_assessment_provider_attempts_open");
        });

        modelBuilder.Entity<ProviderSettingsEntity>(entity =>
        {
            entity.ToTable(SettingsTable, t =>
            {
                t.HasCheckConstraint("ck_assessment_provider_settings_anti_cheat",
                    "(anti_cheat_threshold IS NULL) = (anti_cheat_consequence IS NULL) "
                    + $"AND (anti_cheat_threshold IS NULL OR anti_cheat_threshold BETWEEN {AntiCheatPolicy.MinThreshold} AND {AntiCheatPolicy.MaxThreshold}) "
                    + $"AND (anti_cheat_consequence IS NULL OR anti_cheat_consequence IN ({InList(AntiCheatConsequences.All)}))");
            });
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(x => x.OrganizationId).HasColumnName("organization_id");
            entity.Property(x => x.ProctoringLockdown).HasColumnName("proctoring_lockdown").HasDefaultValue(false);
            entity.Property(x => x.AntiCheatThreshold).HasColumnName("anti_cheat_threshold");
            entity.Property(x => x.AntiCheatConsequence).HasColumnName("anti_cheat_consequence");
            entity.Property(x => x.IdentityCheck).HasColumnName("identity_check").HasDefaultValue(false);
            entity.Property(x => x.UpdatedById).HasColumnName("updated_by_id");
            entity.Property(x => x.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("now()");
            // One row per organization: the upsert's conflict target, and its tenant-filter index.
            entity.HasIndex(x => x.OrganizationId).IsUnique().HasDatabaseName("ux_assessment_provider_settings_org");
        });

        modelBuilder.Entity<ProviderResultEntity>(entity =>
        {
            entity.ToTable(ResultsTable, t =>
            {
                t.HasCheckConstraint("ck_assessment_provider_results_instrument", $"instrument IN ({instruments})");
                t.HasCheckConstraint("ck_assessment_provider_results_schema",
                    $"result_schema IN ({InList(ProviderInstruments.All.Select(i => ProviderInstruments.ResultSchemaFor(i)!))})");
                t.HasCheckConstraint("ck_assessment_provider_results_revision", "result_revision >= 1");
                t.HasCheckConstraint("ck_assessment_provider_results_purpose", "purpose = 'selection'");
                t.HasCheckConstraint("ck_assessment_provider_results_validity",
                    $"validity_status IN ({InList(ProviderValidity.All)})");
                t.HasCheckConstraint("ck_assessment_provider_results_scoring_method",
                    "scoring_method IN ('deterministic', 'ai_assisted', 'provider')");
                t.HasCheckConstraint("ck_assessment_provider_results_completion", "completion IN ('complete', 'partial')");
                t.HasCheckConstraint("ck_assessment_provider_results_rendering",
                    "rendered_for = 'tenant_hr' AND rendered_level IN ('summary', 'full')");
                t.HasCheckConstraint("ck_assessment_provider_results_sha256", "content_sha256 ~ '^[a-f0-9]{64}$'");
                t.HasCheckConstraint("ck_assessment_provider_results_percentile",
                    "global_percentile IS NULL OR (global_percentile >= 0 AND global_percentile <= 100)");
                t.HasCheckConstraint("ck_assessment_provider_results_cefr",
                    "cefr IS NULL OR cefr IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')");
                t.HasCheckConstraint("ck_assessment_provider_results_level", "level IS NULL OR level BETWEEN 1 AND 5");
                t.HasCheckConstraint("ck_assessment_provider_results_time_multiplier",
                    "time_multiplier_applied BETWEEN 1 AND 3");
            });
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.AttemptId).HasColumnName("attempt_id");
            entity.Property(r => r.ProviderResultId).HasColumnName("provider_result_id");
            entity.Property(r => r.ResultRevision).HasColumnName("result_revision");
            entity.Property(r => r.ResultSchema).HasColumnName("result_schema");
            entity.Property(r => r.Instrument).HasColumnName("instrument");
            entity.Property(r => r.InstrumentVersion).HasColumnName("instrument_version");
            entity.Property(r => r.ContentVersion).HasColumnName("content_version");
            entity.Property(r => r.ContentSha256).HasColumnName("content_sha256");
            entity.Property(r => r.NormVersion).HasColumnName("norm_version");
            entity.Property(r => r.ScoringVersion).HasColumnName("scoring_version");
            entity.Property(r => r.ScoringMethod).HasColumnName("scoring_method");
            entity.Property(r => r.Purpose).HasColumnName("purpose");
            entity.Property(r => r.ValidityStatus).HasColumnName("validity_status");
            entity.Property(r => r.ValidityReasons).HasColumnName("validity_reasons").HasDefaultValueSql("'{}'::text[]");
            entity.Property(r => r.RequiresHumanReview).HasColumnName("requires_human_review").HasDefaultValue(false);
            entity.Property(r => r.Completion).HasColumnName("completion");
            entity.Property(r => r.GlobalPercentile).HasColumnName("global_percentile");
            entity.Property(r => r.Cefr).HasColumnName("cefr");
            entity.Property(r => r.Level).HasColumnName("level");
            entity.Property(r => r.TimeMultiplierApplied).HasColumnName("time_multiplier_applied").HasColumnType("numeric(3,2)");
            entity.Property(r => r.RenderedFor).HasColumnName("rendered_for");
            entity.Property(r => r.RenderedLevel).HasColumnName("rendered_level");
            entity.Property(r => r.Scores).HasColumnName("scores").HasColumnType("jsonb");
            entity.Property(r => r.CompletedAt).HasColumnName("completed_at");
            entity.Property(r => r.ScoredAt).HasColumnName("scored_at");
            entity.Property(r => r.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(r => r.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("now()");
            entity.HasOne<ProviderAttemptEntity>().WithMany().HasForeignKey(r => r.AttemptId)
                .OnDelete(DeleteBehavior.Restrict).HasConstraintName("fk_assessment_provider_results_attempt");
            entity.HasIndex(r => r.AttemptId).HasDatabaseName("ix_assessment_provider_results_attempt");
            entity.HasIndex(r => new { r.OrganizationId, r.ProviderResultId }).IsUnique()
                .HasDatabaseName("ux_assessment_provider_results_provider_result");
        });

        modelBuilder.Entity<ProviderWebhookInboxEntity>(entity =>
        {
            entity.ToTable(InboxTable, t =>
            {
                t.HasCheckConstraint("ck_assessment_provider_webhook_inbox_type",
                    $"event_type IN ({InList(ProviderEventTypes.All)})");
                t.HasCheckConstraint("ck_assessment_provider_webhook_inbox_version", "event_version = 1");
                t.HasCheckConstraint("ck_assessment_provider_webhook_inbox_status",
                    "status IN ('received', 'processed', 'ignored', 'failed')");
                t.HasCheckConstraint("ck_assessment_provider_webhook_inbox_attempts", "processing_attempts >= 0");
                t.HasCheckConstraint("ck_assessment_provider_webhook_inbox_error_code",
                    "last_error_code IS NULL OR char_length(last_error_code) <= 64");
                t.HasCheckConstraint("ck_assessment_provider_webhook_inbox_lease",
                    "(lease_owner IS NULL) = (lease_until IS NULL)");
            });
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(i => i.OrganizationId).HasColumnName("organization_id");
            entity.Property(i => i.EventId).HasColumnName("event_id");
            entity.Property(i => i.EventType).HasColumnName("event_type");
            entity.Property(i => i.EventVersion).HasColumnName("event_version");
            entity.Property(i => i.ProviderTenantId).HasColumnName("provider_tenant_id");
            entity.Property(i => i.OccurredAt).HasColumnName("occurred_at");
            entity.Property(i => i.DeliveryAttempt).HasColumnName("delivery_attempt");
            entity.Property(i => i.Status).HasColumnName("status");
            entity.Property(i => i.ProcessingAttempts).HasColumnName("processing_attempts").HasDefaultValue(0);
            entity.Property(i => i.LastErrorCode).HasColumnName("last_error_code");
            entity.Property(i => i.Data).HasColumnName("data").HasColumnType("jsonb");
            entity.Property(i => i.ReceivedAt).HasColumnName("received_at").HasDefaultValueSql("now()");
            entity.Property(i => i.ProcessedAt).HasColumnName("processed_at");
            entity.Property(i => i.NextAttemptAt).HasColumnName("next_attempt_at");
            entity.Property(i => i.LeaseOwner).HasColumnName("lease_owner");
            entity.Property(i => i.LeaseUntil).HasColumnName("lease_until");
            // The inbox worker's queue: rows still to (re)process, by due time.
            entity.HasIndex(i => new { i.OrganizationId, i.NextAttemptAt })
                .HasFilter("next_attempt_at IS NOT NULL")
                .HasDatabaseName("ix_assessment_provider_webhook_inbox_due");
            entity.HasIndex(i => new { i.OrganizationId, i.EventId }).IsUnique()
                .HasDatabaseName("ux_assessment_provider_webhook_inbox_event");
        });
    }

    // Prisma-OWNED tables, read-only here (and audit_logs, append-only). ExcludeFromMigrations keeps them out of every
    // migration this context generates. Prisma `timestamp(3)` columns are only compared to NULL.
    private static void ConfigurePrismaReadModels(ModelBuilder modelBuilder)
    {
        modelBuilder.ConfigureAuditLogs();
        modelBuilder.Entity<AuditLogEntity>().ToTable("audit_logs", t => t.ExcludeFromMigrations());

        modelBuilder.Entity<ProviderCandidateRef>(entity =>
        {
            entity.ToTable("candidates", t => t.ExcludeFromMigrations());
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.FirstName).HasColumnName("first_name");
            entity.Property(c => c.LastName).HasColumnName("last_name");
            entity.Property(c => c.Email).HasColumnName("email");
            entity.Property(c => c.IsActive).HasColumnName("is_active");
            entity.Property(c => c.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<ProviderApplicationRef>(entity =>
        {
            entity.ToTable("applications", t => t.ExcludeFromMigrations());
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.CandidateId).HasColumnName("candidate_id");
            entity.Property(a => a.VacancyId).HasColumnName("vacancy_id");
            entity.Property(a => a.Status).HasColumnName("status");
        });

        modelBuilder.Entity<ProviderVacancyRef>(entity =>
        {
            entity.ToTable("vacancies", t => t.ExcludeFromMigrations());
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.OrganizationId).HasColumnName("organization_id");
            entity.Property(v => v.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<ProviderJobProfileRef>(entity =>
        {
            entity.ToTable("job_profiles", t => t.ExcludeFromMigrations());
            entity.HasKey(j => j.Id);
            entity.Property(j => j.Id).HasColumnName("id");
            entity.Property(j => j.OrganizationId).HasColumnName("organization_id");
            entity.Property(j => j.VacancyId).HasColumnName("vacancy_id");
            entity.Property(j => j.FitRequirements).HasColumnName("fit_requirements").HasColumnType("jsonb");
        });

        modelBuilder.Entity<ProviderDataConsentRef>(entity =>
        {
            entity.ToTable("data_consents", t => t.ExcludeFromMigrations());
            entity.HasKey(d => d.Id);
            entity.Property(d => d.Id).HasColumnName("id");
            entity.Property(d => d.OrganizationId).HasColumnName("organization_id");
            entity.Property(d => d.SubjectUserId).HasColumnName("subject_user_id");
            entity.Property(d => d.ConsentType).HasColumnName("consent_type");
            entity.Property(d => d.WithdrawnAt).HasColumnName("withdrawn_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<ProviderOrganizationRef>(entity =>
        {
            entity.ToTable("organizations", t => t.ExcludeFromMigrations());
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.Name).HasColumnName("name");
            entity.Property(o => o.Slug).HasColumnName("slug");
            entity.Property(o => o.IsActive).HasColumnName("is_active");
            entity.Property(o => o.DeletedAt).HasColumnName("deleted_at").HasColumnType("timestamp");
        });
    }
}
