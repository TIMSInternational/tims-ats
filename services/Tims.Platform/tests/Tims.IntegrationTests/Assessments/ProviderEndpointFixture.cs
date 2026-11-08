using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// AS-5 endpoint fixture: one real Postgres with the production privilege shape (NOLOGIN/NOBYPASSRLS
/// <c>app_tenant</c> + the default ACL), the ACTUAL provider migration applied, the identity/RBAC plane the staff and
/// platform-owner gates read, and minimal Prisma stand-ins (tenant-isolated) for what the repository and the vacancy
/// scope probe read.
///
/// Principals: Admin = assessment create+update @ organization (OrgA); Own = a leader with create+update @ own (the
/// vacancy is neither assigned to nor created by them → the scope probe 404s; the role slug must be a real staff role,
/// unknown slugs are filtered out before any grant is read); Reader = assessment read only (→ 403); OrgBAdmin;
/// Owner = platform owner (no org). Each test that writes owns its own candidate or attempt.
/// </summary>
public sealed class ProviderEndpointFixture : IAsyncLifetime
{
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid OrgC = Guid.Parse("33333333-3333-3333-3333-333333333333");
    public static readonly Guid TenantA = Guid.Parse("aaaa0000-0000-4000-8000-0000000000a1");
    public static readonly Guid TenantB = Guid.Parse("bbbb0000-0000-4000-8000-0000000000b1");
    public static readonly Guid AdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid VacancyA = Guid.Parse("f0000000-0000-0000-0000-0000000000a1");
    public static readonly Guid VacancyB = Guid.Parse("f0000000-0000-0000-0000-0000000000b1");

    /// <summary>OrgA candidates with an ACTIVE application to VacancyA, one per assign test.</summary>
    public static readonly Guid AssignCandidate = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid TermsCandidate = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    public static readonly Guid ScopeCandidate = Guid.Parse("d0000000-0000-0000-0000-000000000003");

    /// <summary>OrgA, created at the provider: the staff-cancel target.</summary>
    public static readonly Guid CancelAttempt = Guid.Parse("e0000000-0000-0000-0000-000000000001");

    /// <summary>OrgA, created at the provider, never cancelled: the cancel scope/permission target.</summary>
    public static readonly Guid GuardedAttempt = Guid.Parse("e0000000-0000-0000-0000-000000000002");

    /// <summary>OrgA, created at the provider, candidate luz@a.example: the launch target.</summary>
    public static readonly Guid LaunchAttempt = Guid.Parse("e0000000-0000-0000-0000-000000000003");
    public const string LaunchEmail = "luz@a.example";

    /// <summary>OrgB attempt — cross-org cancel target.</summary>
    public static readonly Guid OrgBAttempt = Guid.Parse("e0000000-0000-0000-0000-0000000000b1");

    public const string AdminSub = "sub-ap-admin";
    public const string OwnSub = "sub-ap-own";
    public const string ReaderSub = "sub-ap-read";
    public const string OrgBSub = "sub-ap-orgb";
    public const string OwnerSub = "sub-ap-owner";

    private ProviderTestDatabase? _database;

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        _database = await ProviderTestDatabase.StartAsync("tims_assessment_provider_endpoints");
        ConnectionString = _database.ConnectionString;
        await ExecuteAsync(ProviderTestDatabase.CreateRolesSql +
            """
            ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
            """);
        await using (var db = new AssessmentProviderDbContext(
            new DbContextOptionsBuilder<AssessmentProviderDbContext>().UseNpgsql(ConnectionString).Options))
        {
            await db.Database.MigrateAsync();
        }

