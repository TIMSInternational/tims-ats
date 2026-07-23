using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Succession;

namespace Tims.IntegrationTests.Succession;

/// <summary>
/// Phase-5 Slice 14 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED succession WRITE tables
/// (<c>critical_roles</c> + <c>successors</c>) + the anchor plane (<c>teams</c>/<c>user_teams</c>/
/// <c>user_business_units</c>/<c>business_units</c>) + the identity/RBAC plane, all under the SAME RLS mechanism as
/// the read fixture (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c>). app_tenant additionally holds INSERT/UPDATE/DELETE on the two write tables.
/// <c>successors</c> carries the real <c>UNIQUE (critical_role_id, user_id)</c> (the Prisma
/// <c>@@unique([criticalRoleId, userId])</c>) so the dedup 409 bite trips a REAL constraint (23505).
///
/// Scope seed (OrgA): TeamLead leads T1 (members M1/M2 → teamMemberIds = {TeamLead, M1, M2}); M3/M4 are NOT team
/// members (out of the subject set). OrgAdmin = succession create+update+delete @ organization; TeamLead = the same
/// @ team (narrow — for the requireOrgScope / assertScoped / assertSubjectInScope bites); NoGrant = no succession
/// grant. Critical roles held by M1 are IN the leader's scope (holder ∈ teamMemberIds); CR_OutTeam (holder M3) is
/// OUT. OrgB is a distinct org (cross-org RLS isolation). Each MUTATING test owns a DISTINCT row (the whole suite
/// shares this ONE container and runs sequentially in the "SuccessionWrite" collection).
/// </summary>
public sealed class SuccessionWriteFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_succession_write";

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

    // Critical roles (holder M1 ⇒ in the leader's team scope; CR_OutTeam holder M3 ⇒ out)
    public static readonly Guid CrInTeam = Guid.Parse("5c000000-0000-0000-0000-000000000001");  // holder M1
    public static readonly Guid CrOutTeam = Guid.Parse("5c000000-0000-0000-0000-000000000002"); // holder M3
    public static readonly Guid CrEpAdd = Guid.Parse("5c000000-0000-0000-0000-000000000007");   // endpoint addSuccessor + remove
    public static readonly Guid CrEpSubj = Guid.Parse("5c000000-0000-0000-0000-000000000008");  // endpoint subject-out + updateReadiness
    public static readonly Guid CrEpDup = Guid.Parse("5c000000-0000-0000-0000-000000000009");   // endpoint dedup
    public static readonly Guid CrRepoAdd = Guid.Parse("5c000000-0000-0000-0000-00000000000a"); // repo add/remove
    public static readonly Guid CrRepoDup = Guid.Parse("5c000000-0000-0000-0000-00000000000b"); // repo dedup + probe rows
    public static readonly Guid CrRepoBand = Guid.Parse("5c000000-0000-0000-0000-00000000000c");// repo updateReadiness + band
    public static readonly Guid CrEpBand = Guid.Parse("5c000000-0000-0000-0000-00000000000d");  // endpoint band set/null
    public static readonly Guid CrOrgB = Guid.Parse("5c000000-0000-0000-0000-0000000000b0");    // OrgB

    // Companies + business units (org-membership refs for addCriticalRole's optional FK validation — Codex H2).
    public static readonly Guid CompanyA = Guid.Parse("c0c00000-0000-0000-0000-000000000001"); // OrgA
    public static readonly Guid CompanyB = Guid.Parse("c0c00000-0000-0000-0000-0000000000b0"); // OrgB
    public static readonly Guid UnitA = Guid.Parse("b0b00000-0000-0000-0000-000000000001");    // OrgA
    public static readonly Guid UnitB = Guid.Parse("b0b00000-0000-0000-0000-0000000000b0");    // OrgB

    // Successors (criticalRoleId, userId) — each mutating test owns a distinct row.
    public static readonly Guid SuccEpRemove = Guid.Parse("60000000-0000-0000-0000-000000000001");    // (CrEpAdd, M1) endpoint remove org
    public static readonly Guid SuccEpUpdate = Guid.Parse("60000000-0000-0000-0000-000000000002");    // (CrEpSubj, M1) endpoint updateReadiness org
    public static readonly Guid SuccEpRemoveOut = Guid.Parse("60000000-0000-0000-0000-000000000004"); // (CrOutTeam, M3) endpoint remove leader-out 404
    public static readonly Guid SuccEpUpdateOut = Guid.Parse("60000000-0000-0000-0000-000000000005"); // (CrOutTeam, M4) endpoint updateReadiness leader-out 404
    public static readonly Guid SuccEpDup = Guid.Parse("60000000-0000-0000-0000-000000000009");       // (CrEpDup, M1) endpoint dedup seed
    public static readonly Guid SuccRepoRemove = Guid.Parse("60000000-0000-0000-0000-00000000000a");  // (CrRepoAdd, M1) repo remove
    public static readonly Guid SuccRepoDup = Guid.Parse("60000000-0000-0000-0000-00000000000b");     // (CrRepoDup, M1) repo dedup seed
    public static readonly Guid SuccRepoRemove2 = Guid.Parse("60000000-0000-0000-0000-00000000000c"); // (CrRepoAdd, M2) repo remove-twice TOCTOU
    public static readonly Guid SuccRepoUpd = Guid.Parse("60000000-0000-0000-0000-00000000000d");     // (CrRepoBand, M1) repo updateReadiness (with devPlan)
    public static readonly Guid SuccRepoUpdSkip = Guid.Parse("60000000-0000-0000-0000-00000000000e"); // (CrRepoBand, M2) repo updateReadiness skip devPlan
    public static readonly Guid SuccProbeIn = Guid.Parse("60000000-0000-0000-0000-00000000000f");     // (CrRepoDup, M2) repo probe in-scope
    public static readonly Guid SuccProbeOut = Guid.Parse("60000000-0000-0000-0000-000000000010");    // (CrRepoDup, M3) repo probe out-of-scope
    public static readonly Guid SuccOrgB = Guid.Parse("60000000-0000-0000-0000-0000000000b0");        // (CrOrgB, Mb1) cross-org

    public const string OrgAdminSub = "sub-sw-org";
    public const string TeamLeadSub = "sub-sw-lead";
    public const string NoGrantSub = "sub-sw-none";
    public const string OrgBAdminSub = "sub-sw-orgb";

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

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, SuccessionSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public SuccessionWriteDbContext NewWriteContext() =>
        new(new DbContextOptionsBuilder<SuccessionWriteDbContext>().UseNpgsql(ConnectionString).Options);

    public async Task<NpgsqlConnection> OpenSuperuserConnectionAsync()
    {
        var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    public async Task<bool> SuccessorExistsAsync(Guid id) => await ScalarBoolAsync(
        "SELECT EXISTS(SELECT 1 FROM successors WHERE id = @id)", id);

    public async Task<bool> RoleExistsAsync(Guid id) => await ScalarBoolAsync(
        "SELECT EXISTS(SELECT 1 FROM critical_roles WHERE id = @id)", id);

    /// <summary>Count of successor rows for a (criticalRoleId, userId) pair (superuser, bypasses RLS).</summary>
    public async Task<int> CountSuccessorsAsync(Guid criticalRoleId, Guid userId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT COUNT(*)::int FROM successors WHERE critical_role_id = @cr AND user_id = @uid";
        command.Parameters.AddWithValue("cr", criticalRoleId);
        command.Parameters.AddWithValue("uid", userId);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    public async Task<string?> GetSuccessorReadinessAsync(Guid id) => await ScalarStringAsync(
        "SELECT readiness FROM successors WHERE id = @id", id);

    public async Task<string?> GetSuccessorDevelopmentPlanAsync(Guid id) => await ScalarStringAsync(
        "SELECT development_plan FROM successors WHERE id = @id", id);

    public async Task<Guid?> GetSuccessorAddedByAsync(Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT added_by_id FROM successors WHERE id = @id";
        command.Parameters.AddWithValue("id", id);
        var result = await command.ExecuteScalarAsync();
        return result is Guid g ? g : null;
    }

    public async Task<string?> GetRoleBandAsync(Guid id) => await ScalarStringAsync(
        "SELECT target_band_level FROM critical_roles WHERE id = @id", id);

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

    private const string SchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY, organization_id uuid NULL, supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL, first_name text NOT NULL, last_name text NOT NULL, avatar text NULL,
            job_title text NULL, business_unit_id uuid NULL, created_at timestamp(3) NOT NULL,
            is_platform_owner boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL, role_id uuid NOT NULL);
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL, permission_id uuid NOT NULL, scope text NOT NULL DEFAULT 'own');

        CREATE TABLE companies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL);
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

        CREATE TABLE critical_roles (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, position_id text NULL,
            current_holder_id uuid NULL, company_id uuid NULL, unit_id uuid NULL, criticality text NOT NULL,
            flight_risk double precision NULL, target_band_level text NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        -- The real Prisma @@unique([criticalRoleId, userId]) — the dedup 409 bite trips this (23505).
        CREATE TABLE successors (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, critical_role_id uuid NOT NULL, user_id uuid NOT NULL,
            readiness text NOT NULL, type text NOT NULL, development_plan text NULL, added_by_id uuid NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL,
            CONSTRAINT successors_critical_role_id_user_id_key UNIQUE (critical_role_id, user_id));
        """;

    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units, companies TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON critical_roles, successors TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE companies ENABLE ROW LEVEL SECURITY;            ALTER TABLE companies FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;           ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;  ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;       ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE critical_roles ENABLE ROW LEVEL SECURITY;       ALTER TABLE critical_roles FORCE ROW LEVEL SECURITY;
        ALTER TABLE successors ENABLE ROW LEVEL SECURITY;           ALTER TABLE successors FORCE ROW LEVEL SECURITY;

        -- USING also gates INSERT/UPDATE/DELETE (WITH CHECK defaults to USING) for the two write tables.
        CREATE POLICY tenant_isolation ON users                USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON companies            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams                USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units       USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON critical_roles       USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON successors           USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
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
          ('b0000000-0000-0000-0000-000000000001', 'succession', 'create'),
          ('b0000000-0000-0000-0000-000000000002', 'succession', 'update'),
          ('b0000000-0000-0000-0000-000000000003', 'succession', 'delete');

        -- hr_admin @ organization (create+update+delete); leader @ team (narrow — requireOrgScope 403 on
        -- addCriticalRole, assertScoped/assertSubjectInScope bites); norole has NO succession grant (403). OrgB
        -- hr_admin @ organization for cross-org.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'organization'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'team'),
          ('90000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'team'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-0000000000b3', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000003', 'organization');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-sw-org',  'org@tims.test',  'Ana',  'Admin', NULL,     'HR Director', NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-sw-lead', 'lead@tims.test', 'Tara', 'Team',  NULL,     'Lead',        NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-sw-none', 'none@tims.test', 'Ned',  'None',  NULL,     'Analyst',     NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-sw-m1',   'm1@tims.test',   'Mia',  'One',   'a1.png', 'Engineer',    NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-sw-m2',   'm2@tims.test',   'Max',  'Two',   NULL,     'PM',          NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-sw-m3',   'm3@tims.test',   'Moe',  'Three', NULL,     'Staff Eng',   NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-sw-m4',   'm4@tims.test',   'Mel',  'Four',  NULL,     'Engineer',    NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-sw-orgb', 'orgb@tims.test', 'Bob',  'OrgB',  NULL,     'HR',          NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-sw-mb1',  'mb1@tims.test',  'Bea',  'B1',    NULL,     'Eng',         NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('f0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005'),
          ('f0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');
        """;

    private const string SuccessionSeedSql =
        """
        INSERT INTO companies (id, organization_id, name) VALUES
          ('c0c00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'OrgA Company'),
          ('c0c00000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'OrgB Company');

        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-000000000001', 'Unit One', true),
          ('b0b00000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'c0c00000-0000-0000-0000-0000000000b0', 'OrgB Unit', true);

        -- TeamLead leads T1; members M1/M2 → teamMemberIds = {TeamLead, M1, M2}. M3/M4 are NOT members.
        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha Team', 'c0000000-0000-0000-0000-000000000002', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO user_teams (id, user_id, team_id, role, joined_at) VALUES
          ('11100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-02 00:00:00');

        -- Critical roles. Holder M1 ⇒ in the leader's team scope; CR_OutTeam holder M3 ⇒ out. OrgB role is distinct.
        INSERT INTO critical_roles (id, organization_id, title, position_id, current_holder_id, company_id, unit_id, criticality, flight_risk, target_band_level, created_at, updated_at) VALUES
          ('5c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'InTeam',   NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'critical', 0.9, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'OutTeam',  NULL, 'd0000000-0000-0000-0000-000000000003', NULL, NULL, 'high',     0.2, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'EpAdd',    NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'medium',   0.3, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'EpSubj',   NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'medium',   0.3, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'EpDup',    NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'medium',   0.3, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'RepoAdd',  NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'low',      0.1, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'RepoDup',  NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'low',      0.1, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'RepoBand', NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'low',      0.1, 'L3', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'EpBand',   NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'low',      0.1, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'OrgB Role',NULL, 'd0000000-0000-0000-0000-0000000000b1', NULL, NULL, 'critical', 0.95,'LB', '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        -- Seed successors. Each mutating test owns a distinct row. SuccRepoUpdSkip carries a development_plan so the
        -- skip-when-absent test proves it is UNCHANGED. OrgB successor is on the OrgB role (cross-org).
        INSERT INTO successors (id, organization_id, critical_role_id, user_id, readiness, type, development_plan, added_by_id, created_at, updated_at) VALUES
          ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000001', 'ready_now',    'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000001', 'developing',   'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'ready_now',    'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004', 'ready_now',    'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000001', 'ready_1_year', 'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'ready_now',    'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000001', 'developing',   'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'developing',   'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000001', 'developing',   'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000002', 'developing',   'internal', 'keep me', 'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000002', 'ready_now',    'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000003', 'ready_now',    'internal', NULL,      'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', '5c000000-0000-0000-0000-0000000000b0', 'd0000000-0000-0000-0000-0000000000b1', 'ready_now',    'internal', NULL,      NULL,                                   '2026-02-01 00:00:00', '2026-02-01 00:00:00');
        """;
}
