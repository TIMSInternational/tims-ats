using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// AS-5 real-RLS proof for the four EF-OWNED provider tables. One Postgres container that reproduces the production
/// privilege shape BEFORE the migration runs:
/// <list type="bullet">
/// <item><c>app_tenant</c> (NOLOGIN, NOBYPASSRLS, granted to the superuser login so <c>SET LOCAL ROLE</c> works), and
/// Supabase's <c>anon</c>/<c>authenticated</c>;</item>
/// <item>production's default ACL — every new table grants SELECT/INSERT/UPDATE/DELETE to <c>app_tenant</c> — plus
/// Supabase's grant of everything to <c>anon</c>/<c>authenticated</c>, so the migration's own REVOKEs are what the
/// privilege assertions measure (without the default ACL they would pass vacuously).</item>
/// </list>
/// Then the ACTUAL migration <c>20261107232524_assessment_providers</c> is applied with <see cref="DatabaseFacade.MigrateAsync"/>,
/// minimal stand-ins for the Prisma-owned tables the repository reads are created, and two orgs are seeded as the
/// superuser (which bypasses RLS).
/// </summary>
public sealed class AssessmentProviderSchemaFixture : IAsyncLifetime
{
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid TenantA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000a1");
    public static readonly Guid TenantB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000b1");
    public static readonly Guid BindingA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000b0");
    public static readonly Guid BindingB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000b0");
    public static readonly Guid CandidateA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000c1");
    public static readonly Guid CandidateB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000c1");
    public static readonly Guid VacancyA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000f1");
    public static readonly Guid VacancyB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000f1");
    public static readonly Guid AttemptA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000e1");
    public static readonly Guid AttemptB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000e1");
    public static readonly Guid ResultA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000d1");
    public static readonly Guid ResultB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000d1");
    public static readonly Guid ProviderAssignmentA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000aa");
    public static readonly Guid ProviderAssignmentB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000aa");
    public static readonly Guid EventA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000ee");
    public static readonly Guid EventB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000ee");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .WithDatabase("tims_assessment_providers")
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        await ExecuteAsync(
            """
            CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
            CREATE ROLE anon NOLOGIN;
            CREATE ROLE authenticated NOLOGIN;
            GRANT app_tenant TO postgres;
            ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
            ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
                GRANT ALL ON TABLES TO anon, authenticated;
            """);

        await using (var db = new AssessmentProviderDbContext(BuildOptions(ConnectionString)))
        {
            await db.Database.MigrateAsync();
        }

        await ExecuteAsync(PrismaStandIns);
        await SeedAsync();
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public static DbContextOptions<AssessmentProviderDbContext> BuildOptions(string connectionString) =>
        new DbContextOptionsBuilder<AssessmentProviderDbContext>().UseNpgsql(connectionString).Options;

    public AssessmentProviderDbContext NewContext() => new(BuildOptions(ConnectionString));