        await ExecuteAsync(SchemaSql);
        await ExecuteAsync(SeedSql);
    }

    public async Task DisposeAsync()
    {
        if (_database is not null)
        {
            await _database.DisposeAsync();
        }
    }

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

    // Quotes doubled: the expression is spliced into a format() string literal inside the DO block.
    private const string Tenant = "NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid";

    private static readonly string SchemaSql =
        $"""
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE,
            is_active boolean NOT NULL DEFAULT true, deleted_at timestamp(3) NULL);
        CREATE TABLE users (
            id uuid PRIMARY KEY, organization_id uuid NULL, supabase_user_id text NOT NULL UNIQUE, email text NOT NULL,
            first_name text NOT NULL, last_name text NOT NULL, is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true, deleted_at timestamp(3) NULL);
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');

        CREATE TABLE candidates (id uuid PRIMARY KEY, organization_id uuid NOT NULL, first_name text NOT NULL,
            last_name text NOT NULL, email text NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamp NULL);
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, team_id uuid NULL, assigned_to uuid NULL,
            created_by uuid NULL, business_unit_id uuid NULL, deleted_at timestamp NULL);
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
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
            EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = {Tenant}) WITH CHECK (organization_id = {Tenant})', t);
          END LOOP;
        END $$;
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id, name, slug) VALUES
          ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a'),
          ('22222222-2222-2222-2222-222222222222', 'Org B', 'org-b'),
          ('33333333-3333-3333-3333-333333333333', 'Org C', 'org-c');
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'viewer', 'Viewer'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'recruiter', 'OrgB Recruiter');
        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'assessment', 'create'),
          ('b0000000-0000-0000-0000-000000000002', 'assessment', 'update'),
          ('b0000000-0000-0000-0000-000000000003', 'assessment', 'read');
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'own'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'own'),
          ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'organization'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization');
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-ap-admin', 'admin@tims.test', 'Ana', 'Admin', false),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-ap-own', 'own@tims.test', 'Leo', 'Own', false),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-ap-read', 'read@tims.test', 'Rea', 'Reader', false),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-ap-orgb', 'orgb@tims.test', 'Bob', 'OrgB', false),
          ('c0000000-0000-0000-0000-0000000000ff', NULL, 'sub-ap-owner', 'owner@tims.test', 'Pia', 'Owner', true);
        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('70000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('70000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('70000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('70000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');

        INSERT INTO candidates (id, organization_id, first_name, last_name, email) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ada', 'Alpha', 'ada@a.example'),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Teo', 'Terms', 'teo@a.example'),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sol', 'Scope', 'sol@a.example'),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cai', 'Cancel', 'cai@a.example'),
          ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Gus', 'Guarded', 'gus@a.example'),
          ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Luz', 'Launch', 'luz@a.example'),
          ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Ben', 'Bravo', 'ben@b.example');
        INSERT INTO vacancies (id, organization_id, assigned_to, created_by) VALUES
          ('f0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
          ('f0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0');
        INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status) VALUES
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a1', 'active'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1', 'active'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-0000000000a1', 'active'),
          (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000b1', 'active');
        INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-0000000000a1',
           '{"assessments":[{"instrument":"lia","use":"scored","reason":"Análisis de datos bajo presión de tiempo"}]}'),
          (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-0000000000b1',
           '{"assessments":[{"instrument":"lia","use":"scored","reason":"Análisis de datos"}]}');

        INSERT INTO assessment_provider_bindings (id, organization_id, provider, provider_tenant_id, enabled_instruments, default_locale) VALUES
          ('aaaa0000-0000-4000-8000-0000000000b0', '11111111-1111-1111-1111-111111111111', 'tims-assessments', 'aaaa0000-0000-4000-8000-0000000000a1', ARRAY['lia','english'], 'es'),
          ('bbbb0000-0000-4000-8000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'tims-assessments', 'bbbb0000-0000-4000-8000-0000000000b1', ARRAY['lia'], 'es');
        INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
            purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
            instrument_version, content_version, required_consents, expires_at, assigned_by_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-4000-8000-0000000000b0',
           'd0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-0000000000a1', 'lia', 'created', 'selection',
           'Análisis de datos', 'es', 1.5, gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1', ARRAY['assessment'],
           now() + interval '14 days', 'c0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-4000-8000-0000000000b0',
           'd0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-0000000000a1', 'lia', 'created', 'selection',
           'Análisis de datos', 'es', 1, gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1', ARRAY['assessment'],
           now() + interval '14 days', 'c0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-4000-8000-0000000000b0',
           'd0000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-0000000000a1', 'lia', 'created', 'selection',
           'Análisis de datos', 'es', 1, gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1', ARRAY['assessment'],
           now() + interval '14 days', 'c0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'bbbb0000-0000-4000-8000-0000000000b0',
           'd0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000b1', 'lia', 'created', 'selection',
           'Análisis de datos', 'es', 1, gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1', ARRAY['assessment'],
           now() + interval '14 days', 'c0000000-0000-0000-0000-0000000000b0');
        """;
}

[CollectionDefinition("AssessmentProviderEndpoints")]
public sealed class AssessmentProviderEndpointsCollection : ICollectionFixture<ProviderEndpointFixture>;
