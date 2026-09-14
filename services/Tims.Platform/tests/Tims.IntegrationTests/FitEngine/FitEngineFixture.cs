using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.FitEngine;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// Phase-5 Slice 24 (#90) Testcontainers fixture: one real Postgres carrying the FIT-engine table set —
/// <c>fit_scores</c> + <c>role_family_weight_profiles</c> (strangler-write) with their REAL uniques
/// (<c>(candidate_id, vacancy_id)</c> / <c>(organization_id, name)</c>, so the ON-CONFLICT upserts trip real
/// constraints), the compute read plane (<c>candidates</c>/<c>vacancies</c>/<c>job_profiles</c>/
/// <c>assessment_assignments</c>/<c>assessment_results</c>/<c>ai_interview_sessions</c>/<c>applications</c>),
/// the anchor plane (<c>teams</c>/<c>user_teams</c>/<c>business_units</c>/<c>user_business_units</c>) and the
/// identity/RBAC plane — all under the SAME RLS mechanism as the engagement fixtures (NOLOGIN/NOBYPASSRLS
/// <c>app_tenant</c>, ENABLE + FORCE, fail-closed <c>tenant_isolation</c>).
///
/// Scope seed (OrgA): TeamLead LEADS T1, so <c>VacInTeam</c> (team_id = T1) is inside the leader's vacancy
/// fragment (<c>teamId ∈ ledTeamIds OR assignedTo = self</c>) and <c>VacOutTeam</c> (team_id NULL) is out.
/// OrgAdmin = fit_engine read+create+update @ organization; TeamLead = read+create @ team (narrow — probe
/// bites); ReaderOnly = read @ organization ONLY (the action-parameterization bite: read grant must NOT open
/// the writes); NoGrant = no fit_engine grant. OrgB is a distinct org — its admin holds all three grants and
/// has NO 'Default' weight profile, so the compute-bootstrap case is observable there. Each MUTATING test owns
/// distinct rows (one container, sequential via the "FitEngine" collection).
/// </summary>
public sealed class FitEngineFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_fit_engine";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Staff principals
    public static readonly Guid OrgAdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid ReaderOnlyId = Guid.Parse("c0000000-0000-0000-0000-000000000003");
    public static readonly Guid NoGrantId = Guid.Parse("c0000000-0000-0000-0000-000000000004");
    public static readonly Guid OrgBAdminId = Guid.Parse("c0000000-0000-0000-0000-0000000000b0");

    public const string OrgAdminSub = "sub-fe-org";
    public const string TeamLeadSub = "sub-fe-lead";
    public const string ReaderOnlySub = "sub-fe-reader";
    public const string NoGrantSub = "sub-fe-none";
    public const string OrgBAdminSub = "sub-fe-orgb";

    // Vacancies (OrgA unless noted)
    public static readonly Guid VacInTeam = Guid.Parse("7ac00000-0000-0000-0000-000000000001");   // T1, roleFamily Engineering, has profile
    public static readonly Guid VacOutTeam = Guid.Parse("7ac00000-0000-0000-0000-000000000002");  // no team (leader probe → 404)
    public static readonly Guid VacDeleted = Guid.Parse("7ac00000-0000-0000-0000-000000000003");  // soft-deleted (probe → 404)
    public static readonly Guid VacNoProfile = Guid.Parse("7ac00000-0000-0000-0000-000000000004");// no job_profiles row, roleFamily NULL
    public static readonly Guid VacNoApps = Guid.Parse("7ac00000-0000-0000-0000-000000000005");   // zero active applications
    public static readonly Guid VacRead = Guid.Parse("7ac00000-0000-0000-0000-000000000006");     // T1; READ-ONLY rows (compute never targets it)
    public static readonly Guid VacOrgB = Guid.Parse("7ac00000-0000-0000-0000-0000000000b0");     // OrgB (cross-org → 404)

    // Candidates (OrgA)
    public static readonly Guid CandFull = Guid.Parse("ca000000-0000-0000-0000-000000000001");    // 2y, Licenciatura, English (B2)+Spanish
    public static readonly Guid CandEmpty = Guid.Parse("ca000000-0000-0000-0000-000000000002");   // all person data NULL
    public static readonly Guid CandGhost = Guid.Parse("ca000000-0000-0000-0000-000000000003");   // SOFT-DELETED, active application (TS parity)
    public static readonly Guid CandInactive = Guid.Parse("ca000000-0000-0000-0000-000000000004");// application status 'rejected' → excluded
    public static readonly Guid CandOrder = Guid.Parse("ca000000-0000-0000-0000-000000000005");   // the NULLS-FIRST assessment ordering pin
    public static readonly Guid CandOrgB = Guid.Parse("ca000000-0000-0000-0000-0000000000b1");    // OrgB

    // fit_scores seed rows (READ endpoints)
    public static readonly Guid FsCandFull = Guid.Parse("f5000000-0000-0000-0000-000000000001");  // overall 85
    public static readonly Guid FsCandEmpty = Guid.Parse("f5000000-0000-0000-0000-000000000002"); // overall 40, partial
    public static readonly Guid FsOrgB = Guid.Parse("f5000000-0000-0000-0000-0000000000b0");

    // Weight profiles
    public static readonly Guid WpDefaultA = Guid.Parse("3e000000-0000-0000-0000-000000000001");
    public static readonly Guid WpEngineering = Guid.Parse("3e000000-0000-0000-0000-000000000002");
    public static readonly Guid WpMarketing = Guid.Parse("3e000000-0000-0000-0000-000000000003");
    // OrgB deliberately has NO 'Default' profile (the compute bootstrap creates it).

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using (var role = connection.CreateCommand())
        {
            role.CommandText =
                """
                CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
                GRANT app_tenant TO postgres;
                """;
            await role.ExecuteNonQueryAsync();
        }

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, FitEngineSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public FitEngineReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<FitEngineReadDbContext>().UseNpgsql(ConnectionString).Options);

    public FitEngineWriteDbContext NewWriteContext() =>
        new(new DbContextOptionsBuilder<FitEngineWriteDbContext>().UseNpgsql(ConnectionString).Options);

    public sealed record FitScoreRow(
        Guid Id, double OverallScore, string Breakdown, string Weights, bool IsPartial, DateTime CalculatedAt,
        DateTime CreatedAt, DateTime UpdatedAt, Guid OrganizationId);

    /// <summary>The (candidate, vacancy) fit_scores row via superuser (bypasses RLS), or null.</summary>
    public async Task<FitScoreRow?> GetFitScoreAsync(Guid candidateId, Guid vacancyId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT id, overall_score, breakdown::text, weights::text, is_partial, calculated_at, created_at, "
            + "updated_at, organization_id FROM fit_scores WHERE candidate_id = @c AND vacancy_id = @v";
        command.Parameters.AddWithValue("c", candidateId);
        command.Parameters.AddWithValue("v", vacancyId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new FitScoreRow(
            reader.GetGuid(0), reader.GetDouble(1), reader.GetString(2), reader.GetString(3), reader.GetBoolean(4),
            reader.GetDateTime(5), reader.GetDateTime(6), reader.GetDateTime(7), reader.GetGuid(8));
    }

    /// <summary>The (org, name) weight profile via superuser: id, weights-json + both timestamps, or null.</summary>
    public async Task<(Guid Id, string Weights, DateTime CreatedAt, DateTime UpdatedAt)?> GetWeightProfileAsync(
        Guid organizationId, string name)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT id, weights::text, created_at, updated_at FROM role_family_weight_profiles "
            + "WHERE organization_id = @o AND name = @n";
        command.Parameters.AddWithValue("o", organizationId);
        command.Parameters.AddWithValue("n", name);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return (reader.GetGuid(0), reader.GetString(1), reader.GetDateTime(2), reader.GetDateTime(3));
    }

    public async Task<int> CountWeightProfilesAsync(Guid organizationId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT COUNT(*)::int FROM role_family_weight_profiles WHERE organization_id = @o";
        command.Parameters.AddWithValue("o", organizationId);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    public async Task<int> CountFitScoresForVacancyAsync(Guid vacancyId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*)::int FROM fit_scores WHERE vacancy_id = @v";
        command.Parameters.AddWithValue("v", vacancyId);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    private const string SchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY, organization_id uuid NULL, supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL, first_name text NOT NULL, last_name text NOT NULL, avatar text NULL,
            job_title text NULL, company_id uuid NULL, business_unit_id uuid NULL, created_at timestamp(3) NOT NULL,
            is_platform_owner boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL, role_id uuid NOT NULL);
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL, permission_id uuid NOT NULL, scope text NOT NULL DEFAULT 'own');

        CREATE TABLE business_units (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, company_id uuid NOT NULL, name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE teams (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, business_unit_id uuid NOT NULL, name text NOT NULL,
            leader_id uuid NULL, settings jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE user_teams (
            id uuid PRIMARY KEY, user_id uuid NOT NULL, team_id uuid NOT NULL, role text NOT NULL DEFAULT 'member',
            joined_at timestamp(3) NOT NULL);
        CREATE TABLE user_business_units (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, business_unit_id uuid NOT NULL);

        -- The probe-registry vacancy fields (team_id/assigned_to/created_by/business_unit_id/deleted_at) are all
        -- present — the team-scope fragment is `teamId ∈ ledTeamIds OR assignedTo = self`.
        CREATE TABLE vacancies (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, role_family text NULL,
            team_id uuid NULL, assigned_to uuid NULL, created_by uuid NOT NULL, business_unit_id uuid NULL,
            status text NOT NULL DEFAULT 'open', deleted_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE candidates (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
            years_experience int NULL, education jsonb NULL, languages jsonb NULL, deleted_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE applications (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL, vacancy_id uuid NOT NULL,
            status text NOT NULL DEFAULT 'active',
            CONSTRAINT applications_candidate_id_vacancy_id_key UNIQUE (candidate_id, vacancy_id));
        CREATE TABLE job_profiles (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, vacancy_id uuid NOT NULL UNIQUE,
            fit_requirements jsonb NULL);
        CREATE TABLE assessment_assignments (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL, vacancy_id uuid NOT NULL,
            status text NOT NULL DEFAULT 'assigned', completed_at timestamp(3) NULL);
        CREATE TABLE assessment_results (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, assignment_id uuid NOT NULL UNIQUE,
            normalized_score double precision NULL);
        CREATE TABLE ai_interview_sessions (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL, vacancy_id uuid NOT NULL,
            fit_score int NULL, created_at timestamp(3) NOT NULL);

        -- The real Prisma uniques — the two ON-CONFLICT upserts target these by column list.
        CREATE TABLE fit_scores (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL, vacancy_id uuid NOT NULL,
            overall_score double precision NOT NULL, breakdown jsonb NOT NULL, weights jsonb NOT NULL,
            is_partial boolean NOT NULL DEFAULT false, calculated_at timestamp(3) NOT NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL,
            CONSTRAINT fit_scores_candidate_id_vacancy_id_key UNIQUE (candidate_id, vacancy_id));
        CREATE TABLE role_family_weight_profiles (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, weights jsonb NOT NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL,
            CONSTRAINT role_family_weight_profiles_organization_id_name_key UNIQUE (organization_id, name));
        """;

    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units,
            vacancies, candidates, applications, job_profiles, assessment_assignments, assessment_results,
            ai_interview_sessions TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON fit_scores, role_family_weight_profiles TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                 ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                 ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;            ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;   ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;        ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;             ALTER TABLE vacancies FORCE ROW LEVEL SECURITY;
        ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;            ALTER TABLE candidates FORCE ROW LEVEL SECURITY;
        ALTER TABLE applications ENABLE ROW LEVEL SECURITY;          ALTER TABLE applications FORCE ROW LEVEL SECURITY;
        ALTER TABLE job_profiles ENABLE ROW LEVEL SECURITY;          ALTER TABLE job_profiles FORCE ROW LEVEL SECURITY;
        ALTER TABLE assessment_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE assessment_assignments FORCE ROW LEVEL SECURITY;
        ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;    ALTER TABLE assessment_results FORCE ROW LEVEL SECURITY;
        ALTER TABLE ai_interview_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_interview_sessions FORCE ROW LEVEL SECURITY;
        ALTER TABLE fit_scores ENABLE ROW LEVEL SECURITY;            ALTER TABLE fit_scores FORCE ROW LEVEL SECURITY;
        ALTER TABLE role_family_weight_profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE role_family_weight_profiles FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users                 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams                 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units   USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON vacancies             USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON candidates            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON applications          USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON job_profiles          USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON assessment_assignments USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON assessment_results    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON ai_interview_sessions USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON fit_scores            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON role_family_weight_profiles USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_teams            USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = user_teams.team_id));
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Reader Only'),
          ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'norole', 'No Grant'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'OrgB HR');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'fit_engine', 'read'),
          ('b0000000-0000-0000-0000-000000000002', 'fit_engine', 'create'),
          ('b0000000-0000-0000-0000-000000000003', 'fit_engine', 'update');

        -- hr_admin @ organization (read+create+update); leader @ team (read+create — narrow, the probe bites);
        -- ReaderOnly rides the REAL 'employee' slug (an invented slug is dropped by RoleSlugs.FilterStaffRoleSlugs
        -- at session construction) with read @ organization ONLY — the action-parameterization bite; norole's
        -- 'norole' slug IS filtered out, so its 403 is the empty-roles deny (same shape as the engagement fixture).
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'organization'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'team'),
          ('90000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-0000000000b3', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000003', 'organization');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, company_id, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-fe-org',    'org@t.test',    'Ana',  'Admin',  NULL, 'HR Director', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-fe-lead',   'lead@t.test',   'Tara', 'Team',   NULL, 'Lead',        NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-fe-reader', 'reader@t.test', 'Rita', 'Reader', NULL, 'Analyst',     NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-fe-none',   'none@t.test',   'Ned',  'None',   NULL, 'Analyst',     NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-fe-orgb',   'orgb@t.test',   'Bob',  'OrgB',   NULL, 'HR',          NULL, NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('f0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('f0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005'),
          ('f0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');
        """;

    private const string FitEngineSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-000000000001', 'Unit One', true);

        -- TeamLead LEADS T1 (ledTeamIds = {T1}); VacInTeam sits in T1, VacOutTeam has NO team.
        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha Team', 'c0000000-0000-0000-0000-000000000002', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO vacancies (id, organization_id, title, role_family, team_id, assigned_to, created_by, business_unit_id, status, deleted_at, created_at, updated_at) VALUES
          ('7ac00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Backend Engineer', 'Engineering', '7ea00000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000001', 'b0b00000-0000-0000-0000-000000000001', 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ac00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sales Rep',        NULL,          NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ac00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Deleted Vacancy',  NULL,          NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', '2026-05-01 00:00:00', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ac00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'No Profile Role',  NULL,          NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ac00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'No Applications',  NULL,          NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ac00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Read Fixture Role', NULL,         '7ea00000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000001', 'b0b00000-0000-0000-0000-000000000001', 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ac00000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'OrgB Vacancy',     NULL,          NULL, NULL, 'c0000000-0000-0000-0000-0000000000b0', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        -- CandFull: 2y, Licenciatura (bachelor), English (B2) + Spanish. CandGhost is SOFT-DELETED but keeps an
        -- ACTIVE application (getPipelineCandidateIds does not join candidates — the TS-parity ghost row).
        INSERT INTO candidates (id, organization_id, first_name, last_name, years_experience, education, languages, deleted_at, created_at, updated_at) VALUES
          ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Carla', 'Fuentes', 2,    '[{"degree":"Licenciatura en Sistemas"}]', '["English (B2)","Spanish"]', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Emil',  'Vacio',   NULL, NULL,                                      NULL,                        NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gina',  'Ghost',   5,    NULL,                                      NULL,                        '2026-06-01 00:00:00', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Ivan',  'Inactivo', 3,   NULL,                                      NULL,                        NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Omar',  'Orden',   NULL, NULL,                                      NULL,                        NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('ca000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Bea',   'B1',      1,    NULL,                                      NULL,                        NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status) VALUES
          ('ab000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '7ac00000-0000-0000-0000-000000000001', 'active'),
          ('ab000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', '7ac00000-0000-0000-0000-000000000001', 'active'),
          ('ab000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000003', '7ac00000-0000-0000-0000-000000000001', 'active'),
          ('ab000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000004', '7ac00000-0000-0000-0000-000000000001', 'rejected'),
          ('ab000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000005', '7ac00000-0000-0000-0000-000000000004', 'active'),
          ('ab000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'ca000000-0000-0000-0000-0000000000b1', '7ac00000-0000-0000-0000-0000000000b0', 'active');

        INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES
          ('9f000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '7ac00000-0000-0000-0000-000000000001', '{"minYearsExperience":4,"requiredEducationLevel":"bachelor","requiredLanguages":["English","Spanish"]}');

        -- CandFull assessments: completed 2026-02-01 → 80, completed 2026-03-01 → 90 (latest wins), plus a NEWER
        -- assignment WITHOUT a result row (must be excluded by the result-exists join).
        -- CandOrder pins DESC NULLS FIRST: completed 2026-01-01 → 70 vs completed NULL → 55; Prisma's plain
        -- `orderBy completedAt desc` puts the NULL row FIRST, so 55 wins — the C# must reproduce that.
        INSERT INTO assessment_assignments (id, organization_id, candidate_id, vacancy_id, status, completed_at) VALUES
          ('aa000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '7ac00000-0000-0000-0000-000000000001', 'completed', '2026-02-01 00:00:00'),
          ('aa000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '7ac00000-0000-0000-0000-000000000001', 'completed', '2026-03-01 00:00:00'),
          ('aa000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '7ac00000-0000-0000-0000-000000000001', 'assigned',  '2026-04-01 00:00:00'),
          ('aa000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000005', '7ac00000-0000-0000-0000-000000000004', 'completed', '2026-01-01 00:00:00'),
          ('aa000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000005', '7ac00000-0000-0000-0000-000000000004', 'completed', NULL);

        INSERT INTO assessment_results (id, organization_id, assignment_id, normalized_score) VALUES
          ('ae000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aa000000-0000-0000-0000-000000000001', 80),
          ('ae000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aa000000-0000-0000-0000-000000000002', 90),
          ('ae000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'aa000000-0000-0000-0000-000000000004', 70),
          ('ae000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'aa000000-0000-0000-0000-000000000005', 55);

        -- CandFull interviews: 60 (older), 88 (newer, wins); the NEWEST session has fit_score NULL → excluded
        -- by the `fitScore: { not: null }` filter, NOT by ordering.
        INSERT INTO ai_interview_sessions (id, organization_id, candidate_id, vacancy_id, fit_score, created_at) VALUES
          ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '7ac00000-0000-0000-0000-000000000001', 60,   '2026-02-01 00:00:00'),
          ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '7ac00000-0000-0000-0000-000000000001', 88,   '2026-03-01 00:00:00'),
          ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '7ac00000-0000-0000-0000-000000000001', NULL, '2026-04-01 00:00:00');

        -- Stored fit_scores for the READ endpoints, on VacRead ONLY — compute targets VacInTeam (whose
        -- fit_scores start EMPTY), so read expectations survive any cross-class ordering. Ranking DESC: 85
        -- then 40. calculated_at is FIXED so the ranking response pins the Node-ISO wire format
        -- ("2026-03-01T10:00:00.000Z").
        INSERT INTO fit_scores (id, organization_id, candidate_id, vacancy_id, overall_score, breakdown, weights, is_partial, calculated_at, created_at, updated_at) VALUES
          ('f5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '7ac00000-0000-0000-0000-000000000006', 85, '{"assessment":90,"interview":88,"experience":50,"education":100,"languages":100,"llmJudgment":null}', '{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}', false, '2026-03-01 10:00:00', '2026-03-01 10:00:00', '2026-03-01 10:00:00'),
          ('f5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', '7ac00000-0000-0000-0000-000000000006', 40, '{"assessment":40,"interview":null,"experience":null,"education":null,"languages":null,"llmJudgment":null}', '{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}', true,  '2026-03-02 10:00:00', '2026-03-02 10:00:00', '2026-03-02 10:00:00'),
          ('f5000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'ca000000-0000-0000-0000-0000000000b1', '7ac00000-0000-0000-0000-0000000000b0', 77, '{"assessment":77,"interview":null,"experience":null,"education":null,"languages":null,"llmJudgment":null}', '{"assessment":1}', true, '2026-03-03 10:00:00', '2026-03-03 10:00:00', '2026-03-03 10:00:00');

        -- OrgA holds Default + Engineering (compute inputs; the list test asserts these two in relative
        -- name-ASC order, tolerant of rows other tests create) + Marketing (the update-path upsert target, so
        -- the endpoint update test never rewrites Engineering under the compute tests). OrgB deliberately has
        -- NO Default — the compute bootstrap must create it there.
        INSERT INTO role_family_weight_profiles (id, organization_id, name, weights, created_at, updated_at) VALUES
          ('3e000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Default',     '{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('3e000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Engineering', '{"assessment":0.5,"interview":0.3,"experience":0.1,"education":0.05,"languages":0.05}', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('3e000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Marketing',   '{"assessment":0.4,"interview":0.3,"experience":0.1,"education":0.1,"languages":0.1}', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
        """;
}
