using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Reporting;

namespace Tims.IntegrationTests.Reporting;

/// <summary>
/// Phase-5 Slice 5 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED recruitment-analytics
/// tables (<c>offers</c>, <c>applications</c>, <c>pipeline_stages</c>, <c>stage_movements</c>,
/// <c>vacancies</c>) + the identity/RBAC plane, all under the SAME RLS mechanism as the other read fixtures
/// (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c> policy). The reporting reads run UNDER TenantScope (app_tenant + org GUC); the
/// privileged identity/RBAC reads run on the superuser connection (bypass RLS).
///
/// OrgA seed (deterministic funnel/source/kpi/lost-by-delay): 1 live vacancy V1 (assignee "Rick Recruiter")
/// with stages Applied/Screen/Offer; applications A1,A2 (active, Applied, linkedin), A3 (active, Screen,
/// referral), A4 (rejected, Screen, linkedin, overdue on its 24h SLA); one accepted offer O1 (from A1).
/// OrgB seed: a DISTINCT funnel (3 active in Applied, no hires) so a cross-org RLS bleed changes OrgA's
/// numbers, not just a total. RBAC: hr_admin grants vacancy:read@organization (200); team_lead grants
/// vacancy:read@team (narrow → 403, Codex F3); employee has no grant (403).
/// </summary>
public sealed class ReportingReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_reporting_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid VacancyA = Guid.Parse("f0000000-0000-0000-0000-00000000000a");
    public static readonly Guid VacancyB = Guid.Parse("f0000000-0000-0000-0000-00000000000b");

    // Staff-JWT boot-matrix subs: organization- and company-scope readers (200 — both pass the org-gate),
    // team-scope reader (403 F3), no-grant (403).
    public const string OrgReaderSub = "sub-report-org-reader";
    public const string CompanyReaderSub = "sub-report-company-reader";
    public const string TeamReaderSub = "sub-report-team-reader";
    public const string NoGrantSub = "sub-report-no-grant";

    // Deterministic OrgA expectations (see the seed below). Funnel is all-time (no period window).
    public const int OrgAFunnelApplied = 2;   // A1, A2 active in Applied
    public const int OrgAFunnelScreen = 1;     // A3 active in Screen (A4 is rejected → not counted)
    public const int OrgATotalApplications = 4; // A1..A4
    public const int OrgATotalHired = 1;        // O1 accepted
    public const double OrgAConversionPct = 25; // 1/4 → 25.0
    public const int OrgBFunnelApplied = 3;     // B1..B3 active in Applied (distinct from OrgA)

    // KPI (from before all rows): ttf = O1.respondedAt(06-11) − V1.createdAt(06-01) = 10d;
    // tth = O1.respondedAt(06-11) − A1.appliedAt(06-03) = 8d; lostByDelay = 1 (A4 overdue).
    public const int OrgAKpiTtf = 10;
    public const int OrgAKpiTth = 8;
    public const int OrgAKpiLostByDelay = 1;

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

        foreach (var sql in new[] { IdentitySchemaSql, IdentitySeedSql, ReportingSchemaSql, ReportingSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public ReportingReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<ReportingReadDbContext>().UseNpgsql(ConnectionString).Options);

    // Identity/RBAC schema (privileged path, no RLS). `users` carries first_name/last_name because the
    // recruiter-SLA report joins the vacancy assignee for the display name.
    private const string IdentitySchemaSql =
        """
        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NULL,
            last_name text NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            slug text NOT NULL,
            name text NOT NULL
        );
        CREATE TABLE user_roles (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users (id),
            role_id uuid NOT NULL REFERENCES roles (id)
        );
        CREATE TABLE permissions (
            id uuid PRIMARY KEY,
            module text NOT NULL,
            action text NOT NULL
        );
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY,
            role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id),
            scope text NOT NULL DEFAULT 'own'
        );
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        -- All four are VALID staff-role slugs (super_admin/hr_admin/hrbp/recruiter/leader/committee/employee);
        -- a non-staff slug would be dropped by the principal resolver, so the org-gate would never see its
        -- scope — the team-scope 403 must come from the org-gate, not from role filtering.
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'vacancy', 'read');

        -- hr_admin at ORGANIZATION scope + recruiter at COMPANY scope both pass the org-gate;
        -- leader at TEAM scope is narrow → the org-gate fails closed (Codex F3); employee has NO grant.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'company');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-report-org-reader', 'org@tims.test', 'Rick', 'Recruiter', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-report-team-reader', 'team@tims.test', 'Tara', 'Team', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-report-no-grant', 'none@tims.test', 'Ned', 'None', false, true),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-report-company-reader', 'company@tims.test', 'Cara', 'Company', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004');
        """;

    // Reporting schema: the five aggregation tables (plain-String status/source) under RLS. `users` also
    // gets RLS so the assignee join is tenant-isolated for the reporting (app_tenant) path.
    private const string ReportingSchemaSql =
        """
        GRANT SELECT ON users TO app_tenant;
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        ALTER TABLE users FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON users
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        CREATE TABLE vacancies (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            status text NOT NULL DEFAULT 'draft',
            assigned_to uuid NULL,
            created_at timestamp(3) NOT NULL,
            deleted_at timestamp(3) NULL
        );
        CREATE TABLE pipeline_stages (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            vacancy_id uuid NOT NULL,
            name text NOT NULL,
            "order" integer NOT NULL,
            sla_hours integer NULL,
            created_at timestamp(3) NOT NULL
        );
        CREATE TABLE applications (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            vacancy_id uuid NOT NULL,
            current_stage_id uuid NOT NULL,
            source text NOT NULL,
            status text NOT NULL DEFAULT 'active',
            applied_at timestamp(3) NOT NULL,
            rejected_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL
        );
        CREATE TABLE stage_movements (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            application_id uuid NOT NULL,
            moved_at timestamp(3) NOT NULL
        );
        CREATE TABLE offers (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            vacancy_id uuid NOT NULL,
            application_id uuid NULL,
            status text NOT NULL DEFAULT 'draft',
            sent_at timestamp(3) NULL,
            responded_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL
        );

        GRANT SELECT ON vacancies, pipeline_stages, applications, stage_movements, offers TO app_tenant;

        ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;      ALTER TABLE vacancies FORCE ROW LEVEL SECURITY;
        ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY; ALTER TABLE pipeline_stages FORCE ROW LEVEL SECURITY;
        ALTER TABLE applications ENABLE ROW LEVEL SECURITY;    ALTER TABLE applications FORCE ROW LEVEL SECURITY;
        ALTER TABLE stage_movements ENABLE ROW LEVEL SECURITY; ALTER TABLE stage_movements FORCE ROW LEVEL SECURITY;
        ALTER TABLE offers ENABLE ROW LEVEL SECURITY;          ALTER TABLE offers FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON vacancies      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON pipeline_stages USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON applications   USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON stage_movements USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON offers         USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // OrgA V1 (Rick Recruiter): stages Applied(48h)/Screen(24h)/Offer; A1,A2 active Applied; A3 active
    // Screen; A4 rejected Screen (overdue); O1 accepted from A1. OrgB V-B: 3 active in Applied, no hires.
    private const string ReportingSeedSql =
        """
        INSERT INTO vacancies (id, organization_id, status, assigned_to, created_at, deleted_at) VALUES
          ('f0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'published', 'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', NULL),
          ('f0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'published', NULL, '2026-06-01 00:00:00', NULL);

        INSERT INTO pipeline_stages (id, organization_id, vacancy_id, name, "order", sla_hours, created_at) VALUES
          ('50000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', 'Applied', 0, 48, '2026-06-01 00:00:00'),
          ('50000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', 'Screen', 1, 24, '2026-06-01 00:00:00'),
          ('50000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', 'Offer', 2, NULL, '2026-06-01 00:00:00'),
          ('50000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-00000000000b', 'Applied', 0, 48, '2026-06-01 00:00:00');

        INSERT INTO applications (id, organization_id, vacancy_id, current_stage_id, source, status, applied_at, rejected_at, created_at) VALUES
          ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1', 'linkedin', 'active',   '2026-06-03 00:00:00', NULL, '2026-06-03 00:00:00'),
          ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1', 'linkedin', 'active',   '2026-06-04 00:00:00', NULL, '2026-06-04 00:00:00'),
          ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a2', 'referral', 'active',   '2026-06-05 00:00:00', NULL, '2026-06-05 00:00:00'),
          ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a2', 'linkedin', 'rejected', '2026-06-02 00:00:00', '2026-06-07 00:00:00', '2026-06-02 00:00:00'),
          ('b1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-0000000000b1', 'linkedin', 'active', '2026-06-03 00:00:00', NULL, '2026-06-03 00:00:00'),
          ('b1000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-0000000000b1', 'linkedin', 'active', '2026-06-03 00:00:00', NULL, '2026-06-03 00:00:00'),
          ('b1000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-0000000000b1', 'linkedin', 'active', '2026-06-03 00:00:00', NULL, '2026-06-03 00:00:00');

        -- A4 entered Screen on 06-04 → at rejection 06-07 it sat 72h > the 24h SLA (lost by delay).
        INSERT INTO stage_movements (id, organization_id, application_id, moved_at) VALUES
          ('11000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000004', '2026-06-04 00:00:00');

        INSERT INTO offers (id, organization_id, vacancy_id, application_id, status, sent_at, responded_at, created_at) VALUES
          ('01000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'accepted', '2026-06-05 00:00:00', '2026-06-11 00:00:00', '2026-06-05 00:00:00');
        """;
}
