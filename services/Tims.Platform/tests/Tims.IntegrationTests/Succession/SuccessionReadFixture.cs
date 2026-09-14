using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Succession;

namespace Tims.IntegrationTests.Succession;

/// <summary>
/// Phase-5 Slice 8 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED succession tables
/// (<c>critical_roles</c>, <c>successors</c>, <c>salary_bands</c>, <c>employee_compensations</c>,
/// <c>nine_box_evaluations</c>) + the anchor plane (<c>teams</c>, <c>user_teams</c>, <c>business_units</c>,
/// <c>users</c>) + the identity/RBAC plane + append-only <c>data_access_logs</c>, all under the SAME RLS
/// mechanism as the other read fixtures (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL
/// SECURITY, fail-closed <c>tenant_isolation</c>).
///
/// Scope seed (OrgA): TeamLead leads T1 (members M1/M2/M3). CR1 "Alpha" holder=M1 (in team scope, flightRisk
/// 0.9, band L5), CR2 "Beta" holder=OrgReader (OUT of team scope, flightRisk 0.2, no band), CR3 "Gamma"
/// holder=M2 (in scope, band L5, successor S6=M4 ready_now). CR1 successors: S1(M1 ready_now), S2(M2
/// ready_1_year), S3(OrgReader developing — OUT of team successor scope). CR2 successor S4(M1 ready_now).
/// L5 midSalary 100000; M1 comp 87500 → comp-gap alert gapPercent 13 (userA), M4 comp 80000 → alert
/// gapPercent 20 (userB). Nine-box: M3=star (suggested successor for CR1; two rows, same evaluatedAt, later
/// createdAt 95/92 wins the tiebreak). OrgB seeds a DISTINCT role CRb so a cross-org RLS bleed shows.
///
/// Comp-scope bite (Codex hardening): CompLead holds succession:read@company + compensation:read@TEAM and
/// LEADS team T-A (only member M1) → team comp scope {CompLead, M1}. getCompGapAlerts keeps M1 (userA),
/// drops M4 (userB) — proving the employeeCompensation ROW filter, not just the field-level selectFor.
///
/// RBAC: hr_admin=succession:read@organization + compensation:read@organization (200 + org-gate + comp-gate
/// pass, both alerts); recruiter=succession:read@company (200 + org-gate pass, but NO compensation:read →
/// comp-gap 403); leader=succession:read@team (narrow → 403 on org-rollup reads F3; 404 IDOR on CR2;
/// scopeWhereFor drops CR2); hrbp/CompLead=succession:read@company + compensation:read@team (comp-gap 200,
/// only userA); employee=no grant (403).
/// </summary>
public sealed class SuccessionReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_succession_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid CriticalRole1 = Guid.Parse("5c000000-0000-0000-0000-000000000001"); // Alpha, holder M1 (in)
    public static readonly Guid CriticalRole2 = Guid.Parse("5c000000-0000-0000-0000-000000000002"); // Beta, holder OrgReader (out)
    public static readonly Guid CriticalRole3 = Guid.Parse("5c000000-0000-0000-0000-000000000003"); // Gamma, holder M2 (in), no succ
    public static readonly Guid CriticalRoleB = Guid.Parse("5c000000-0000-0000-0000-0000000000b0"); // OrgB

    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid OrgReaderId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid M1Id = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // CR1 holder + ready_now successor
    public static readonly Guid M2Id = Guid.Parse("d0000000-0000-0000-0000-000000000002"); // CR3 holder + ready_1_year successor
    public static readonly Guid M3Id = Guid.Parse("d0000000-0000-0000-0000-000000000003"); // star (suggested)
    public static readonly Guid M4Id = Guid.Parse("d0000000-0000-0000-0000-000000000004"); // userB: ready_now successor on CR3, OUT of team scope

    // Comp-scope bite (Codex hardening): CompLead holds succession:read@company + compensation:read@team and
    // LEADS team T-A whose only member is M1 (userA). So CompLead's team comp scope = {CompLead, M1} — M4
    // (userB, on T-B / no team) is out → its comp row is filtered out of getCompGapAlerts.
    public static readonly Guid CompLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000005");

    /// <summary>The team members TeamLead's team scope resolves to (self floor + M1/M2/M3). M4 is NOT here.</summary>
    public static IReadOnlyList<string> TeamMemberIds =>
        new[] { TeamLeadId, M1Id, M2Id, M3Id }.Select(g => g.ToString()).ToList();

    public const string OrgReaderSub = "sub-succ-org";
    public const string CompanyReaderSub = "sub-succ-company";
    public const string TeamLeadSub = "sub-succ-lead";
    public const string NoGrantSub = "sub-succ-none";
    public const string CompLeadSub = "sub-succ-complead";

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

    public SuccessionReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<SuccessionReadDbContext>().UseNpgsql(ConnectionString).Options);

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
        CREATE TABLE user_business_units (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, business_unit_id uuid NOT NULL);

        CREATE TABLE critical_roles (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, position_id text NULL,
            current_holder_id uuid NULL, company_id uuid NULL, unit_id uuid NULL, criticality text NOT NULL,
            flight_risk double precision NULL, target_band_level text NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE successors (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, critical_role_id uuid NOT NULL, user_id uuid NOT NULL,
            readiness text NOT NULL, type text NOT NULL, development_plan text NULL, added_by_id uuid NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE salary_bands (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, level text NOT NULL, mid_salary double precision NOT NULL);
        CREATE TABLE employee_compensations (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
            current_salary double precision NOT NULL, currency text NOT NULL DEFAULT 'USD');
        CREATE TABLE nine_box_evaluations (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, quadrant text NOT NULL,
            potential_score double precision NOT NULL, performance_score double precision NOT NULL,
            evaluated_at timestamp(3) NOT NULL, created_at timestamp(3) NOT NULL,
            -- adopted 2026-08-09 (#120): prod carries this NOT NULL DEFAULT now(); the fixture omitted it
            updated_at timestamp(3) NOT NULL DEFAULT now());
        CREATE TABLE data_access_logs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL, actor_id uuid NOT NULL, data_type text NOT NULL, record_id uuid NOT NULL,
            action text NOT NULL, ip_address text NULL, user_agent text NULL,
            created_at timestamptz NOT NULL DEFAULT now());
        """;

    // user_teams has no organization_id → its policy joins teams (itself RLS'd). All other succession tables
    // are org-scoped. data_access_logs needs WITH CHECK so the fail-closed audit INSERT passes for the org.
    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units, critical_roles, successors,
            salary_bands, employee_compensations, nine_box_evaluations TO app_tenant;
        GRANT SELECT, INSERT ON data_access_logs TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                  ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                  ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;             ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;    ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;         ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE critical_roles ENABLE ROW LEVEL SECURITY;         ALTER TABLE critical_roles FORCE ROW LEVEL SECURITY;
        ALTER TABLE successors ENABLE ROW LEVEL SECURITY;             ALTER TABLE successors FORCE ROW LEVEL SECURITY;
        ALTER TABLE salary_bands ENABLE ROW LEVEL SECURITY;           ALTER TABLE salary_bands FORCE ROW LEVEL SECURITY;
        ALTER TABLE employee_compensations ENABLE ROW LEVEL SECURITY; ALTER TABLE employee_compensations FORCE ROW LEVEL SECURITY;
        ALTER TABLE nine_box_evaluations ENABLE ROW LEVEL SECURITY;   ALTER TABLE nine_box_evaluations FORCE ROW LEVEL SECURITY;
        ALTER TABLE data_access_logs ENABLE ROW LEVEL SECURITY;       ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users                 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams                 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units   USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON critical_roles        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON successors            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON salary_bands          USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON employee_compensations USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON nine_box_evaluations  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_teams            USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = user_teams.team_id));
        CREATE POLICY tenant_isolation ON data_access_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        -- All valid staff slugs (#150: a non-staff slug is dropped by the resolver → the org-gate never sees
        -- its scope, a FALSE-green 403).
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter'),
          ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'hrbp', 'Comp Lead');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'succession', 'read'),
          ('b0000000-0000-0000-0000-000000000002', 'compensation', 'read');

        -- hr_admin@organization holds BOTH succession:read + compensation:read (comp-gap fully passes);
        -- recruiter@company holds succession:read only (comp-gap secondary gate → 403); leader@team is narrow.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'company'),
          -- hrbp (CompLead): succession:read@company (PASSES the org-gate) + compensation:read@TEAM (narrow).
          -- Proves the comp ROW scope drops out-of-team comp rows even when succession is org-wide.
          ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'company'),
          ('90000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'team');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-succ-org',     'org@tims.test',     'Ana',  'Admin',   NULL, 'HR Director', NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-succ-lead',    'lead@tims.test',    'Tara', 'Team',    NULL, 'Lead',        NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-succ-none',    'none@tims.test',    'Ned',  'None',    NULL, 'Analyst',     NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-succ-company', 'company@tims.test', 'Cara', 'Company', NULL, 'Recruiter',   NULL, '2024-01-01 00:00:00', false, true),
          -- Team members M1/M2/M3 (OrgA) + OrgB member Mb.
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-succ-m1', 'm1@tims.test', 'Mia', 'One',   'a1.png', 'Engineer', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-succ-m2', 'm2@tims.test', 'Max', 'Two',   NULL,     'PM',       NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-succ-m3', 'm3@tims.test', 'Moe', 'Three', NULL,     'Staff Eng',NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-succ-m4', 'm4@tims.test', 'Mel', 'Four',  NULL,     'Engineer', NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-succ-complead', 'complead@tims.test', 'Cody', 'CompLead', NULL, 'HRBP', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-succ-mb', 'mb@tims.test', 'Bob', 'OrgB',  NULL,     'X',        NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004'),
          ('e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005');
        """;

    private const string SuccessionSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-000000000001', 'Unit One', true);

        -- TeamLead leads T1; members M1/M2/M3 → teamMemberIds = {TeamLead, M1, M2, M3}.
        -- CompLead leads T-A; only member is M1 → CompLead's team comp scope = {CompLead, M1} (M4 excluded).
        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha Team', 'c0000000-0000-0000-0000-000000000002', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('7ea00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Comp Team A', 'c0000000-0000-0000-0000-000000000005', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO user_teams (id, user_id, team_id, role, joined_at) VALUES
          ('11100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-02 00:00:00'),
          ('11100000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-03 00:00:00'),
          ('11100000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002', 'member', '2026-06-04 00:00:00');

        -- CR1 Alpha (holder M1, in team scope, high flight risk, target band L5); CR2 Beta (holder OrgReader,
        -- OUT of team scope, low flight risk, no band); CR3 Gamma (holder M2, in scope, no successors).
        INSERT INTO critical_roles (id, organization_id, title, position_id, current_holder_id, company_id, unit_id, criticality, flight_risk, target_band_level, created_at, updated_at) VALUES
          ('5c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alpha', NULL, 'd0000000-0000-0000-0000-000000000001', NULL, NULL, 'critical', 0.9, 'L5', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta',  NULL, 'c0000000-0000-0000-0000-000000000001', NULL, NULL, 'high',     0.2, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gamma', NULL, 'd0000000-0000-0000-0000-000000000002', NULL, NULL, 'low',      0.1, 'L5', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('5c000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'OrgB Role', NULL, 'd0000000-0000-0000-0000-0000000000b0', NULL, NULL, 'critical', 0.95, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        -- CR1 successors: S1(M1 ready_now), S2(M2 ready_1_year) both team members (in scope); S3(OrgReader
        -- developing) NOT a team member → dropped by scopeWhereFor('successor') for team-scoped callers.
        -- S6(M4 ready_now on CR3/Gamma, band L5): userB for the comp-scope bite — M4 is out of every team
        -- so a team compensation scope filters its comp row out of getCompGapAlerts.
        INSERT INTO successors (id, organization_id, critical_role_id, user_id, readiness, type, development_plan, added_by_id, created_at, updated_at) VALUES
          ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'ready_now',    'internal', NULL, 'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00'),
          ('60000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'ready_1_year', 'internal', NULL, 'c0000000-0000-0000-0000-000000000001', '2026-02-02 00:00:00', '2026-02-02 00:00:00'),
          ('60000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'developing',   'internal', NULL, 'c0000000-0000-0000-0000-000000000001', '2026-02-03 00:00:00', '2026-02-03 00:00:00'),
          ('60000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'ready_now',    'internal', NULL, 'c0000000-0000-0000-0000-000000000001', '2026-02-04 00:00:00', '2026-02-04 00:00:00'),
          ('60000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004', 'ready_now',    'internal', NULL, 'c0000000-0000-0000-0000-000000000001', '2026-02-06 00:00:00', '2026-02-06 00:00:00'),
          ('60000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', '5c000000-0000-0000-0000-0000000000b0', 'd0000000-0000-0000-0000-0000000000b0', 'ready_now',    'internal', NULL, NULL, '2026-02-01 00:00:00', '2026-02-01 00:00:00');

        INSERT INTO salary_bands (id, organization_id, level, mid_salary) VALUES
          ('8ba00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'L5', 100000);

        -- M1 (ready_now successor on CR1, IN team) 87500 < 90000 → alert gapPercent round(12.5)=13 [userA].
        -- M4 (ready_now successor on CR3, OUT of team) 80000 < 90000 → alert gapPercent 20 [userB]. A team
        -- compensation scope keeps M1, drops M4; org/company scope keeps BOTH.
        INSERT INTO employee_compensations (id, organization_id, user_id, current_salary, currency) VALUES
          ('9c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 87500, 'USD'),
          ('9c000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004', 80000, 'USD');

        -- M3 is a star (in team scope) and NOT already a successor of CR1 → suggested successor for CR1.
        -- Finding 3 tiebreak: a SECOND M3 nine-box row with the SAME evaluatedAt but a LATER createdAt and
        -- HIGHER scores. evaluatedAt-desc/createdAt-desc + first-seen dedup must keep THIS row (95/92), not
        -- the earlier 90/85 — inverting the createdAt tiebreak flips the surviving scores (the bite).
        INSERT INTO nine_box_evaluations (id, organization_id, user_id, quadrant, potential_score, performance_score, evaluated_at, created_at) VALUES
          -- Finding 3 tiebreak: three M3 rows arranged so the first-seen winner (evaluated_at DESC, created_at
          -- DESC) is decided by BOTH ordering clauses, so BOTH provably bite.
          --   R1 winner: latest evaluated_at (03-02) AND latest created_at within that group (03-02) → 95/92.
          --   R2: same evaluated_at (03-02), EARLIER created_at (03-01) → if the created_at tiebreak is
          --       reversed/removed, R2 (88/80) wins the 03-02 group → RED (pins the SECONDARY clause).
          --   R3: EARLIER evaluated_at (03-01) but the LATEST created_at overall (03-03) → if the evaluated_at
          --       primary clause is removed/reversed, R3 (60/60) wins on created_at → RED (pins the PRIMARY clause).
          ('9b000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000003', 'star', 95, 92, '2026-03-02 00:00:00', '2026-03-02 00:00:00'),
          ('9b000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000003', 'star', 88, 80, '2026-03-02 00:00:00', '2026-03-01 00:00:00'),
          ('9b000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000003', 'star', 60, 60, '2026-03-01 00:00:00', '2026-03-03 00:00:00');
        """;
}
