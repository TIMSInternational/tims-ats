using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.NineBox;

namespace Tims.IntegrationTests.NineBox;

/// <summary>
/// Phase-5 Slice 10 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED nine-box tables
/// (<c>nine_box_evaluations</c>, <c>calibration_sessions</c>, <c>calibration_members</c>,
/// <c>calibration_votes</c>) + the anchor plane (<c>teams</c>, <c>user_teams</c>, <c>business_units</c>,
/// <c>users</c>) + the identity/RBAC plane, all under the SAME RLS mechanism as the other read fixtures
/// (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c>; calibration_members/votes are RLS'd through their session join).
///
/// Scope seed (OrgA period 2026Q1 unless noted): TeamLead leads T1 (members M1/M2/M3). Evaluations:
/// M1 Q1 core_player + Q2 star (a movement); M2 Q1 core_player; M3 Q1 high_potential; M4 Q1 risk + Q2
/// underperformer (a movement). M4 is NOT in T1 → team scope drops it (grid + movement). M1.company_id = C1;
/// T1.business_unit_id = BU1 → the getGrid companyId/unitId intersect. Calibration: CS1 (TeamLead-created,
/// draft, members M1/M2); CS2 (OrgReader-created, finalized, members MemberReader/M3, one vote). OrgB seeds a
/// DISTINCT evaluation so a cross-org RLS bleed shows.
///
/// RBAC: hr_admin=ninebox:read@organization (org-gate + subject pass); recruiter=ninebox:read@company (org-gate
/// pass, scopeWhereFor → MatchAll); leader=ninebox:read@team (narrow → 403 on org-rollup F3; scopeWhereFor +
/// assertSubjectInScope drop out-of-team; TeamLead is CS1's creator, MemberReader is CS2's member); employee=no
/// grant (403).
/// </summary>
public sealed class NineBoxReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_ninebox_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid CompanyC1 = Guid.Parse("c0c00000-0000-0000-0000-000000000001");
    public static readonly Guid BusinessUnitBu1 = Guid.Parse("b0b00000-0000-0000-0000-000000000001");
    public static readonly Guid Team1 = Guid.Parse("7ea00000-0000-0000-0000-000000000001");

    public static readonly Guid OrgReaderId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid NoGrantId = Guid.Parse("c0000000-0000-0000-0000-000000000003");
    public static readonly Guid CompanyReaderId = Guid.Parse("c0000000-0000-0000-0000-000000000004");
    public static readonly Guid MemberReaderId = Guid.Parse("c0000000-0000-0000-0000-000000000005");

    public static readonly Guid M1Id = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // in team, company C1
    public static readonly Guid M2Id = Guid.Parse("d0000000-0000-0000-0000-000000000002"); // in team
    public static readonly Guid M3Id = Guid.Parse("d0000000-0000-0000-0000-000000000003"); // in team, high_potential
    public static readonly Guid M4Id = Guid.Parse("d0000000-0000-0000-0000-000000000004"); // OUT of team
    public static readonly Guid MbId = Guid.Parse("d0000000-0000-0000-0000-0000000000b0"); // OrgB

    public static readonly Guid Session1 = Guid.Parse("ca000000-0000-0000-0000-000000000001"); // TeamLead, draft
    public static readonly Guid Session2 = Guid.Parse("ca000000-0000-0000-0000-000000000002"); // OrgReader, finalized

    public const string Period = "2026Q1";

    /// <summary>The team members TeamLead's team scope resolves to (self floor + M1/M2/M3). M4 is NOT here.</summary>
    public static IReadOnlyList<string> TeamMemberIds =>
        new[] { TeamLeadId, M1Id, M2Id, M3Id }.Select(g => g.ToString()).ToList();

    public const string OrgReaderSub = "sub-nb-org";
    public const string TeamLeadSub = "sub-nb-lead";
    public const string NoGrantSub = "sub-nb-none";
    public const string CompanyReaderSub = "sub-nb-company";
    public const string MemberReaderSub = "sub-nb-member";

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

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, NineBoxSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public NineBoxReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<NineBoxReadDbContext>().UseNpgsql(ConnectionString).Options);

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
            company_id uuid NULL,
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

        CREATE TABLE nine_box_evaluations (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, period text NOT NULL,
            potential_score double precision NOT NULL, performance_score double precision NOT NULL,
            quadrant text NOT NULL, confidence double precision NOT NULL, axis_breakdown jsonb NOT NULL,
            evaluated_at timestamp(3) NOT NULL, created_at timestamp(3) NOT NULL);
        CREATE TABLE calibration_sessions (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, period text NOT NULL, status text NOT NULL,
            scheduled_at timestamp(3) NULL, completed_at timestamp(3) NULL, created_by_id uuid NOT NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE calibration_members (
            id uuid PRIMARY KEY, session_id uuid NOT NULL, user_id uuid NOT NULL, status text NOT NULL,
            created_at timestamp(3) NOT NULL);
        CREATE TABLE calibration_votes (
            id uuid PRIMARY KEY, session_id uuid NOT NULL, evaluated_user_id uuid NOT NULL, voter_id uuid NOT NULL,
            quadrant text NOT NULL, justification text NULL, created_at timestamp(3) NOT NULL);
        """;

    // user_teams / calibration_members / calibration_votes have no organization_id → their policies join a
    // parent table (teams / calibration_sessions) that is itself RLS'd. All other tables are org-scoped.
    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units, nine_box_evaluations,
            calibration_sessions, calibration_members, calibration_votes TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                  ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                  ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;             ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;    ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;         ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE nine_box_evaluations ENABLE ROW LEVEL SECURITY;   ALTER TABLE nine_box_evaluations FORCE ROW LEVEL SECURITY;
        ALTER TABLE calibration_sessions ENABLE ROW LEVEL SECURITY;   ALTER TABLE calibration_sessions FORCE ROW LEVEL SECURITY;
        ALTER TABLE calibration_members ENABLE ROW LEVEL SECURITY;    ALTER TABLE calibration_members FORCE ROW LEVEL SECURITY;
        ALTER TABLE calibration_votes ENABLE ROW LEVEL SECURITY;      ALTER TABLE calibration_votes FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users                 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams                 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units   USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON nine_box_evaluations  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON calibration_sessions  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_teams            USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = user_teams.team_id));
        CREATE POLICY tenant_isolation ON calibration_members   USING (EXISTS (SELECT 1 FROM calibration_sessions s WHERE s.id = calibration_members.session_id));
        CREATE POLICY tenant_isolation ON calibration_votes     USING (EXISTS (SELECT 1 FROM calibration_sessions s WHERE s.id = calibration_votes.session_id));
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        -- Valid staff slugs (#150): a non-staff slug is dropped by the resolver → the org-gate never sees it.
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'ninebox', 'read');

        -- hr_admin@organization + recruiter@company pass the org-gate; leader@team is narrow; employee = no grant.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'company');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, company_id, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-nb-org',     'org@tims.test',     'Ana',  'Admin',   NULL, 'HR Director', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-nb-lead',    'lead@tims.test',    'Tara', 'Team',    NULL, 'Lead',        NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-nb-none',    'none@tims.test',    'Ned',  'None',    NULL, 'Analyst',     NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-nb-company', 'company@tims.test', 'Cara', 'Company', NULL, 'Recruiter',   NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-nb-member',  'member@tims.test',  'Mora', 'Member',  NULL, 'Lead',        NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-nb-m1', 'm1@tims.test', 'Mia', 'One',   'a1.png', 'Engineer',  'c0c00000-0000-0000-0000-000000000001', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-nb-m2', 'm2@tims.test', 'Max', 'Two',   NULL,     'PM',        NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-nb-m3', 'm3@tims.test', 'Moe', 'Three', NULL,     'Staff Eng', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-nb-m4', 'm4@tims.test', 'Mel', 'Four',  NULL,     'Engineer',  NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-nb-mb', 'mb@tims.test', 'Bob', 'OrgB',  NULL,     'X',         NULL, NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004'),
          -- MemberReader also holds leader@team (narrow) — it reads CS2 as a MEMBER (not creator).
          ('e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002');
        """;

    private const string NineBoxSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-000000000001', 'Unit One', true);

        -- TeamLead leads T1; members M1/M2/M3 → teamMemberIds = {TeamLead, M1, M2, M3}. M4 is NOT a member.
        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha Team', 'c0000000-0000-0000-0000-000000000002', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO user_teams (id, user_id, team_id, role, joined_at) VALUES
          ('11100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-02 00:00:00'),
          ('11100000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-03 00:00:00');

        -- Evaluations (period 2026Q1 unless the id says Q2). M1: Q1 core_player → Q2 star (a movement). M2: Q1
        -- core_player. M3: Q1 high_potential. M4 (OUT of team): Q1 risk → Q2 underperformer (a movement). OrgB
        -- Mb: Q1 star (cross-org). axis_breakdown is a jsonb passthrough.
        INSERT INTO nine_box_evaluations (id, organization_id, user_id, period, potential_score, performance_score, quadrant, confidence, axis_breakdown, evaluated_at, created_at) VALUES
          ('9b000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', '2026Q1', 60, 60, 'core_player',    0.8, '{"potential":60,"performance":60}', '2026-03-01 00:00:00', '2026-03-01 00:00:00'),
          ('9b000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', '2026Q2', 90, 90, 'star',           0.9, '{"potential":90,"performance":90}', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('9b000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', '2026Q1', 50, 50, 'core_player',    0.7, '{"potential":50,"performance":50}', '2026-03-02 00:00:00', '2026-03-02 00:00:00'),
          ('9b000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000003', '2026Q1', 80, 40, 'high_potential', 0.6, '{"potential":80,"performance":40}', '2026-03-03 00:00:00', '2026-03-03 00:00:00'),
          ('9b000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004', '2026Q1', 20, 20, 'risk',           0.5, '{"potential":20,"performance":20}', '2026-03-04 00:00:00', '2026-03-04 00:00:00'),
          ('9b000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004', '2026Q2', 30, 30, 'underperformer', 0.5, '{"potential":30,"performance":30}', '2026-06-04 00:00:00', '2026-06-04 00:00:00'),
          ('9b000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b0', '2026Q1', 95, 95, 'star',           0.9, '{"potential":95,"performance":95}', '2026-03-01 00:00:00', '2026-03-01 00:00:00');

        -- CS1: TeamLead-created, draft, members M1/M2 (createdAt later → first in listCalibrations desc).
        -- CS2: OrgReader-created, finalized, members MemberReader/M3, one vote (MemberReader → M3 star).
        INSERT INTO calibration_sessions (id, organization_id, period, status, scheduled_at, completed_at, created_by_id, created_at, updated_at) VALUES
          ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft',     '2026-05-10 00:00:00', NULL,                  'c0000000-0000-0000-0000-000000000002', '2026-05-02 00:00:00', '2026-05-02 00:00:00'),
          ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '2026Q1', 'finalized', NULL,                  '2026-05-05 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        INSERT INTO calibration_members (id, session_id, user_id, status, created_at) VALUES
          ('cb000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'invited', '2026-05-02 01:00:00'),
          ('cb000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'invited', '2026-05-02 02:00:00'),
          ('cb000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000005', 'invited', '2026-05-01 01:00:00'),
          ('cb000000-0000-0000-0000-000000000004', 'ca000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'invited', '2026-05-01 02:00:00');

        INSERT INTO calibration_votes (id, session_id, evaluated_user_id, voter_id, quadrant, justification, created_at) VALUES
          ('cc000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000005', 'star', 'strong', '2026-05-05 01:00:00');
        """;
}
