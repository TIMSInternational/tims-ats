using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.Engagement;

/// <summary>
/// Phase-5 Slice 11 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED engagement tables
/// (<c>surveys</c>, <c>survey_responses</c>, <c>action_plans</c>, <c>leader_commitments</c>, <c>alerts</c>) + the
/// anchor plane (<c>teams</c>, <c>user_teams</c>, <c>user_business_units</c>, <c>business_units</c>, <c>users</c>)
/// + the identity/RBAC plane, all under the SAME RLS mechanism as the other read fixtures (NOLOGIN/NOBYPASSRLS
/// <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed <c>tenant_isolation</c>).
///
/// Seed (OrgA): S1 climate (active, 6 responses M1..M6 — M1-M4 companyA, M5-M6 companyB); S2 pulse (closed, 3
/// responses M1/M2/M3 → SUB-FLOOR); S_enps (active, 6 recent responses, ALL score 9 → promoters=6, enps=100,
/// non-suppressed). ActionPlans: AP1(resp=M1,pending), AP2(resp=M4,pending), AP3(resp=M2,completed).
/// LeaderCommitments: LC1(leader=M1), LC2(leader=M4). Alert A1 (engagement/active). TeamLead leads Team1
/// (members M1/M2/M3) → teamMemberIds={TeamLead,M1,M2,M3}; M4 is OUT. OrgB seeds a DISTINCT survey/response/alert
/// so a cross-org RLS bleed shows, PLUS its own eNPS survey (5 responses MB..MB4, ALL score 0 → detractors=5,
/// enps=-100, non-suppressed and DIFFERENT from OrgA's) so the eNPS cross-tenant isolation check has real,
/// differentiated data to compare instead of two k-anonymity-suppressed nulls.
///
/// RBAC: hr_admin=engagement:read@organization (org-gate pass, both OrgA's OrgReader AND OrgB's OrgBReader);
/// recruiter=engagement:read@company (org-gate pass, scopeWhereFor→MatchAll); leader=engagement:read@team
/// (narrow → 403 on the org-rollup reads; scopeWhereFor drops out-of-team rows; own-scoped reads still pass);
/// employee=no grant (403).
/// </summary>
public sealed class EngagementReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_engagement_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid CompanyA = Guid.Parse("c0c00000-0000-0000-0000-00000000000a");
    public static readonly Guid CompanyB = Guid.Parse("c0c00000-0000-0000-0000-00000000000b");
    public static readonly Guid BusinessUnit1 = Guid.Parse("b0b00000-0000-0000-0000-000000000001");
    public static readonly Guid Team1 = Guid.Parse("7ea00000-0000-0000-0000-000000000001");

    public static readonly Guid OrgReaderId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    public static readonly Guid TeamLeadId = Guid.Parse("a0000000-0000-0000-0000-000000000002");
    public static readonly Guid NoGrantId = Guid.Parse("a0000000-0000-0000-0000-000000000003");
    public static readonly Guid CompanyReaderId = Guid.Parse("a0000000-0000-0000-0000-000000000004");
    public static readonly Guid OrgBReaderId = Guid.Parse("a0000000-0000-0000-0000-0000000000b1");

    public static readonly Guid M1 = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid M2 = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    public static readonly Guid M3 = Guid.Parse("d0000000-0000-0000-0000-000000000003");
    public static readonly Guid M4 = Guid.Parse("d0000000-0000-0000-0000-000000000004"); // OUT of team
    public static readonly Guid M5 = Guid.Parse("d0000000-0000-0000-0000-000000000005");
    public static readonly Guid M6 = Guid.Parse("d0000000-0000-0000-0000-000000000006");

    public static readonly Guid S1 = Guid.Parse("50000000-0000-0000-0000-000000000001"); // climate, active, 6
    public static readonly Guid S2 = Guid.Parse("50000000-0000-0000-0000-000000000002"); // pulse, closed, 3 (sub-floor)
    public static readonly Guid SEnps = Guid.Parse("50000000-0000-0000-0000-0000000000e0"); // enps, active, 6
    public static readonly Guid SbOrgB = Guid.Parse("50000000-0000-0000-0000-0000000000b0"); // OrgB survey

    public static readonly Guid Ap1 = Guid.Parse("a9000000-0000-0000-0000-000000000001"); // resp M1, pending
    public static readonly Guid Ap2 = Guid.Parse("a9000000-0000-0000-0000-000000000002"); // resp M4, pending
    public static readonly Guid Ap3 = Guid.Parse("a9000000-0000-0000-0000-000000000003"); // resp M2, completed
    public static readonly Guid Lc1 = Guid.Parse("1c000000-0000-0000-0000-000000000001"); // leader M1
    public static readonly Guid Lc2 = Guid.Parse("1c000000-0000-0000-0000-000000000002"); // leader M4

    public const string OrgReaderSub = "sub-eng-org";
    public const string TeamLeadSub = "sub-eng-lead";
    public const string NoGrantSub = "sub-eng-none";
    public const string CompanyReaderSub = "sub-eng-company";
    public const string OrgBReaderSub = "sub-eng-org-b";

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

        CREATE TABLE surveys (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, type text NOT NULL,
            status text NOT NULL DEFAULT 'draft', questions jsonb NOT NULL, target_groups jsonb NULL,
            starts_at timestamp(3) NULL, ends_at timestamp(3) NULL, response_count int NOT NULL DEFAULT 0,
            created_by_id uuid NOT NULL, created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE survey_responses (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, survey_id uuid NOT NULL, user_id uuid NULL,
            answers jsonb NOT NULL, submitted_at timestamp(3) NOT NULL);
        CREATE TABLE action_plans (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, responsible_id uuid NOT NULL,
            area text NULL, status text NOT NULL DEFAULT 'pending', due_date timestamp(3) NULL, actions jsonb NULL,
            notes text NULL, created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE leader_commitments (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, leader_id uuid NOT NULL, description text NOT NULL,
            status text NOT NULL DEFAULT 'pending', due_date timestamp(3) NULL, completed_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE alerts (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, rule_id uuid NULL, module text NOT NULL,
            severity text NOT NULL, title text NOT NULL, message text NOT NULL, metadata jsonb NULL,
            status text NOT NULL DEFAULT 'active', dismissed_by_id uuid NULL, dismissed_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL);
        """;

    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units, surveys, survey_responses,
            action_plans, leader_commitments, alerts TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                  ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                  ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;             ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;    ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;         ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;               ALTER TABLE surveys FORCE ROW LEVEL SECURITY;
        ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;      ALTER TABLE survey_responses FORCE ROW LEVEL SECURITY;
        ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;         ALTER TABLE action_plans FORCE ROW LEVEL SECURITY;
        ALTER TABLE leader_commitments ENABLE ROW LEVEL SECURITY;   ALTER TABLE leader_commitments FORCE ROW LEVEL SECURITY;
        ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;               ALTER TABLE alerts FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users                USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams                USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units       USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON surveys              USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON survey_responses     USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON action_plans         USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON leader_commitments   USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON alerts               USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_teams           USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = user_teams.team_id));
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter'),
          ('c0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'HR Admin');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'engagement', 'read');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'company'),
          ('90000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, company_id, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-eng-org',     'org@t.test',     'Ana',  'Admin',   NULL, 'HR', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-eng-lead',    'lead@t.test',    'Tara', 'Team',    NULL, 'Lead', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-eng-none',    'none@t.test',    'Ned',  'None',    NULL, 'X', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-eng-company', 'comp@t.test',    'Cara', 'Company', NULL, 'Rec', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-eng-org-b',   'orgb@t.test',    'Bea',  'AdminB',  NULL, 'HR', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-eng-m1', 'm1@t.test', 'Mia', 'One',   'a1.png', 'Eng', 'c0c00000-0000-0000-0000-00000000000a', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-eng-m2', 'm2@t.test', 'Max', 'Two',   NULL, 'PM', 'c0c00000-0000-0000-0000-00000000000a', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-eng-m3', 'm3@t.test', 'Moe', 'Three', NULL, 'Eng', 'c0c00000-0000-0000-0000-00000000000a', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-eng-m4', 'm4@t.test', 'Mel', 'Four',  NULL, 'Eng', 'c0c00000-0000-0000-0000-00000000000a', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-eng-m5', 'm5@t.test', 'Mo',  'Five',  NULL, 'Eng', 'c0c00000-0000-0000-0000-00000000000b', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'sub-eng-m6', 'm6@t.test', 'My',  'Six',   NULL, 'Eng', 'c0c00000-0000-0000-0000-00000000000b', NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-eng-mb', 'mb@t.test', 'Bob', 'OrgB',  NULL, 'X', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-eng-mb1', 'mb1@t.test', 'Bo', 'OrgB1', NULL, 'X', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'sub-eng-mb2', 'mb2@t.test', 'Bi', 'OrgB2', NULL, 'X', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b3', '22222222-2222-2222-2222-222222222222', 'sub-eng-mb3', 'mb3@t.test', 'Bu', 'OrgB3', NULL, 'X', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b4', '22222222-2222-2222-2222-222222222222', 'sub-eng-mb4', 'mb4@t.test', 'Be', 'OrgB4', NULL, 'X', NULL, NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004'),
          ('e0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1');
        """;

    private const string EngagementSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-00000000000a', 'Unit One', true);

        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha', 'a0000000-0000-0000-0000-000000000002', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO user_teams (id, user_id, team_id, role, joined_at) VALUES
          ('11100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-02 00:00:00'),
          ('11100000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-03 00:00:00');

        -- S1 climate ACTIVE (open window: startsAt past, endsAt null): 6 responses answering the scale q1.
        -- S2 pulse CLOSED: 3 responses (SUB-FLOOR → getSurveyResults suppressed + dashboard differencing guard).
        -- S_enps ACTIVE: 6 recent enps responses.
        INSERT INTO surveys (id, organization_id, title, type, status, questions, starts_at, ends_at, response_count, created_by_id, created_at, updated_at) VALUES
          ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Clima', 'climate', 'active', '[{"text":"q1","type":"scale","category":"Ambiente"}]', '2020-01-01 00:00:00', NULL, 6, 'a0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('50000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Pulse', 'pulse',   'closed', '[{"text":"q1","type":"scale"}]', '2020-01-01 00:00:00', '2021-01-01 00:00:00', 3, 'a0000000-0000-0000-0000-000000000001', '2026-04-01 00:00:00', '2026-04-01 00:00:00'),
          ('50000000-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'eNPS',  'enps',    'active', '[{"text":"score","type":"scale"}]', '2020-01-01 00:00:00', NULL, 6, 'a0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('50000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'OrgB',  'climate', 'active', '[{"text":"q1","type":"scale"}]', '2020-01-01 00:00:00', NULL, 5, 'd0000000-0000-0000-0000-0000000000b0', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          -- OrgB eNPS: 5 DETRACTOR (score 0) responses → real, non-suppressed, and DIFFERENT from
          -- OrgA's 6 promoter (score 9) responses above. Regression guard for the cross-tenant eNPS
          -- leak: with no OrgB eNPS data at all, OrgA and OrgB both trip the k-anonymity floor
          -- identically and return byte-identical suppressed payloads (see
          -- GetEnps_CrossOrg_ReturnsDifferentiatedData in EngagementReadEndpointTests.cs).
          ('50000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'eNPS OrgB', 'enps', 'active', '[{"text":"score","type":"scale"}]', '2020-01-01 00:00:00', NULL, 5, 'd0000000-0000-0000-0000-0000000000b0', '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        INSERT INTO survey_responses (id, organization_id, survey_id, user_id, answers, submitted_at) VALUES
          ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '{"q1":4}', '2026-05-02 00:00:00'),
          ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', '{"q1":4}', '2026-05-02 00:00:00'),
          ('51000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', '{"q1":4}', '2026-05-02 00:00:00'),
          ('51000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', '{"q1":4}', '2026-05-02 00:00:00'),
          ('51000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005', '{"q1":4}', '2026-05-02 00:00:00'),
          ('51000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006', '{"q1":4}', '2026-05-02 00:00:00'),
          ('52000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', '{"q1":3}', '2026-04-02 00:00:00'),
          ('52000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '{"q1":3}', '2026-04-02 00:00:00'),
          ('52000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', '{"q1":3}', '2026-04-02 00:00:00'),
          ('5e000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-0000000000e0', 'd0000000-0000-0000-0000-000000000001', '{"score":9}', now()),
          ('5e000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-0000000000e0', 'd0000000-0000-0000-0000-000000000002', '{"score":9}', now()),
          ('5e000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-0000000000e0', 'd0000000-0000-0000-0000-000000000003', '{"score":9}', now()),
          ('5e000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-0000000000e0', 'd0000000-0000-0000-0000-000000000004', '{"score":9}', now()),
          ('5e000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-0000000000e0', 'd0000000-0000-0000-0000-000000000005', '{"score":9}', now()),
          ('5e000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-0000000000e0', 'd0000000-0000-0000-0000-000000000006', '{"score":9}', now()),
          ('5b000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '50000000-0000-0000-0000-0000000000b0', 'd0000000-0000-0000-0000-0000000000b0', '{"q1":4}', '2026-05-02 00:00:00'),
          ('5f000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '50000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-0000000000b0', '{"score":0}', now()),
          ('5f000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '50000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-0000000000b1', '{"score":0}', now()),
          ('5f000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', '50000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-0000000000b2', '{"score":0}', now()),
          ('5f000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', '50000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-0000000000b3', '{"score":0}', now()),
          ('5f000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', '50000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-0000000000b4', '{"score":0}', now());

        INSERT INTO action_plans (id, organization_id, title, responsible_id, area, status, due_date, actions, notes, created_at, updated_at) VALUES
          ('a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'AP1', 'd0000000-0000-0000-0000-000000000001', 'Ambiente', 'pending',   NULL, NULL, NULL, '2026-05-03 00:00:00', '2026-05-03 00:00:00'),
          ('a9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'AP2', 'd0000000-0000-0000-0000-000000000004', 'Liderazgo', 'pending',   NULL, NULL, NULL, '2026-05-02 00:00:00', '2026-05-02 00:00:00'),
          ('a9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'AP3', 'd0000000-0000-0000-0000-000000000002', 'Ambiente', 'completed', NULL, NULL, NULL, '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        INSERT INTO leader_commitments (id, organization_id, leader_id, description, status, due_date, completed_at, created_at, updated_at) VALUES
          ('1c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'LC1', 'pending', '2026-08-01 00:00:00', NULL, '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('1c000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004', 'LC2', 'pending', '2026-09-01 00:00:00', NULL, '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        INSERT INTO alerts (id, organization_id, rule_id, module, severity, title, message, metadata, status, created_at) VALUES
          ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL, 'engagement', 'high', 'Clima bajo', 'Area X', '{"score":2}', 'active', '2026-05-05 00:00:00'),
          ('a1000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', NULL, 'engagement', 'high', 'OrgB', 'OrgB alert', NULL, 'active', '2026-05-05 00:00:00');
        """;
}
