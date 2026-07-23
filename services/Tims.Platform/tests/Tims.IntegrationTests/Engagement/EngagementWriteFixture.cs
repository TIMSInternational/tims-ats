using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Engagement;

namespace Tims.IntegrationTests.Engagement;

/// <summary>
/// Phase-5 Slice 16 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED engagement WRITE tables
/// (<c>surveys</c> + <c>survey_responses</c> + <c>action_plans</c>) + the anchor plane (<c>teams</c>/<c>user_teams</c>/
/// <c>user_business_units</c>/<c>business_units</c>) + the identity/RBAC plane, all under the SAME RLS mechanism as
/// the read fixture (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c>). app_tenant additionally holds INSERT/UPDATE/DELETE on the three write tables.
/// <c>survey_responses</c> carries the real <c>UNIQUE (survey_id, user_id)</c> (the Prisma
/// <c>@@unique([surveyId, userId])</c>) so the dedup 409 bite trips a REAL constraint (23505).
///
/// Scope seed (OrgA): TeamLead leads T1 (members M1/M2 → teamMemberIds = {TeamLead, M1, M2}); M3/M4 are NOT team
/// members (out of the subject set). OrgAdmin = engagement create+update @ organization; TeamLead = the same @ team
/// (narrow — for the assertScoped / assertSubjectInScope bites); NoGrant = no engagement grant. Action plans whose
/// responsible is M1 are IN the leader's scope (responsibleId ∈ teamMemberIds); ApOutScope (responsible M3) is OUT.
/// OrgB is a distinct org (cross-org RLS isolation). Each MUTATING test owns a DISTINCT row (the whole suite shares
/// this ONE container and runs sequentially in the "EngagementWrite" collection).
/// </summary>
public sealed class EngagementWriteFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_engagement_write";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Staff principals
    public static readonly Guid OrgAdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid NoGrantId = Guid.Parse("c0000000-0000-0000-0000-000000000003");
    public static readonly Guid OrgBAdminId = Guid.Parse("c0000000-0000-0000-0000-0000000000b0");

    // Members (M1/M2 in team; M3/M4 out)
    public static readonly Guid M1Id = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid M2Id = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    public static readonly Guid M3Id = Guid.Parse("d0000000-0000-0000-0000-000000000003");
    public static readonly Guid M4Id = Guid.Parse("d0000000-0000-0000-0000-000000000004");
    public static readonly Guid Mb1Id = Guid.Parse("d0000000-0000-0000-0000-0000000000b1");

    // Surveys (OrgA unless noted)
    public static readonly Guid SvDraftPreset = Guid.Parse("50000000-0000-0000-0000-000000000001"); // draft, startsAt preset
    public static readonly Guid SvDraftNull = Guid.Parse("50000000-0000-0000-0000-000000000002");   // draft, startsAt NULL
    public static readonly Guid SvActive = Guid.Parse("50000000-0000-0000-0000-000000000003");      // active (endpoint submit + identity)
    public static readonly Guid SvActiveDup = Guid.Parse("50000000-0000-0000-0000-000000000004");   // active (endpoint dedup)
    public static readonly Guid SvDraftInactive = Guid.Parse("50000000-0000-0000-0000-000000000005"); // draft (submit → 404)
    public static readonly Guid SvRepoActPreset = Guid.Parse("50000000-0000-0000-0000-00000000000a"); // repo activate preserve
    public static readonly Guid SvRepoActNull = Guid.Parse("50000000-0000-0000-0000-00000000000b");   // repo activate stamp-now
    public static readonly Guid SvRepoSubmit = Guid.Parse("50000000-0000-0000-0000-00000000000c");    // repo submit
    public static readonly Guid SvRepoSubmitDup = Guid.Parse("50000000-0000-0000-0000-00000000000d"); // repo dedup
    public static readonly Guid SvOrgB = Guid.Parse("50000000-0000-0000-0000-0000000000b0");          // OrgB

    // Action plans
    public static readonly Guid ApInScope = Guid.Parse("a9000000-0000-0000-0000-000000000001");     // resp M1 (probe in)
    public static readonly Guid ApOutScope = Guid.Parse("a9000000-0000-0000-0000-000000000002");    // resp M3 (probe out)
    public static readonly Guid ApEpUpdate = Guid.Parse("a9000000-0000-0000-0000-000000000003");    // resp M1 (endpoint update)
    public static readonly Guid ApRepoUpdate = Guid.Parse("a9000000-0000-0000-0000-00000000000a");  // resp M1 (repo partial update)
    public static readonly Guid ApRepoDueClear = Guid.Parse("a9000000-0000-0000-0000-00000000000b");// resp M1 (dueDate tri-state)
    public static readonly Guid ApRepoReassign = Guid.Parse("a9000000-0000-0000-0000-00000000000c");// resp M1 (repo reassign H1)
    public static readonly Guid ApScopeGuardOut = Guid.Parse("a9000000-0000-0000-0000-00000000000d");// resp M3 (scope-atomic guard: OUT of team set)
    public static readonly Guid ApScopeGuardIn = Guid.Parse("a9000000-0000-0000-0000-00000000000e"); // resp M1 (scope-atomic guard: IN team set)
    public static readonly Guid ApOrgB = Guid.Parse("a9000000-0000-0000-0000-0000000000b0");        // OrgB (cross-org)

    // Survey responses (dedup seeds)
    public static readonly Guid RespDupSeed = Guid.Parse("51000000-0000-0000-0000-000000000004");    // (SvActiveDup, OrgAdmin)
    public static readonly Guid RespRepoDupSeed = Guid.Parse("51000000-0000-0000-0000-00000000000d");// (SvRepoSubmitDup, OrgAdmin)

    public const string OrgAdminSub = "sub-ew-org";
    public const string TeamLeadSub = "sub-ew-lead";
    public const string NoGrantSub = "sub-ew-none";
    public const string OrgBAdminSub = "sub-ew-orgb";

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

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, EngagementSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public EngagementWriteDbContext NewWriteContext() =>
        new(new DbContextOptionsBuilder<EngagementWriteDbContext>().UseNpgsql(ConnectionString).Options);

    public async Task<NpgsqlConnection> OpenSuperuserConnectionAsync()
    {
        var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    public async Task<bool> SurveyExistsAsync(Guid id) => await ScalarBoolAsync(
        "SELECT EXISTS(SELECT 1 FROM surveys WHERE id = @id)", id);

    public async Task<bool> ActionPlanExistsAsync(Guid id) => await ScalarBoolAsync(
        "SELECT EXISTS(SELECT 1 FROM action_plans WHERE id = @id)", id);

    public async Task<string?> GetSurveyStatusAsync(Guid id) => await ScalarStringAsync(
        "SELECT status FROM surveys WHERE id = @id", id);

    public async Task<DateTime?> GetSurveyStartsAtAsync(Guid id) => await ScalarDateTimeAsync(
        "SELECT starts_at FROM surveys WHERE id = @id", id);

    /// <summary>Count of survey_response rows for a (surveyId, userId) pair (superuser, bypasses RLS).</summary>
    public async Task<int> CountResponsesAsync(Guid surveyId, Guid userId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT COUNT(*)::int FROM survey_responses WHERE survey_id = @sid AND user_id = @uid";
        command.Parameters.AddWithValue("sid", surveyId);
        command.Parameters.AddWithValue("uid", userId);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    public async Task<string?> GetActionPlanStatusAsync(Guid id) => await ScalarStringAsync(
        "SELECT status FROM action_plans WHERE id = @id", id);

    public async Task<string?> GetActionPlanTitleAsync(Guid id) => await ScalarStringAsync(
        "SELECT title FROM action_plans WHERE id = @id", id);

    public async Task<string?> GetActionPlanNotesAsync(Guid id) => await ScalarStringAsync(
        "SELECT notes FROM action_plans WHERE id = @id", id);

    public async Task<Guid?> GetActionPlanResponsibleAsync(Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT responsible_id FROM action_plans WHERE id = @id";
        command.Parameters.AddWithValue("id", id);
        var result = await command.ExecuteScalarAsync();
        return result is Guid g ? g : null;
    }

    public async Task<DateTime?> GetActionPlanDueDateAsync(Guid id) => await ScalarDateTimeAsync(
        "SELECT due_date FROM action_plans WHERE id = @id", id);

    private async Task<bool> ScalarBoolAsync(string sql, Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        return (bool)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string?> ScalarStringAsync(string sql, Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        var result = await command.ExecuteScalarAsync();
        return result is DBNull or null ? null : (string)result;
    }

    private async Task<DateTime?> ScalarDateTimeAsync(string sql, Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        var result = await command.ExecuteScalarAsync();
        return result is DateTime d ? d : null;
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

        CREATE TABLE surveys (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, type text NOT NULL,
            status text NOT NULL DEFAULT 'draft', questions jsonb NOT NULL, target_groups jsonb NULL,
            starts_at timestamp(3) NULL, ends_at timestamp(3) NULL, response_count int NOT NULL DEFAULT 0,
            created_by_id uuid NOT NULL, created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        -- The real Prisma @@unique([surveyId, userId]) — the dedup 409 bite trips this (23505).
        CREATE TABLE survey_responses (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, survey_id uuid NOT NULL, user_id uuid NULL,
            answers jsonb NOT NULL, submitted_at timestamp(3) NOT NULL,
            CONSTRAINT survey_responses_survey_id_user_id_key UNIQUE (survey_id, user_id));
        CREATE TABLE action_plans (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, responsible_id uuid NOT NULL,
            area text NULL, status text NOT NULL DEFAULT 'pending', due_date timestamp(3) NULL, actions jsonb NULL,
            notes text NULL, created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        """;

    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON surveys, survey_responses, action_plans TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;           ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;  ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;       ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;              ALTER TABLE surveys FORCE ROW LEVEL SECURITY;
        ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;     ALTER TABLE survey_responses FORCE ROW LEVEL SECURITY;
        ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;         ALTER TABLE action_plans FORCE ROW LEVEL SECURITY;

        -- USING also gates INSERT/UPDATE/DELETE (WITH CHECK defaults to USING) for the three write tables.
        CREATE POLICY tenant_isolation ON users                USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams                USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units       USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON surveys              USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON survey_responses     USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON action_plans         USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_teams           USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = user_teams.team_id));
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'norole', 'No Grant'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'OrgB HR');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'engagement', 'create'),
          ('b0000000-0000-0000-0000-000000000002', 'engagement', 'update');

        -- hr_admin @ organization (create+update); leader @ team (narrow — assertScoped/assertSubjectInScope bites);
        -- norole has NO engagement grant (403). OrgB hr_admin @ organization for cross-org.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'team'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, company_id, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-ew-org',  'org@t.test',  'Ana',  'Admin', NULL,     'HR Director', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-ew-lead', 'lead@t.test', 'Tara', 'Team',  NULL,     'Lead',        NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-ew-none', 'none@t.test', 'Ned',  'None',  NULL,     'Analyst',     NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-ew-m1',   'm1@t.test',   'Mia',  'One',   'a1.png', 'Engineer',    NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-ew-m2',   'm2@t.test',   'Max',  'Two',   NULL,     'PM',          NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-ew-m3',   'm3@t.test',   'Moe',  'Three', NULL,     'Staff Eng',   NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-ew-m4',   'm4@t.test',   'Mel',  'Four',  NULL,     'Engineer',    NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-ew-orgb', 'orgb@t.test', 'Bob',  'OrgB',  NULL,     'HR',          NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-ew-mb1',  'mb1@t.test',  'Bea',  'B1',    NULL,     'Eng',         NULL, NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('f0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005'),
          ('f0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');
        """;

    private const string EngagementSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-000000000001', 'Unit One', true);

        -- TeamLead leads T1; members M1/M2 → teamMemberIds = {TeamLead, M1, M2}. M3/M4 are NOT members.
        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha Team', 'c0000000-0000-0000-0000-000000000002', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO user_teams (id, user_id, team_id, role, joined_at) VALUES
          ('11100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-02 00:00:00');

        -- Surveys. Draft/active states drive activate/submit; SvActiveDup + SvRepoSubmitDup seed a response for the
        -- dedup bite. startsAt preset vs NULL drives the preserve-else-now branch. OrgB survey is cross-org.
        INSERT INTO surveys (id, organization_id, title, type, status, questions, target_groups, starts_at, ends_at, response_count, created_by_id, created_at, updated_at) VALUES
          ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'DraftPreset',   'pulse',   'draft',  '[{"text":"q1","type":"scale"}]', NULL, '2020-01-01 00:00:00', NULL, 0, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'DraftNull',     'pulse',   'draft',  '[{"text":"q1","type":"scale"}]', NULL, NULL,                  NULL, 0, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Active',        'climate', 'active', '[{"text":"q1","type":"scale"}]', NULL, '2020-01-01 00:00:00', NULL, 0, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'ActiveDup',     'climate', 'active', '[{"text":"q1","type":"scale"}]', NULL, '2020-01-01 00:00:00', NULL, 1, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'DraftInactive', 'pulse',   'draft',  '[{"text":"q1","type":"scale"}]', NULL, NULL,                  NULL, 0, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'RepoActPreset', 'pulse',   'draft',  '[{"text":"q1","type":"scale"}]', NULL, '2019-05-05 00:00:00', NULL, 0, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'RepoActNull',   'pulse',   'draft',  '[{"text":"q1","type":"scale"}]', NULL, NULL,                  NULL, 0, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'RepoSubmit',    'climate', 'active', '[{"text":"q1","type":"scale"}]', NULL, '2020-01-01 00:00:00', NULL, 0, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'RepoSubmitDup', 'climate', 'active', '[{"text":"q1","type":"scale"}]', NULL, '2020-01-01 00:00:00', NULL, 1, 'c0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('50000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'OrgB Survey',   'climate', 'active', '[{"text":"q1","type":"scale"}]', NULL, '2020-01-01 00:00:00', NULL, 0, 'c0000000-0000-0000-0000-0000000000b0', '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        -- Dedup seeds: the caller (OrgAdmin) has ALREADY responded to SvActiveDup + SvRepoSubmitDup.
        INSERT INTO survey_responses (id, organization_id, survey_id, user_id, answers, submitted_at) VALUES
          ('51000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', '{"q1":3}', '2026-02-01 00:00:00'),
          ('51000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-000000000001', '{"q1":3}', '2026-02-01 00:00:00');

        -- Action plans. Responsible M1 ⇒ in the leader's team scope; ApOutScope responsible M3 ⇒ out. ApRepoDueClear
        -- carries a due_date so the tri-state clear test proves it becomes NULL. OrgB plan is cross-org.
        INSERT INTO action_plans (id, organization_id, title, responsible_id, area, status, due_date, actions, notes, created_at, updated_at) VALUES
          ('a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'InScope',   'd0000000-0000-0000-0000-000000000001', 'Ambiente', 'pending',     NULL,                  NULL, NULL,      '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('a9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'OutScope',  'd0000000-0000-0000-0000-000000000003', 'Ambiente', 'pending',     NULL,                  NULL, NULL,      '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('a9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'EpUpdate',  'd0000000-0000-0000-0000-000000000001', 'Ambiente', 'pending',     NULL,                  NULL, NULL,      '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('a9000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'RepoUpdate','d0000000-0000-0000-0000-000000000001', 'Ambiente', 'pending',     NULL,                  NULL, 'keep me', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('a9000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'RepoDue',   'd0000000-0000-0000-0000-000000000001', 'Ambiente', 'pending',     '2026-09-09 00:00:00', NULL, NULL,      '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('a9000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'RepoReasg', 'd0000000-0000-0000-0000-000000000001', 'Ambiente', 'pending',     NULL,                  NULL, NULL,      '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          -- Scope-atomic guard (Codex HIGH): ScopeGuardOut responsible = M3 (in-org but OUT of the {TeamLead,M1,M2} team set)
          -- models the post-probe reassignment race → the FOR UPDATE scope re-check must reject it. ScopeGuardIn resp = M1 (IN).
          ('a9000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'ScopeGuardOut', 'd0000000-0000-0000-0000-000000000003', 'Ambiente', 'pending', NULL,                  NULL, NULL,      '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('a9000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'ScopeGuardIn',  'd0000000-0000-0000-0000-000000000001', 'Ambiente', 'pending', NULL,                  NULL, NULL,      '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('a9000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'OrgB Plan', 'd0000000-0000-0000-0000-0000000000b1', 'Ambiente', 'pending',     NULL,                  NULL, NULL,      '2026-02-01 00:00:00', '2026-02-01 00:00:00');
        """;
}
