using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Monitoring;

namespace Tims.IntegrationTests.Monitoring;

/// <summary>
/// Phase-5 Q0b slice 1 (issue #100) Testcontainers fixture: one real Postgres carrying the Prisma-OWNED
/// monitoring tables (<c>alerts</c>, <c>alert_rules</c>, <c>action_plans</c>, <c>vacancies</c>,
/// <c>salary_adjustments</c>, <c>surveys</c>, <c>survey_responses</c>) + the anchor plane
/// (<c>teams</c>, <c>user_teams</c>, <c>user_business_units</c>, <c>business_units</c>, <c>users</c>) +
/// the identity/RBAC plane, all under the SAME RLS mechanism as the other read fixtures
/// (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c>). Nothing is mocked: the RLS and RBAC assertions run against real Postgres.
///
/// <para><b>Three orgs, deliberately.</b> OrgA carries the real data. OrgB carries DIFFERENT data on
/// every table so a cross-org RLS bleed changes OrgA's numbers instead of hiding behind a shared zero.
/// <b>OrgC is EMPTY</b> — it exists so the suite answers "what does this print against an empty
/// database?" with real assertions (eight honest zero health rows, zero counts, an UNsuppressed 0
/// pendingAdjustments) rather than an unexamined tick.</para>
///
/// <para><b>OrgA seed shape.</b> 7 active users (+1 inactive, excluded from totalEmployees). Vacancies:
/// approved + published count, draft and a soft-deleted published one do not (→ 2). SalaryAdjustments:
/// 3 pending → SUB-FLOOR (suppressed); OrgB has 5 → visible. Surveys: 2 active + 1 draft (→ 2). Alerts:
/// 5 ACTIVE (recruitment 1 / dei 3 / engagement 1) + 1 dismissed, so <c>openAlerts</c>, the module
/// health map and the (status-agnostic) alert TREND all disagree with one another by design.
/// ActionPlans: AP1 (responsible M1, in the hrbp's unit) and AP2 (responsible M4, OUTSIDE it) are both
/// due inside the 14-day horizon; AP3 is completed, AP4 is due far away and AP5 has a NULL dueDate —
/// each excluded by a different clause. SurveyResponses sit in two fixed months, with ONE row placed at
/// 09:00 on the last day of June so the "monthEnd is midnight, not end-of-day" quirk is provable.</para>
///
/// <para><b>RBAC.</b> hr_admin = monitoring:read@organization (OrgA, OrgB and OrgC readers);
/// hrbp = monitoring:read@UNIT — the real seed grant (<c>packages/db/prisma/seed-access-matrix.ts</c>)
/// and the reason <c>getActionPlanAlerts</c> needs a row filter at all; employee = NO grant → 403. All
/// slugs are VALID staff slugs (<c>RoleSlugs.AssignableStaffRoleSet</c>) — an invalid slug is dropped by
/// the principal resolver and would give a FALSE-green 403 (the #150 lesson).</para>
/// </summary>
public sealed class MonitoringReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_monitoring_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid OrgC = Guid.Parse("33333333-3333-3333-3333-333333333333"); // EMPTY org

    public static readonly Guid BusinessUnit1 = Guid.Parse("b0b00000-0000-0000-0000-000000000001");
    public static readonly Guid BusinessUnit2 = Guid.Parse("b0b00000-0000-0000-0000-000000000002");

    public static readonly Guid OrgReaderId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    public static readonly Guid UnitReaderId = Guid.Parse("a0000000-0000-0000-0000-000000000002");
    public static readonly Guid NoGrantId = Guid.Parse("a0000000-0000-0000-0000-000000000003");

    public static readonly Guid M1 = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // BU1 — in the hrbp's unit
    public static readonly Guid M4 = Guid.Parse("d0000000-0000-0000-0000-000000000004"); // BU2 — OUTSIDE it

    public static readonly Guid Ap1 = Guid.Parse("a9000000-0000-0000-0000-000000000001"); // M1, pending, due soon
    public static readonly Guid Ap2 = Guid.Parse("a9000000-0000-0000-0000-000000000002"); // M4, pending, due soon

    public const string OrgReaderSub = "sub-mon-org";
    public const string UnitReaderSub = "sub-mon-unit";
    public const string NoGrantSub = "sub-mon-none";
    public const string OrgBReaderSub = "sub-mon-org-b";
    public const string OrgCReaderSub = "sub-mon-org-c";

    // Deterministic OrgA expectations (independent of the runtime `now`).
    public const int OrgATotalEmployees = 7;      // 3 staff readers + M1..M4, the inactive user excluded
    public const int OrgAActiveVacancies = 2;     // approved + published; draft and soft-deleted excluded
    public const int OrgAPendingAdjustments = 3;  // SUB-FLOOR → suppressed at the use case
    public const int OrgAActiveSurveys = 2;       // 2 active + 1 draft
    public const int OrgAOpenAlerts = 5;          // 5 active + 1 dismissed

    public const int OrgBTotalEmployees = 2;
    public const int OrgBPendingAdjustments = 5;  // >= floor → visible

    // The two fixed months the survey responses sit in.
    public static readonly DateTime May2026Start = new(2026, 5, 1, 0, 0, 0, DateTimeKind.Unspecified);
    public static readonly DateTime May2026End = new(2026, 5, 31, 0, 0, 0, DateTimeKind.Unspecified);
    public static readonly DateTime Jun2026Start = new(2026, 6, 1, 0, 0, 0, DateTimeKind.Unspecified);
    public static readonly DateTime Jun2026End = new(2026, 6, 30, 0, 0, 0, DateTimeKind.Unspecified);

    public const int OrgAMayResponses = 3;
    public const int OrgAJuneResponses = 6; // a 7th June row sits at 09:00 on the 30th → OUTSIDE the bound

    public const int OrgAMayAlertsCreated = 4;  // status-agnostic (one of them is the dismissed row's month-mate)
    public const int OrgAJuneAlertsCreated = 2; // includes the DISMISSED alert — the trend has no status filter

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

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, MonitoringSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public MonitoringReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<MonitoringReadDbContext>().UseNpgsql(ConnectionString).Options);

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

        CREATE TABLE alerts (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, rule_id uuid NULL, module text NOT NULL,
            severity text NOT NULL, title text NOT NULL, message text NOT NULL, metadata jsonb NULL,
            status text NOT NULL DEFAULT 'active', dismissed_by_id uuid NULL, dismissed_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL);
        CREATE TABLE alert_rules (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, module text NOT NULL, condition jsonb NOT NULL,
            severity text NOT NULL, message text NOT NULL, is_active boolean NOT NULL DEFAULT true,
            created_by_id uuid NOT NULL, created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE action_plans (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, responsible_id uuid NOT NULL,
            area text NULL, status text NOT NULL DEFAULT 'pending', due_date timestamp(3) NULL, actions jsonb NULL,
            notes text NULL, created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE vacancies (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, status text NOT NULL DEFAULT 'draft',
            deleted_at timestamp(3) NULL);
        CREATE TABLE salary_adjustments (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
            status text NOT NULL DEFAULT 'pending');
        CREATE TABLE surveys (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, type text NOT NULL,
            status text NOT NULL DEFAULT 'draft', questions jsonb NOT NULL, created_by_id uuid NOT NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE survey_responses (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, survey_id uuid NOT NULL, user_id uuid NULL,
            answers jsonb NOT NULL, submitted_at timestamp(3) NOT NULL);

        -- #173: `audit_logs`, so SecurityDenialAuditMiddleware's authz_denied write can be asserted
        -- end-to-end through the REAL pipeline (a 403 from MonitoringStaffGate must land a row).
        -- FKs point at this fixture's real `organizations`/`users` — more faithful than the isolated
        -- AuditWriterFixture's `users_audit` stand-in, and it means a bad actor_id fails loudly here.
        CREATE TABLE audit_logs (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
            actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
            action text NOT NULL,
            entity text NOT NULL,
            entity_id text NULL,
            changes jsonb NULL,
            metadata jsonb NULL,
            ip_address text NULL,
            user_agent text NULL,
            created_at timestamp NOT NULL DEFAULT now());
        """;

    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units, alerts, alert_rules,
            action_plans, vacancies, salary_adjustments, surveys, survey_responses TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;           ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;  ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;       ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;               ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
        ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;          ALTER TABLE alert_rules FORCE ROW LEVEL SECURITY;
        ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;         ALTER TABLE action_plans FORCE ROW LEVEL SECURITY;
        ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;            ALTER TABLE vacancies FORCE ROW LEVEL SECURITY;
        ALTER TABLE salary_adjustments ENABLE ROW LEVEL SECURITY;   ALTER TABLE salary_adjustments FORCE ROW LEVEL SECURITY;
        ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;              ALTER TABLE surveys FORCE ROW LEVEL SECURITY;
        ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;     ALTER TABLE survey_responses FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users               USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams               USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON alerts              USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON alert_rules         USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON action_plans        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON vacancies           USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON salary_adjustments  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON surveys             USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON survey_responses    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_teams          USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = user_teams.team_id));
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true),
          ('33333333-3333-3333-3333-333333333333', true);

        -- All VALID staff slugs (RoleSlugs.AssignableStaffRoleSet). An invalid slug is dropped by the
        -- principal resolver, and the endpoint would 403 for the WRONG reason (a false-green; #150).
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'hrbp', 'HRBP'),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('c0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'HR Admin'),
          ('c0000000-0000-0000-0000-0000000000c1', '33333333-3333-3333-3333-333333333333', 'hr_admin', 'HR Admin');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'monitoring', 'read');

        -- hr_admin@organization, hrbp@UNIT (the real seed grant), employee = NO grant row at all.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'unit'),
          ('90000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-000000000001', 'organization');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, company_id, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-mon-org',   'org@t.test',  'Ana',  'Admin', NULL,     'HR',  NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-mon-unit',  'unit@t.test', 'Uma',  'Unit',  NULL,     'HRBP', NULL, 'b0b00000-0000-0000-0000-000000000001', '2024-01-01 00:00:00', false, true),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-mon-none',  'none@t.test', 'Ned',  'None',  NULL,     'X',   NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-mon-m1',    'm1@t.test',   'Mia',  'One',   'a1.png', 'Eng', NULL, 'b0b00000-0000-0000-0000-000000000001', '2025-01-15 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-mon-m2',    'm2@t.test',   'Max',  'Two',   NULL,     'PM',  NULL, 'b0b00000-0000-0000-0000-000000000001', '2025-06-15 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-mon-m3',    'm3@t.test',   'Moe',  'Three', NULL,     'Eng', NULL, 'b0b00000-0000-0000-0000-000000000002', '2026-01-15 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-mon-m4',    'm4@t.test',   'Mel',  'Four',  NULL,     'Eng', NULL, 'b0b00000-0000-0000-0000-000000000002', '2026-02-15 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'sub-mon-m9',    'm9@t.test',   'Mo',   'Gone',  NULL,     'Eng', NULL, 'b0b00000-0000-0000-0000-000000000001', '2024-01-01 00:00:00', false, false),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-mon-org-b', 'orgb@t.test', 'Bea',  'AdminB', NULL,    'HR',  NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'sub-mon-mb',    'mb@t.test',   'Bob',  'OrgB',  NULL,     'X',   NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('a0000000-0000-0000-0000-0000000000c1', '33333333-3333-3333-3333-333333333333', 'sub-mon-org-c', 'orgc@t.test', 'Cid',  'AdminC', NULL,    'HR',  NULL, NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1'),
          ('e0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000c1');
        """;

    // OrgC is intentionally ABSENT from every statement below — it is the empty-database org.
    private const string MonitoringSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-00000000000a', 'Unit One', true),
          ('b0b00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-00000000000a', 'Unit Two', true);

        -- The hrbp is assigned to Unit One only → unitMemberIds = {UnitReader, M1, M2, inactive M9}.
        INSERT INTO user_business_units (id, organization_id, user_id, business_unit_id) VALUES
          ('bb000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002', 'b0b00000-0000-0000-0000-000000000001');

        -- 5 ACTIVE alerts (recruitment 1, dei 3, engagement 1) + 1 DISMISSED engagement alert. The
        -- dismissed row is the reason openAlerts (5), the module map and the status-agnostic alert
        -- TREND (4 in May, 2 in June) must all be asserted separately.
        INSERT INTO alerts (id, organization_id, rule_id, module, severity, title, message, metadata, status, created_at) VALUES
          ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL, 'recruitment', 'info',     'AL1', 'm', NULL, 'active',    '2026-05-10 00:00:00'),
          ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', NULL, 'dei',         'warning',  'AL2', 'm', NULL, 'active',    '2026-05-11 00:00:00'),
          ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', NULL, 'dei',         'critical', 'AL3', 'm', NULL, 'active',    '2026-05-12 00:00:00'),
          ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', NULL, 'dei',         'warning',  'AL4', 'm', NULL, 'active',    '2026-05-13 00:00:00'),
          ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', NULL, 'engagement',  'critical', 'AL5', 'm', NULL, 'active',    '2026-06-10 00:00:00'),
          ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', NULL, 'engagement',  'info',     'AL6', 'm', NULL, 'dismissed', '2026-06-11 00:00:00'),
          ('a1000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', NULL, 'people',      'info',     'ALB', 'm', NULL, 'active',    '2026-05-10 00:00:00');

        INSERT INTO alert_rules (id, organization_id, module, condition, severity, message, is_active, created_by_id, created_at, updated_at) VALUES
          ('a2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'recruitment', '{"metric":"open_vacancies","operator":"gt","threshold":10}', 'warning', 'R1', true, 'a0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('a2000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'dei',         '{"metric":"active_surveys","operator":"lt","threshold":2}',  'info',    'R2', false, 'a0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('a2000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'people',      '{"metric":"open_vacancies","operator":"gt","threshold":1}',  'info',    'RB', true, 'a0000000-0000-0000-0000-0000000000b1', '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        -- Each excluded plan is excluded by a DIFFERENT clause: AP3 by status, AP4 by the horizon,
        -- AP5 by the NULL dueDate (SQL `<=` never matches NULL — the Prisma `lte` semantics).
        INSERT INTO action_plans (id, organization_id, title, responsible_id, area, status, due_date, actions, notes, created_at, updated_at) VALUES
          ('a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'AP1 due soon, in unit',     'd0000000-0000-0000-0000-000000000001', 'Ambiente',  'pending',     now() + interval '1 day',  NULL, NULL, '2026-05-03 00:00:00', '2026-05-03 00:00:00'),
          ('a9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'AP2 due soon, OUT of unit', 'd0000000-0000-0000-0000-000000000004', 'Liderazgo', 'pending',     now() + interval '2 days', NULL, NULL, '2026-05-02 00:00:00', '2026-05-02 00:00:00'),
          ('a9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'AP3 completed',             'd0000000-0000-0000-0000-000000000001', 'Ambiente',  'completed',   now() + interval '1 day',  NULL, NULL, '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('a9000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'AP4 far future',            'd0000000-0000-0000-0000-000000000001', 'Ambiente',  'in_progress', now() + interval '60 days', NULL, NULL, '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('a9000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'AP5 null due date',         'd0000000-0000-0000-0000-000000000001', 'Ambiente',  'pending',     NULL,                      NULL, NULL, '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        INSERT INTO vacancies (id, organization_id, status, deleted_at) VALUES
          ('7ac00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'approved',  NULL),
          ('7ac00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'published', NULL),
          ('7ac00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'draft',     NULL),
          ('7ac00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'published', '2026-05-01 00:00:00'),
          ('7ac00000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'approved',  NULL);

        -- OrgA: 3 pending -> SUB-FLOOR (suppressed). OrgB: 5 pending -> at the floor, visible.
        INSERT INTO salary_adjustments (id, organization_id, user_id, status) VALUES
          ('5a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'pending'),
          ('5a000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 'pending'),
          ('5a000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000003', 'pending'),
          ('5a000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004', 'approved'),
          ('5a000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b2', 'pending'),
          ('5a000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b2', 'pending'),
          ('5a000000-0000-0000-0000-0000000000b3', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b2', 'pending'),
          ('5a000000-0000-0000-0000-0000000000b4', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b2', 'pending'),
          ('5a000000-0000-0000-0000-0000000000b5', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b2', 'pending');

        INSERT INTO surveys (id, organization_id, title, type, status, questions, created_by_id, created_at, updated_at) VALUES
          ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'S1', 'climate', 'active', '[]', 'a0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('50000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'S2', 'pulse',   'active', '[]', 'a0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('50000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'S3', 'pulse',   'draft',  '[]', 'a0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('50000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'SB', 'climate', 'active', '[]', 'a0000000-0000-0000-0000-0000000000b1', '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        -- May 2026: 3 responses (SUB-FLOOR). June 2026: 6 inside the bound, plus a 7th at 09:00 on the
        -- 30th which falls OUTSIDE `submitted_at <= 2026-06-30 00:00` — the "monthEnd is midnight, not
        -- end-of-day" quirk, provable rather than asserted in prose.
        INSERT INTO survey_responses (id, organization_id, survey_id, user_id, answers, submitted_at) VALUES
          ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-05-02 00:00:00'),
          ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-05-03 00:00:00'),
          ('51000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-05-04 00:00:00'),
          ('51000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-06-02 00:00:00'),
          ('51000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-06-03 00:00:00'),
          ('51000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-06-04 00:00:00'),
          ('51000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-06-05 00:00:00'),
          ('51000000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-06-06 00:00:00'),
          ('51000000-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-06-30 00:00:00'),
          ('51000000-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', '2026-06-30 09:00:00'),
          ('51000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', '50000000-0000-0000-0000-0000000000b1', NULL, '{}', '2026-05-02 00:00:00'),
          -- CURRENT MONTH, seeded RELATIVE TO now() on purpose: 3 responses = sub-floor (0 < n < 5).
          -- The live 6m window is anchored on the runtime clock, so the fixed May-2026 sub-floor bucket
          -- above drifts out of it as the calendar advances — which is exactly why deleting the floor
          -- call from MonitoringReadUseCase left every monitoring test green (#140 major finding 2).
          -- A sub-floor bucket in the current month is inside the window forever, so the all-or-nothing
          -- suppression the use case must apply becomes deterministically assertable.
          ('51000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', now()),
          ('51000000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', now()),
          ('51000000-0000-0000-0000-0000000000c3', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', NULL, '{}', now());
        """;
}
