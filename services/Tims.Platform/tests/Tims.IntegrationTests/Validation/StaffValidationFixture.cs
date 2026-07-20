using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Validation;

namespace Tims.IntegrationTests.Validation;

/// <summary>
/// Phase-5 staff-validation-write fixture: one real Postgres with the Prisma-OWNED
/// <c>preemployment_validations</c> (+ the <c>single_completer_chk</c> XOR) and the offer/vacancy/team scope
/// anchors, all under the SAME RLS mechanism as the other write fixtures (NOLOGIN/NOBYPASSRLS
/// <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed <c>tenant_isolation</c> + WITH CHECK),
/// plus the identity/RBAC plane (privileged, no RLS). The staff write + the offer IDOR probe run UNDER
/// TenantScope (app_tenant + org GUC); the principal/grant reads run on the superuser connection.
///
/// Scope seed: T1 is led by the team-lead user; V1 (team T1) is in the team-lead's team scope, V2 (team T2,
/// led by someone else) is OUT. O1→V1, O2→V2. Validations on each offer let the endpoint prove
/// organization-scope reaches both, team-scope reaches only V1's (O2's validation → 404 IDOR).
/// </summary>
public sealed class StaffValidationFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_staff_validation";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Users. OrgAdmin = hr_admin@organization; TeamLead = leader@team (leads T1); NoGrant = employee.
    public static readonly Guid OrgAdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public const string OrgAdminSub = "sub-val-org-admin";
    public const string TeamLeadSub = "sub-val-team-lead";
    public const string NoGrantSub = "sub-val-no-grant";

    public static readonly Guid OfferInScope = Guid.Parse("0f000000-0000-0000-0000-000000000001");   // O1 → V1 (team T1)
    public static readonly Guid OfferOutOfScope = Guid.Parse("0f000000-0000-0000-0000-000000000002"); // O2 → V2 (team T2)

    // Validations. Mutating tests each own a distinct row; reject tests (404/403/401/400) share a read-only one.
    public static readonly Guid PvOrgAdminO1 = Guid.Parse("11110000-0000-0000-0000-000000000001");
    public static readonly Guid PvOrgAdminO2 = Guid.Parse("11110000-0000-0000-0000-000000000002");
    public static readonly Guid PvTeamLeadO1 = Guid.Parse("11110000-0000-0000-0000-000000000003");
    public static readonly Guid PvDirectCompleting = Guid.Parse("11110000-0000-0000-0000-000000000004");
    public static readonly Guid PvDirectPending = Guid.Parse("11110000-0000-0000-0000-000000000005");
    public static readonly Guid PvDirectPartial = Guid.Parse("11110000-0000-0000-0000-000000000006"); // seeded result {"pre":1}
    public static readonly Guid PvReadOnlyO1 = Guid.Parse("11110000-0000-0000-0000-0000000000a1");    // O1, never mutated
    public static readonly Guid PvIdorO2 = Guid.Parse("11110000-0000-0000-0000-0000000000a2");         // O2, team-lead → 404

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

        foreach (var sql in new[] { IdentitySchemaSql, IdentitySeedSql, ScopeSchemaSql, ScopeSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public StaffValidationDbContext NewWriteContext() =>
        new(new DbContextOptionsBuilder<StaffValidationDbContext>().UseNpgsql(ConnectionString).Options);

    private const string IdentitySchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');
        """;

    // hr_admin@organization + leader@team both grant offer:update; employee has no grant. All valid staff roles.
    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'offer', 'update');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team');

        INSERT INTO users (id, organization_id, supabase_user_id, email, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-val-org-admin', 'admin@tims.test', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-val-team-lead', 'lead@tims.test', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-val-no-grant', 'none@tims.test', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003');
        """;

    // Scope-anchor + validation tables under RLS. teams (leader_id for ledTeamIds), vacancies (team_id →
    // team scope), offers (vacancy_id), preemployment_validations (offer_id + the write columns + XOR check).
    private const string ScopeSchemaSql =
        """
        CREATE TABLE teams (id uuid PRIMARY KEY, organization_id uuid NOT NULL, business_unit_id uuid NULL, leader_id uuid NULL, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, team_id uuid NULL, assigned_to uuid NULL, business_unit_id uuid NULL, created_by uuid NULL, deleted_at timestamp(3) NULL);
        CREATE TABLE offers (id uuid PRIMARY KEY, organization_id uuid NOT NULL, vacancy_id uuid NOT NULL);
        CREATE TABLE preemployment_validations (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            offer_id uuid NOT NULL,
            type text NOT NULL,
            status text NOT NULL DEFAULT 'pending',
            is_blocking boolean NOT NULL DEFAULT true,
            result jsonb NULL,
            completed_by_id uuid NULL,
            completed_by_api_key_id uuid NULL,
            completed_at timestamp(3) NULL,
            notes text NULL,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL,
            CONSTRAINT preemployment_validations_single_completer_chk
                CHECK (completed_by_id IS NULL OR completed_by_api_key_id IS NULL)
        );

        GRANT SELECT ON teams, vacancies, offers TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON preemployment_validations TO app_tenant;

        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;      ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;  ALTER TABLE vacancies FORCE ROW LEVEL SECURITY;
        ALTER TABLE offers ENABLE ROW LEVEL SECURITY;     ALTER TABLE offers FORCE ROW LEVEL SECURITY;
        ALTER TABLE preemployment_validations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE preemployment_validations FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON teams     USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON vacancies USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON offers    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON preemployment_validations
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string ScopeSeedSql =
        """
        INSERT INTO teams (id, organization_id, leader_id, is_active) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', true),  -- T1 led by team-lead
          ('7ea00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', true);  -- T2 led by org-admin

        INSERT INTO vacancies (id, organization_id, team_id, assigned_to, deleted_at) VALUES
          ('7ac00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '7ea00000-0000-0000-0000-000000000001', NULL, NULL),  -- V1 team T1
          ('7ac00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '7ea00000-0000-0000-0000-000000000002', NULL, NULL);  -- V2 team T2

        INSERT INTO offers (id, organization_id, vacancy_id) VALUES
          ('0f000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '7ac00000-0000-0000-0000-000000000001'),  -- O1 → V1
          ('0f000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '7ac00000-0000-0000-0000-000000000002');  -- O2 → V2

        INSERT INTO preemployment_validations (id, organization_id, offer_id, type, status, is_blocking, result, created_at, updated_at) VALUES
          ('11110000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000001', 'background_check', 'pending', true, NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('11110000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000002', 'background_check', 'pending', true, NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('11110000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000001', 'background_check', 'pending', true, NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('11110000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000001', 'background_check', 'pending', true, NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('11110000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000001', 'background_check', 'pending', true, NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('11110000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000001', 'background_check', 'pending', true, '{"pre":1}', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('11110000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000001', 'background_check', 'pending', true, NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('11110000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000002', 'background_check', 'pending', true, NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00');
        """;
}
