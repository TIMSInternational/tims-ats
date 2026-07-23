using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.Compensation;

namespace Tims.IntegrationTests.Compensation;

/// <summary>
/// Phase-5 Slice 12 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED compensation WRITE
/// tables (<c>salary_adjustments</c> + <c>employee_compensations</c>) + the anchor plane
/// (<c>teams</c>/<c>user_teams</c>/<c>user_business_units</c>/<c>business_units</c>) + the identity/RBAC plane +
/// append-only <c>data_access_logs</c>, all under the SAME RLS mechanism as the read fixtures
/// (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c>). app_tenant additionally holds INSERT/UPDATE on the two write tables.
///
/// <c>employee_compensations.current_salary</c> carries a <c>CHECK (current_salary &gt;= 0)</c> — a plausible
/// domain constraint used ONLY to force a REAL DB fault on the SECOND write of an approve, so the atomicity bite
/// (INV-2) can prove the status transition rolls back. <c>ADJ_RN</c> is a pending adjustment seeded directly with
/// a NEGATIVE new_salary (bypassing the endpoint's positive-only validation) to trip it.
///
/// Scope seed (OrgA): TeamLead leads T1 (members M1/M2) → teamMemberIds = {M1, M2}. OrgHr = compensation
/// create+approve @ organization; TeamLead = create+approve @ team; NoGrant = no compensation grant. Dedicated
/// repo-test users RA/RR/RT/RN/RF/RC each own ONE comp row + ONE adjustment so approve mutations never couple.
/// WC has a EUR comp row (currency-fallback subject); OrgHr has NO comp row (USD fallback). OrgB is a distinct
/// org (cross-org RLS isolation).
/// </summary>
public sealed class CompensationWriteFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_compensation_write";
    private const string MissingAuditDatabase = "tims_comp_write_noaudit";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Staff principals
    public static readonly Guid OrgHrId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid EmpId = Guid.Parse("c0000000-0000-0000-0000-000000000003");
    public static readonly Guid NoGrantId = Guid.Parse("c0000000-0000-0000-0000-000000000005");
    public static readonly Guid M1Id = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // in TeamLead scope
    public static readonly Guid M2Id = Guid.Parse("d0000000-0000-0000-0000-000000000002"); // in TeamLead scope

    // Dedicated comp-owning targets (repo tests) — each with ONE adjustment, decoupled.
    public static readonly Guid WcId = Guid.Parse("e0000000-0000-0000-0000-000000000001"); // EUR comp (fallback subject)
    public static readonly Guid RaId = Guid.Parse("e0000000-0000-0000-0000-00000000000a"); // approve-applied
    public static readonly Guid RrId = Guid.Parse("e0000000-0000-0000-0000-00000000000b"); // reject
    public static readonly Guid RtId = Guid.Parse("e0000000-0000-0000-0000-00000000000c"); // toctou
    public static readonly Guid RnId = Guid.Parse("e0000000-0000-0000-0000-00000000000d"); // atomicity (negative)
    public static readonly Guid RfId = Guid.Parse("e0000000-0000-0000-0000-00000000000e"); // fail-closed audit
    public static readonly Guid RcId = Guid.Parse("e0000000-0000-0000-0000-00000000000f"); // conflict (non-pending)
    public static readonly Guid OrgBHrId = Guid.Parse("c0000000-0000-0000-0000-0000000000b0");
    public static readonly Guid Mb1Id = Guid.Parse("d0000000-0000-0000-0000-0000000000b1");

    // Adjustments
    public static readonly Guid AdjApprove = Guid.Parse("5ad00000-0000-0000-0000-000000000001"); // M1 pending (endpoint org approve; probe in-scope)
    public static readonly Guid AdjRejectEp = Guid.Parse("5ad00000-0000-0000-0000-000000000002"); // M2 pending (endpoint leader reject)
    public static readonly Guid AdjAlready = Guid.Parse("5ad00000-0000-0000-0000-000000000003"); // M1 approved (already-processed)
    public static readonly Guid AdjOutScope = Guid.Parse("5ad00000-0000-0000-0000-000000000004"); // Emp pending (leader probe 404)
    public static readonly Guid AdjRa = Guid.Parse("5ad00000-0000-0000-0000-00000000000a"); // RA pending new 45000
    public static readonly Guid AdjRr = Guid.Parse("5ad00000-0000-0000-0000-00000000000b"); // RR pending new 99999
    public static readonly Guid AdjRt = Guid.Parse("5ad00000-0000-0000-0000-00000000000c"); // RT pending new 47000
    public static readonly Guid AdjRn = Guid.Parse("5ad00000-0000-0000-0000-00000000000d"); // RN pending new -100
    public static readonly Guid AdjRf = Guid.Parse("5ad00000-0000-0000-0000-00000000000e"); // RF pending new 48000
    public static readonly Guid AdjRc = Guid.Parse("5ad00000-0000-0000-0000-00000000000f"); // RC approved (conflict)
    public static readonly Guid AdjOrgB = Guid.Parse("5ad00000-0000-0000-0000-0000000000b0"); // OrgB pending (cross-org)

    public const string OrgHrSub = "sub-cw-org";
    public const string TeamLeadSub = "sub-cw-lead";
    public const string NoGrantSub = "sub-cw-none";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    /// <summary>A second DB on the same server WITHOUT data_access_logs — a fail-closed audit write here throws.</summary>
    public string MissingAuditConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        MissingAuditConnectionString =
            new NpgsqlConnectionStringBuilder(ConnectionString) { Database = MissingAuditDatabase }.ConnectionString;

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

        await using (var db2 = connection.CreateCommand())
        {
            db2.CommandText = $"CREATE DATABASE {MissingAuditDatabase}";
            await db2.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public CompensationWriteDbContext NewWriteContext() =>
        new(new DbContextOptionsBuilder<CompensationWriteDbContext>().UseNpgsql(ConnectionString).Options);

    public DataAccessAuditDbContext NewAuditContext(string? connectionString = null) =>
        new(new DbContextOptionsBuilder<DataAccessAuditDbContext>()
            .UseNpgsql(connectionString ?? ConnectionString).Options);

    public async Task<NpgsqlConnection> OpenSuperuserConnectionAsync()
    {
        var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    /// <summary>The adjustment's status as superuser (bypasses RLS) — null if absent.</summary>
    public async Task<string?> GetAdjustmentStatusAsync(Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT status FROM salary_adjustments WHERE id = @id";
        command.Parameters.AddWithValue("id", id);
        return (string?)await command.ExecuteScalarAsync();
    }

    /// <summary>The adjustment's approved_by_id as superuser — null if unset/absent.</summary>
    public async Task<Guid?> GetAdjustmentApproverAsync(Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT approved_by_id FROM salary_adjustments WHERE id = @id";
        command.Parameters.AddWithValue("id", id);
        var result = await command.ExecuteScalarAsync();
        return result is Guid g ? g : null;
    }

    /// <summary>(current_salary, currency) for a user's comp row as superuser — null if absent.</summary>
    public async Task<(double Salary, string Currency)?> GetCompAsync(Guid userId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT current_salary, currency FROM employee_compensations WHERE user_id = @uid";
        command.Parameters.AddWithValue("uid", userId);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? (reader.GetDouble(0), reader.GetString(1)) : null;
    }

    /// <summary>Count of salaryAdjustment/update audit rows for a record (superuser).</summary>
    public async Task<int> CountUpdateAuditRowsAsync(Guid recordId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT COUNT(*)::int FROM data_access_logs WHERE record_id = @rid AND data_type = 'salaryAdjustment' AND action = 'update'";
        command.Parameters.AddWithValue("rid", recordId);
        return (int)(await command.ExecuteScalarAsync())!;
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

        -- CHECK (current_salary >= 0): forces a REAL DB fault on the approve's SECOND write for the atomicity bite.
        CREATE TABLE employee_compensations (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
            current_salary double precision NOT NULL CHECK (current_salary >= 0),
            currency text NOT NULL DEFAULT 'USD',
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE salary_adjustments (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, type text NOT NULL,
            previous_salary double precision NOT NULL, new_salary double precision NOT NULL,
            currency text NOT NULL DEFAULT 'USD', reason text NULL, status text NOT NULL DEFAULT 'pending',
            approved_by_id uuid NULL, effective_date timestamp(3) NULL, requested_by_id uuid NOT NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE data_access_logs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, actor_id uuid NOT NULL,
            data_type text NOT NULL, record_id uuid NOT NULL, action text NOT NULL, ip_address text NULL,
            user_agent text NULL, created_at timestamptz NOT NULL DEFAULT now());
        """;

    private const string RlsSql =
        """
        GRANT SELECT ON users, teams, user_teams, user_business_units, business_units TO app_tenant;
        GRANT SELECT, INSERT, UPDATE ON salary_adjustments, employee_compensations TO app_tenant;
        GRANT SELECT, INSERT ON data_access_logs TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                   ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;                   ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY;              ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;     ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;          ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        ALTER TABLE employee_compensations ENABLE ROW LEVEL SECURITY;  ALTER TABLE employee_compensations FORCE ROW LEVEL SECURITY;
        ALTER TABLE salary_adjustments ENABLE ROW LEVEL SECURITY;      ALTER TABLE salary_adjustments FORCE ROW LEVEL SECURITY;
        ALTER TABLE data_access_logs ENABLE ROW LEVEL SECURITY;        ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

        -- USING also gates INSERT/UPDATE (WITH CHECK defaults to USING) for the two write tables.
        CREATE POLICY tenant_isolation ON users                  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON teams                  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_business_units    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON business_units         USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON employee_compensations USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON salary_adjustments     USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
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
          ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'norole', 'No Grant'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'OrgB HR');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'compensation', 'create'),
          ('b0000000-0000-0000-0000-000000000002', 'compensation', 'approve');

        -- hr_admin @ organization (create+approve); leader @ team (create+approve, narrow scope for the probe /
        -- subject-scope bites); norole has NO compensation grant (403). OrgB hr_admin for cross-org.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'team'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-cw-org',  'org@tims.test',  'Ana',  'Admin', NULL, 'HR Director', NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-cw-lead', 'lead@tims.test', 'Tara', 'Team',  NULL, 'Lead',        NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-cw-emp',  'emp@tims.test',  'Eli',  'Emp',   NULL, 'Analyst',     NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-cw-none', 'none@tims.test', 'Ned',  'None',  NULL, 'HRBP',        NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-cw-m1',   'm1@tims.test',   'Mia',  'One',   NULL, 'Engineer',    NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-cw-m2',   'm2@tims.test',   'Max',  'Two',   NULL, 'PM',          NULL, '2024-01-01 00:00:00', false, true),
          ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-cw-wc',   'wc@tims.test',   'Wca',  'Cur',   NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('e0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'sub-cw-ra',   'ra@tims.test',   'Ra',   'A',     NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('e0000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'sub-cw-rr',   'rr@tims.test',   'Rr',   'R',     NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('e0000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'sub-cw-rt',   'rt@tims.test',   'Rt',   'T',     NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('e0000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'sub-cw-rn',   'rn@tims.test',   'Rn',   'N',     NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('e0000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'sub-cw-rf',   'rf@tims.test',   'Rf',   'F',     NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('e0000000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', 'sub-cw-rc',   'rc@tims.test',   'Rc',   'C',     NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-cw-orgb', 'orgb@tims.test', 'Bob',  'OrgB',  NULL, 'HR',          NULL, '2024-01-01 00:00:00', false, true),
          ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-cw-mb1',  'mb1@tims.test',  'Bea',  'B1',    NULL, 'Eng',         NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('f0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005'),
          ('f0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');
        """;

    private const string CompensationSeedSql =
        """
        INSERT INTO business_units (id, organization_id, company_id, name, is_active) VALUES
          ('b0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0c00000-0000-0000-0000-000000000001', 'Unit One', true);

        -- TeamLead leads T1; members M1/M2 → teamMemberIds = {M1, M2}. Emp is NOT a member.
        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
          ('7ea00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0b00000-0000-0000-0000-000000000001', 'Alpha Team', 'c0000000-0000-0000-0000-000000000002', '{}', true, '2026-01-01 00:00:00', '2026-01-02 00:00:00');

        INSERT INTO user_teams (id, user_id, team_id, role, joined_at) VALUES
          ('11100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-01 00:00:00'),
          ('11100000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001', 'member', '2026-06-02 00:00:00');

        -- Comp rows (OrgA). OrgHr has NO comp row (USD fallback). WC is EUR (currency-fallback subject).
        INSERT INTO employee_compensations (id, organization_id, user_id, current_salary, currency, created_at, updated_at) VALUES
          ('9c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 80000, 'USD', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 90000, 'USD', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 60000, 'EUR', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000a', 40000, 'USD', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000b', 41000, 'USD', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000c', 42000, 'USD', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000d', 43000, 'USD', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000e', 44000, 'USD', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
          ('9c000000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000f', 45000, 'USD', '2026-01-01 00:00:00', '2026-01-01 00:00:00');

        -- Adjustments. ADJ_RN carries a NEGATIVE new_salary (seeded directly, bypassing input validation) to trip
        -- the employee_compensations CHECK on the approve's SECOND write (atomicity bite). requestedBy = OrgHr.
        INSERT INTO salary_adjustments (id, organization_id, user_id, type, previous_salary, new_salary, currency, reason, status, approved_by_id, effective_date, requested_by_id, created_at, updated_at) VALUES
          ('5ad00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'merit',     80000, 90000, 'USD', 'strong performer', 'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-02-03 00:00:00', '2026-02-03 00:00:00'),
          ('5ad00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 'market',    90000, 95000, 'USD', 'market adj',       'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-02-02 00:00:00', '2026-02-02 00:00:00'),
          ('5ad00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'merit',     80000, 85000, 'USD', 'prior',            'approved', 'c0000000-0000-0000-0000-000000000001', '2026-01-15 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-01-15 00:00:00', '2026-01-15 00:00:00'),
          ('5ad00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003', 'promotion', 60000, 70000, 'USD', 'promo',            'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-02-04 00:00:00', '2026-02-04 00:00:00'),
          ('5ad00000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000a', 'merit',     40000, 45000, 'USD', 'ra',               'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-02-05 00:00:00', '2026-02-05 00:00:00'),
          ('5ad00000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000b', 'market',    41000, 99999, 'USD', 'rr',               'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-02-06 00:00:00', '2026-02-06 00:00:00'),
          ('5ad00000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000c', 'merit',     42000, 47000, 'USD', 'rt',               'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-02-07 00:00:00', '2026-02-07 00:00:00'),
          ('5ad00000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000d', 'merit',     43000,  -100, 'USD', 'rn-negative',      'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-02-08 00:00:00', '2026-02-08 00:00:00'),
          ('5ad00000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000e', 'merit',     44000, 48000, 'USD', 'rf',               'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-02-09 00:00:00', '2026-02-09 00:00:00'),
          ('5ad00000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000f', 'merit',     45000, 50000, 'USD', 'rc',               'approved', 'c0000000-0000-0000-0000-000000000001', '2026-01-20 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-01-20 00:00:00', '2026-01-20 00:00:00'),
          ('5ad00000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b1', 'merit',     50000, 55000, 'USD', 'orgb',             'pending',  NULL, '2026-03-01 00:00:00', 'c0000000-0000-0000-0000-0000000000b0', '2026-02-10 00:00:00', '2026-02-10 00:00:00');
        """;
}