    public async Task<object?> ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteScalarAsync();
    }

    public async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    // Minimal shapes of the Prisma-OWNED tables the repository reads (only the mapped columns), created AFTER the
    // migration so it is proven not to need them. Tenant-isolated like production, so a missing org filter would show.
    private const string PrismaStandIns =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
            deleted_at timestamp NULL);
        CREATE TABLE candidates (id uuid PRIMARY KEY, organization_id uuid NOT NULL, first_name text NOT NULL,
            last_name text NOT NULL, email text NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamp NULL);
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, deleted_at timestamp NULL);
        CREATE TABLE applications (id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL,
            vacancy_id uuid NOT NULL, status text NOT NULL);
        CREATE TABLE job_profiles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, vacancy_id uuid NOT NULL,
            fit_requirements jsonb NULL);
        CREATE TABLE data_consents (id uuid PRIMARY KEY, organization_id uuid NOT NULL, subject_user_id uuid NOT NULL,
            consent_type text NOT NULL, withdrawn_at timestamp NULL);
        CREATE TABLE audit_logs (id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NULL, actor_id uuid NULL,
            action text NOT NULL, entity text NOT NULL, entity_id text NULL, changes jsonb NULL, metadata jsonb NULL,
            ip_address text NULL, user_agent text NULL, created_at timestamp NOT NULL DEFAULT now());
        DO $$
        DECLARE t text;
        BEGIN
          FOREACH t IN ARRAY ARRAY['candidates', 'vacancies', 'applications', 'job_profiles', 'data_consents', 'audit_logs'] LOOP
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)', t);
          END LOOP;
        END $$;
        """;

    private async Task SeedAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var seed = connection.CreateCommand();
        seed.CommandText =
            """
            INSERT INTO organizations (id, name) VALUES (@orgA, 'Org A'), (@orgB, 'Org B');
            INSERT INTO candidates (id, organization_id, first_name, last_name, email)
            VALUES (@candA, @orgA, 'Ada', 'Alpha', 'ada@a.example'), (@candB, @orgB, 'Ben', 'Bravo', 'ben@b.example');
            INSERT INTO vacancies (id, organization_id) VALUES (@vacA, @orgA), (@vacB, @orgB);
            INSERT INTO assessment_provider_bindings (id, organization_id, provider, provider_tenant_id, enabled_instruments, default_locale)
            VALUES (@bindA, @orgA, 'tims-assessments', @tenantA, ARRAY['lia','english'], 'es'),
                   (@bindB, @orgB, 'tims-assessments', @tenantB, ARRAY['lia'], 'es');
            INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                instrument_version, content_version, latest_result_id, assigned_by_id)
            VALUES (@attA, @orgA, @bindA, @candA, @vacA, 'lia', 'result_ready', 'selection', 'Análisis de datos', 'es', 1.5,
                    gen_random_uuid(), @paA, '1.0', 'content-1', @resA, gen_random_uuid()),
                   (@attB, @orgB, @bindB, @candB, @vacB, 'lia', 'result_ready', 'selection', 'Análisis de datos', 'es', 1,
                    gen_random_uuid(), @paB, '1.0', 'content-1', @resB, gen_random_uuid());
            INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
                scoring_method, purpose, validity_status, completion, global_percentile, time_multiplier_applied,
                rendered_for, rendered_level, completed_at, scored_at)
            VALUES (gen_random_uuid(), @orgA, @attA, @resA, 1, 'LiaResultV1', 'lia', '1.0', 'content-1', repeat('a', 64),
                    'norms-1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 46.2, 1.5, 'tenant_hr', 'full',
                    now(), now()),
                   (gen_random_uuid(), @orgB, @attB, @resB, 1, 'LiaResultV1', 'lia', '1.0', 'content-1', repeat('b', 64),
                    'norms-1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 88, 1, 'tenant_hr', 'full',
                    now(), now());
            INSERT INTO assessment_provider_webhook_inbox (id, organization_id, event_id, event_type, event_version,
                provider_tenant_id, occurred_at, status, data)
            VALUES (gen_random_uuid(), @orgA, @evA, 'result.ready', 1, @tenantA, now(), 'processed', '{}'),
                   (gen_random_uuid(), @orgB, @evB, 'result.ready', 1, @tenantB, now(), 'processed', '{}');
            """;
        foreach (var (name, value) in new (string, Guid)[]
        {
            ("orgA", OrgA), ("orgB", OrgB), ("tenantA", TenantA), ("tenantB", TenantB), ("bindA", BindingA), ("bindB", BindingB),
            ("candA", CandidateA), ("candB", CandidateB), ("vacA", VacancyA), ("vacB", VacancyB), ("attA", AttemptA),
            ("attB", AttemptB), ("resA", ResultA), ("resB", ResultB), ("paA", ProviderAssignmentA), ("paB", ProviderAssignmentB),
            ("evA", EventA), ("evB", EventB),
        })
        {
            seed.Parameters.AddWithValue(name, value);
        }

        await seed.ExecuteNonQueryAsync();
    }
}

[CollectionDefinition("AssessmentProviderRls")]
public sealed class AssessmentProviderRlsCollection : ICollectionFixture<AssessmentProviderSchemaFixture>;
