using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Compensation;

namespace Tims.IntegrationTests.Compensation;

/// <summary>
/// Phase-5 Slice 9 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED FX-free compensation
/// tables (<c>salary_bands</c>, <c>employee_compensations</c>, <c>salary_adjustments</c>, <c>benefit_plans</c>,
/// <c>benefit_enrollments</c>) + the anchor plane (<c>teams</c>, <c>user_teams</c>, <c>business_units</c>,
/// <c>users</c>) + the identity/RBAC plane + append-only <c>data_access_logs</c>, all under the SAME RLS
/// mechanism as the other read fixtures (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL
/// SECURITY, fail-closed <c>tenant_isolation</c>).
///
/// Scope seed (OrgA): TeamLead leads T1 (members M1/M2) → teamMemberIds = {TeamLead, M1, M2}. Five positive
/// comps (M1 cr 0.90 band L5 var 5000; M2/TeamLead/OrgHr 0.95; Emp 0.95 band L5 var 3000) → compa-ratio
/// distribution NON-suppressed (bucket 0.90-1.00 = 5). CompanyRec has NO comp (myCompensation → null).
/// Adjustments: ADJ1(M1, pending) + ADJ2(Emp, pending) + ADJ3(M2, approved). RBAC: hr_admin=comp:read@org
/// (full fields, org-gate pass); recruiter=comp:read@company (org-gate pass); leader=comp:read@team (narrow →
/// 403 on org-rollup; status-only on adjustments; salary/currency-only on employee comp); employee=comp:read@own;
/// hrbp=NO comp grant (403). OrgB seeds a DISTINCT band (LB) + THREE comps (min-5 → compa-ratio suppressed) so
/// a cross-org RLS bleed AND the endpoint-level min-5 both show.
/// </summary>
public sealed class CompensationReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_compensation_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid OrgHrId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid EmpId = Guid.Parse("c0000000-0000-0000-0000-000000000003");
    public static readonly Guid CompanyRecId = Guid.Parse("c0000000-0000-0000-0000-000000000004");
    public static readonly Guid NoGrantId = Guid.Parse("c0000000-0000-0000-0000-000000000005");
    public static readonly Guid M1Id = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // in TeamLead scope
    public static readonly Guid M2Id = Guid.Parse("d0000000-0000-0000-0000-000000000002"); // in TeamLead scope
    public static readonly Guid OrgBHrId = Guid.Parse("c0000000-0000-0000-0000-0000000000b0");

    public const string OrgHrSub = "sub-comp-org";
    public const string TeamLeadSub = "sub-comp-lead";
    public const string EmpSub = "sub-comp-emp";
    public const string CompanyRecSub = "sub-comp-company";
    public const string NoGrantSub = "sub-comp-none";
    public const string OrgBHrSub = "sub-comp-orgb";
    // F1 bite: an OrgB caller with compensation:read @ UNIT scope but NO user_business_units row → an empty
    // unitMemberIds() set that does NOT contain the caller. myCompensation must run assertSubjectInScope(caller,
    // caller) and 403 (byte-faithful to TS), NOT return the caller's own comp. Isolated in OrgB w/ no comp row
    // (the assertion fires before the fetch) → zero impact on the OrgA min-5 / benefits fixtures.
    public const string UnitScopeSub = "sub-comp-unit-b";

    /// <summary>TeamLead's team scope resolves to self + M1/M2 (Emp is NOT here).</summary>
    public static IReadOnlyList<string> TeamMemberIds =>
        new[] { TeamLeadId, M1Id, M2Id }.Select(g => g.ToString()).ToList();

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

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, CompensationSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public CompensationReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<CompensationReadDbContext>().UseNpgsql(ConnectionString).Options);

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

        CREATE TABLE salary_bands (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, level text NOT NULL, title text NULL,
            min_salary double precision NOT NULL, mid_salary double precision NOT NULL, max_salary double precision NOT NULL,
            currency text NOT NULL DEFAULT 'USD', is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE employee_compensations (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
            current_salary double precision NOT NULL, currency text NOT NULL DEFAULT 'USD',
            compa_ratio double precision NULL, band_id uuid NULL, variable_pay double precision NULL,
            effective_date timestamp(3) NOT NULL, created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE salary_adjustments (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, type text NOT NULL,
            previous_salary double precision NOT NULL, new_salary double precision NOT NULL,
            currency text NOT NULL DEFAULT 'USD', reason text NULL, status text NOT NULL DEFAULT 'pending',
            approved_by_id uuid NULL, effective_date timestamp(3) NULL, requested_by_id uuid NOT NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE benefit_plans (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, type text NOT NULL,
            description text NULL, is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE benefit_enrollments (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, benefit_plan_id uuid NOT NULL,
            enrolled_at timestamp(3) NOT NULL, status text NOT NULL DEFAULT 'active');
        CREATE TABLE data_access_logs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL, actor_id uuid NOT NULL, data_type text NOT NULL, record_id uuid NOT NULL,
            action text NOT NULL, ip_address text NULL, user_agent text NULL,
            created_at timestamptz NOT NULL DEFAULT now());
        """;

    // user_teams has no organization_id → its policy joins teams (itself RLS'd). All compensation tables are
    // org-scoped. data_access_logs needs WITH CHECK so the fail-closed audit INSERT passes for the org.
    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units, salary_bands,
            employee_compensations, salary_adjustments, benefit_plans, benefit_enrollments TO app_tenant;
        GRANT SELECT, INSERT ON data_access_logs TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                   ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                   ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;              ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;     ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;          ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE salary_bands ENABLE ROW LEVEL SECURITY;            ALTER TABLE salary_bands FORCE ROW LEVEL SECURITY;
        ALTER TABLE employee_compensations ENABLE ROW LEVEL SECURITY;  ALTER TABLE employee_compensations FORCE ROW LEVEL SECURITY;
        ALTER TABLE salary_adjustments ENABLE ROW LEVEL SECURITY;      ALTER TABLE salary_adjustments FORCE ROW LEVEL SECURITY;
        ALTER TABLE benefit_plans ENABLE ROW LEVEL SECURITY;           ALTER TABLE benefit_plans FORCE ROW LEVEL SECURITY;
        ALTER TABLE benefit_enrollments ENABLE ROW LEVEL SECURITY;     ALTER TABLE benefit_enrollments FORCE ROW LEVEL SECURITY;
        ALTER TABLE data_access_logs ENABLE ROW LEVEL SECURITY;        ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users                  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams                  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units         USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON salary_bands           USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON employee_compensations USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON salary_adjustments     USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON benefit_plans          USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON benefit_enrollments    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_teams             USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = user_teams.team_id));
        CREATE POLICY tenant_isolation ON data_access_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter'),
          ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'hrbp', 'HRBP No Grant'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'OrgB HR'),
          ('a0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'committee', 'OrgB Committee Unit');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'compensation', 'read');

        -- hr_admin@organization (full fields, org-gate pass); recruiter@company (org-gate pass); leader@team
        -- (narrow → 403 on org-rollup, status-only fields); employee@own; hrbp = NO compensation grant (403);
        -- OrgB hr_admin@organization for the isolation + min-5 checks.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'own'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'company'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000001', 'unit');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-comp-org',     'org@tims.test',     'Ana',  'Admin',   NULL, 'HR Director', NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-comp-lead',    'lead@tims.test',    'Tara', 'Team',    NULL, 'Lead',        NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-comp-emp',     'emp@tims.test',     'Eli',  'Emp',     NULL, 'Analyst',     NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-comp-company', 'company@tims.test', 'Cara', 'Company', NULL, 'Recruiter',   NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-comp-none',    'none@tims.test',    'Ned',  'None',    NULL, 'HRBP',        NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-comp-m1',      'm1@tims.test',      'Mia',  'One',     NULL, 'Engineer',    NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-comp-m2',      'm2@tims.test',      'Max',  'Two',     NULL, 'PM',          NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-comp-orgb',    'orgb@tims.test',    'Bob',  'OrgB',    NULL, 'HR',          NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-comp-mb1',     'mb1@tims.test',     'Bea',  'B1',      NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'sub-comp-mb2',     'mb2@tims.test',     'Ben',  'B2',      NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b3', '22222222-2222-2222-2222-222222222222', 'sub-comp-mb3',     'mb3@tims.test',     'Bo',   'B3',      NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-0000000000b5', '22222222-2222-2222-2222-222222222222', 'sub-comp-unit-b',  'unitb@tims.test',   'Uma',  'Unit',    NULL, 'Committee',   NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004'),
          ('e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005'),
          ('e0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1'),
          ('e0000000-0000-0000-0000-0000000000b5', 'c0000000-0000-0000-0000-0000000000b5', 'a0000000-0000-0000-0000-0000000000b2');
        """;

    private const string CompensationSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-000000000001', 'Unit One', true);

        -- TeamLead leads T1; members M1/M2 → teamMemberIds = {TeamLead, M1, M2}. Emp is NOT a member.
        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha Team', 'c0000000-0000-0000-0000-000000000002', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO user_teams (id, user_id, team_id, role, joined_at) VALUES
          ('11100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-02 00:00:00');

        -- OrgA band L5 (mid 100000); OrgB band LB (isolation).
        INSERT INTO salary_bands (id, organization_id, level, title, min_salary, mid_salary, max_salary, currency, is_active, created_at, updated_at) VALUES
          ('8ba00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'L5', 'Senior', 80000, 100000, 120000, 'USD', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('8ba00000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'LB', 'OrgB Band', 50000, 60000, 70000, 'USD', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        -- OrgA: five positive comps → compa-ratio bucket 0.90-1.00 = 5 (non-suppressed). M1/Emp carry a band +
        -- variablePay + compaRatio so the field-auth bite is observable (hr sees them, leader/employee do not).
        INSERT INTO employee_compensations (id, organization_id, user_id, current_salary, currency, compa_ratio, band_id, variable_pay, effective_date, created_at, updated_at) VALUES
          ('9c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 90000, 'USD', 0.90, '8ba00000-0000-0000-0000-000000000001', 5000, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 95000, 'USD', 0.95, NULL, NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 95000, 'USD', 0.95, NULL, NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 95000, 'USD', 0.95, NULL, NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003', 70000, 'USD', 0.95, '8ba00000-0000-0000-0000-000000000001', 3000, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00');

        -- OrgB: three positive comps → compa-ratio positiveCount 3 → min-5 SUPPRESSED (empty distribution).
        INSERT INTO employee_compensations (id, organization_id, user_id, current_salary, currency, compa_ratio, band_id, variable_pay, effective_date, created_at, updated_at) VALUES
          ('9c000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b1', 55000, 'USD', 0.92, NULL, NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b2', 56000, 'USD', 0.93, NULL, NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-0000000000b3', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b3', 57000, 'USD', 0.94, NULL, NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00');

        -- Adjustments (OrgA): ADJ1(M1, pending, in TeamLead scope), ADJ2(Emp, pending, OUT of TeamLead scope),
        -- ADJ3(M2, APPROVED → excluded from the pending list). requestedBy = OrgHr.
        INSERT INTO salary_adjustments (id, organization_id, user_id, type, previous_salary, new_salary, currency, reason, status, approved_by_id, effective_date, requested_by_id, created_at, updated_at) VALUES
          ('5ad00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'merit',     80000, 90000, 'USD', 'strong performer', 'pending',  NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-02-03 00:00:00', '2026-02-03 00:00:00'),
          ('5ad00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003', 'promotion', 60000, 70000, 'USD', 'promo to L5',      'pending',  NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-02-02 00:00:00', '2026-02-02 00:00:00'),
          ('5ad00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 'market',    90000, 95000, 'USD', 'market adj',       'approved', 'c0000000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00', '2026-02-01 00:00:00');

        INSERT INTO benefit_plans (id, organization_id, name, type, description, is_active, created_at, updated_at) VALUES
          ('be000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Health', 'medical', NULL, true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO benefit_enrollments (id, organization_id, user_id, benefit_plan_id, enrolled_at, status) VALUES
          ('bf000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'be000000-0000-0000-0000-000000000001', '2026-01-05 00:00:00', 'active');
        """;
}
