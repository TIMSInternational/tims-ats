using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.TeamIntel;

namespace Tims.IntegrationTests.TeamIntel;

/// <summary>
/// Phase-5 Slice 6 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED team-intel tables
/// (<c>teams</c>, <c>user_teams</c>, <c>users</c>, <c>business_units</c>, <c>vacancies</c>, <c>okrs</c>) + the
/// identity/RBAC plane, all under the SAME RLS mechanism as the other read fixtures (NOLOGIN/NOBYPASSRLS
/// <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed <c>tenant_isolation</c>). The team-intel
/// reads + the <c>assertScoped('team')</c> IDOR probe + the anchor loader run UNDER TenantScope (app_tenant +
/// org GUC); the identity/RBAC principal/grant reads run on the superuser connection (bypass RLS).
///
/// Scope seed (OrgA): T1 is led by the team-lead (in team scope); T2 is led by the org-admin (OUT of the
/// team-lead's scope). T1 members M1(Eng)/M2(PM)/M3(null role) with staggered joinedAt (getMembers order),
/// 2 vacancies + 1 okr on T1. OrgB seeds a DISTINCT team T3 so a cross-org RLS bleed changes OrgA's counts.
/// RBAC: hr_admin=team_intel:read@organization (200 + org-gate pass), recruiter@company (200 + org-gate pass),
/// leader@team (narrow → 403 on dashboard-kpis, F3; 404 IDOR on T2), employee=no grant (403).
/// </summary>
public sealed class TeamIntelReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_team_intel_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid Team1 = Guid.Parse("7ea00000-0000-0000-0000-000000000001"); // led by team-lead (in scope)
    public static readonly Guid Team2 = Guid.Parse("7ea00000-0000-0000-0000-000000000002"); // led by org-admin (OUT of team scope)
    public static readonly Guid Team3OrgB = Guid.Parse("7ea00000-0000-0000-0000-00000000000b");

    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");

    public const string OrgReaderSub = "sub-ti-org-reader";
    public const string CompanyReaderSub = "sub-ti-company-reader";
    public const string TeamLeadSub = "sub-ti-team-lead";
    public const string NoGrantSub = "sub-ti-no-grant";

    // Deterministic OrgA expectations (independent of the injected `now`).
    public const int Team1MemberCount = 3;      // M1, M2, M3
    public const int Team1UniqueRoles = 2;       // Eng, PM (M3's null role dropped)
    public const int Team1RoleDiversity = 67;    // round(2/3*100)
    public const int Team1SizeScore = 100;       // 3 in [3,10]
    public const int Team1BalanceScore = 84;     // round((100+67)/2) = round(83.5) half-up
    public const int Team1Vacancies = 2;
    public const int Team1Okrs = 1;

    public const int OrgATotalTeams = 2;         // T1, T2 (active)
    public const int OrgATotalMembers = 4;       // 3 on T1 + 1 on T2
    public const int OrgATeamsWithLeader = 2;    // both have a leader
    public const double OrgAAvgTeamSize = 2;     // round(4/2*10)/10

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

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, TeamIntelSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public TeamIntelReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<TeamIntelReadDbContext>().UseNpgsql(ConnectionString).Options);

    // One `users` table serves BOTH the privileged identity reads (supabase_user_id/is_platform_owner) AND
    // the tenant team-intel reads (first_name/last_name/avatar/job_title/email/created_at) + the anchor
    // loader (organization_id/business_unit_id). RBAC tables are the privileged (no-RLS) plane.
    private const string SchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL,
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            avatar text NULL,
            job_title text NULL,
            business_unit_id uuid NULL,
            created_at timestamp(3) NOT NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');

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
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, team_id uuid NULL);
        CREATE TABLE okrs (id uuid PRIMARY KEY, organization_id uuid NOT NULL, team_id uuid NULL);
        """;

    // Org-scoped RLS on the tenant tables. `users` also gets RLS so the member/leader joins are org-isolated
    // for the app_tenant path. `user_teams` has no organization_id, so its policy joins teams (itself RLS'd to
    // the org GUC) — a member row is visible only when its team is in the caller's org.
    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, business_units, vacancies, okrs TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;          ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;          ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;     ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY; ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;      ALTER TABLE vacancies FORCE ROW LEVEL SECURITY;
        ALTER TABLE okrs ENABLE ROW LEVEL SECURITY;           ALTER TABLE okrs FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users         USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams         USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON vacancies     USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON okrs          USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_teams    USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = user_teams.team_id));
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        -- All valid staff slugs (a non-staff slug would be dropped by the principal resolver → the org-gate
        -- would never see its scope, giving a FALSE-green 403; #150 lesson).
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'team_intel', 'read');

        -- hr_admin@organization + recruiter@company pass the org-gate; leader@team is narrow (→ 403 on
        -- dashboard-kpis, Codex F3) but reaches its own team's by-id reads; employee has NO grant.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'company');

        -- Reader users (staff). created_at values are arbitrary (tenure/diversity are unit-golden-tested).
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-ti-org-reader',     'org@tims.test',     'Ana',  'Admin',   NULL, 'HR Director', NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-ti-team-lead',      'lead@tims.test',    'Tara', 'Team',    NULL, 'Lead',        NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-ti-no-grant',       'none@tims.test',    'Ned',  'None',    NULL, 'Analyst',     NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-ti-company-reader', 'company@tims.test', 'Cara', 'Company', NULL, 'Recruiter',   NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004');
        """;

    // OrgA: BU1 → T1 (leader = team-lead) + T2 (leader = org-admin). Member users M1(Eng)/M2(PM)/M3(null role)
    // on T1 (staggered joinedAt), M4(Sales) on T2. 2 vacancies + 1 okr on T1. OrgB: BU-B → T3 with 1 member.
    private const string TeamIntelSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-000000000001', 'Unit One', true),
          ('b0b00000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'c0c00000-0000-0000-0000-00000000000b', 'Unit B',   true);

        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha', 'c0000000-0000-0000-0000-000000000002', '{"color":"blue"}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ea00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Beta',  'c0000000-0000-0000-0000-000000000001', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ea00000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'b0b00000-0000-0000-0000-00000000000b', 'OrgB Team', NULL, '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        -- Member users (headcount for T1/T2). M3 has a NULL job_title (dropped from uniqueRoles/diversity).
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-ti-m1', 'm1@tims.test', 'Mia',  'One',   'a1.png', 'Engineer', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-ti-m2', 'm2@tims.test', 'Max',  'Two',   NULL,     'PM',       NULL, '2024-06-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-ti-m3', 'm3@tims.test', 'Moe',  'Three', NULL,     NULL,       NULL, '2025-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-ti-m4', 'm4@tims.test', 'Mel',  'Four',  NULL,     'Sales',    NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'sub-ti-mb', 'mb@tims.test', 'Bob',  'OrgB',  NULL,     'X',        NULL, '2024-01-01 00:00:00', false, true);

        -- T1 members with staggered joinedAt so getMembers asc order is M1(06-01), M3(06-02), M2(06-03).
        INSERT INTO user_teams (id, user_id, team_id, role, joined_at) VALUES
          ('11100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-03 00:00:00'),
          ('11100000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-02 00:00:00'),
          ('11100000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', '7ea00000-0000-0000-0000-000000000002', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b', '7ea00000-0000-0000-0000-00000000000b', 'member', '2026-06-01 00:00:00');

        INSERT INTO vacancies (id, organization_id, team_id) VALUES
          ('7ac00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '7ea00000-0000-0000-0000-000000000001'),
          ('7ac00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '7ea00000-0000-0000-0000-000000000001'),
          ('7ac00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '7ea00000-0000-0000-0000-000000000002');

        INSERT INTO okrs (id, organization_id, team_id) VALUES
          ('0c700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '7ea00000-0000-0000-0000-000000000001');
        """;
}
