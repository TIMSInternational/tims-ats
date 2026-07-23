using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Dei;

namespace Tims.IntegrationTests.Dei;

/// <summary>
/// Phase-5 Slice 11b Testcontainers fixture: one real Postgres carrying the Prisma-OWNED DEI-read tables
/// (<c>employee_demographics</c> — with the THREE NATIVE Prisma enum types <c>"Gender"</c>/<c>"Ethnicity"</c>/
/// <c>"DisabilityStatus"</c> faithful to prod — + <c>users</c>, <c>user_roles</c>, <c>roles</c>, <c>candidates</c>,
/// <c>salary_adjustments</c>, <c>surveys</c>, <c>survey_responses</c>) + the identity/RBAC plane, all under the
/// SAME RLS mechanism as the other read fixtures (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL
/// SECURITY, fail-closed <c>tenant_isolation</c>; <c>user_roles</c> uses the prod EXISTS-roles policy since it has
/// no org column).
///
/// Seed — OrgA (HEALTHY, all distributions clear): 15 demographics in 3 archetype groups of 5
/// (female/mestizo/none/CO/25-34/leader · male/afrodescendiente/has_disability/US/35-44/leader ·
/// non_binary/blanco/undisclosed/MX/45-54/non-leader) so every gender/ethnicity/disability/nationality/age group
/// is exactly 5 (enum-label materialization + clear happy path); 10 leaders (5F/5M); 18 active users (coverage
/// 83.3). OrgB (DIFFERENCING): 11 demographics — gender female=3 (SUB-FLOOR) / male=8, but nationality=CO(11) clear
/// — so gender-representation empties yet nationality stays visible, proving the cross-endpoint differencing guard
/// on real data. Auth: OrgReader=hr_admin(dei:read@organization); TeamReader=leader(dei:read@TEAM → grant-only 200,
/// NO org-gate); NoGrant=employee(no dei grant → 403); OrgBReader=hr_admin@OrgB.
/// </summary>
public sealed class DeiReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_dei_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public const string OrgReaderSub = "sub-dei-org";      // hr_admin @ organization (dei:read)
    public const string TeamReaderSub = "sub-dei-team";    // leader @ team (dei:read@team → grant-only 200)
    public const string NoGrantSub = "sub-dei-none";       // employee, NO dei grant (403)
    public const string OrgBReaderSub = "sub-dei-orgb";    // hr_admin @ OrgB (dei:read)

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    private NpgsqlDataSource? _enumDataSource;
    private NpgsqlDataSource? _plainDataSource;

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        // The SAME enum-mapped data source Program.cs DI uses (native enums read/filter identically here), plus a
        // PLAIN source (NO MapEnum) to prove the enum-materialization bite + the no-bleed property.
        _enumDataSource = DeiReadDataSource.Build(ConnectionString);
        _plainDataSource = new NpgsqlDataSourceBuilder(ConnectionString).Build();

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

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, BuildDemographicsSeed(), StaticSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync()
    {
        if (_enumDataSource is not null)
        {
            await _enumDataSource.DisposeAsync();
        }

        if (_plainDataSource is not null)
        {
            await _plainDataSource.DisposeAsync();
        }

        await _container.DisposeAsync();
    }

    /// <summary>The enum-mapped context (the production path).</summary>
    public DeiReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<DeiReadDbContext>()
            .UseNpgsql(_enumDataSource!, DeiReadDataSource.MapEnums)
            .Options);

    /// <summary>A context on a PLAIN data source with NO MapEnum — reading the native enum columns THROWS (the
    /// enum-materialization bite), while string/date columns still materialize (the no-bleed property).</summary>
    public DeiReadDbContext NewPlainContext() =>
        new(new DbContextOptionsBuilder<DeiReadDbContext>()
            .UseNpgsql(_plainDataSource!)
            .Options);

    private const string SchemaSql =
        """
        CREATE TYPE "Gender" AS ENUM ('female', 'male', 'non_binary', 'undisclosed');
        CREATE TYPE "Ethnicity" AS ENUM ('mestizo', 'afrodescendiente', 'indigena', 'raizal', 'rom', 'palenquero', 'blanco', 'otro', 'undisclosed');
        CREATE TYPE "DisabilityStatus" AS ENUM ('none', 'has_disability', 'undisclosed');

        CREATE TABLE organizations (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL,
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');

        CREATE TABLE employee_demographics (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            user_id uuid NOT NULL UNIQUE,
            gender "Gender" NOT NULL DEFAULT 'undisclosed',
            date_of_birth date NULL,
            nationality text NULL,
            ethnicity "Ethnicity" NOT NULL DEFAULT 'undisclosed',
            disability_status "DisabilityStatus" NOT NULL DEFAULT 'undisclosed',
            self_identified boolean NOT NULL DEFAULT false,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL
        );
        CREATE TABLE candidates (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
            email text NOT NULL, created_at timestamp(3) NOT NULL);
        CREATE TABLE salary_adjustments (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, type text NOT NULL,
            previous_salary double precision NOT NULL, new_salary double precision NOT NULL,
            currency text NOT NULL DEFAULT 'USD', status text NOT NULL DEFAULT 'pending',
            effective_date timestamp(3) NULL, requested_by_id uuid NOT NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE surveys (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, type text NOT NULL,
            status text NOT NULL DEFAULT 'draft', questions jsonb NOT NULL, starts_at timestamp(3) NULL,
            ends_at timestamp(3) NULL, response_count int NOT NULL DEFAULT 0, created_by_id uuid NOT NULL,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE survey_responses (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, survey_id uuid NOT NULL, user_id uuid NULL,
            answers jsonb NOT NULL, submitted_at timestamp(3) NOT NULL);
        """;

    // Org RLS on the tenant tables + roles (org policy); user_roles uses the prod EXISTS-roles policy (it has no
    // organization_id column). The privileged identity/RBAC reads run as postgres (bypass RLS) — same split as the
    // other read fixtures.
    private const string RlsSql =
        """
        GRANT SELECT ON users, roles, user_roles, employee_demographics, candidates, salary_adjustments,
            surveys, survey_responses TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                   ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE roles ENABLE ROW LEVEL SECURITY;                  ALTER TABLE roles FORCE ROW LEVEL SECURITY;
        ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;             ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
        ALTER TABLE employee_demographics ENABLE ROW LEVEL SECURITY;  ALTER TABLE employee_demographics FORCE ROW LEVEL SECURITY;
        ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;             ALTER TABLE candidates FORCE ROW LEVEL SECURITY;
        ALTER TABLE salary_adjustments ENABLE ROW LEVEL SECURITY;     ALTER TABLE salary_adjustments FORCE ROW LEVEL SECURITY;
        ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;               ALTER TABLE surveys FORCE ROW LEVEL SECURITY;
        ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;      ALTER TABLE survey_responses FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users                 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON roles                 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON employee_demographics USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON candidates            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON salary_adjustments    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON surveys               USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON survey_responses      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON user_roles            USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = user_roles.role_id));
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
          ('c0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'HR Admin B');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'dei', 'read');

        -- hr_admin → dei:read@organization; leader → dei:read@TEAM (grant-only, NO org-gate → 200); employee → none.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization');

        -- Authenticating users (OrgReader/TeamReader/NoGrant are OrgA active users → part of totalEmployees; none
        -- carry demographics, so they never pollute the distributions or the leadership metric).
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-dei-org',  'org@t.test',  'Ana',  'Admin',  false, true),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-dei-team', 'team@t.test', 'Tom',  'Team',   false, true),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-dei-none', 'none@t.test', 'Ned',  'None',   false, true),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-dei-orgb', 'orgb@t.test', 'Bob',  'OrgB',   false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1');
        """;

    // Demographic users + demographics + leader user_roles, generated from the archetype groups.
    private static string BuildDemographicsSeed()
    {
        var users = new StringBuilder("INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active) VALUES\n");
        var demos = new StringBuilder("INSERT INTO employee_demographics (id, organization_id, user_id, gender, date_of_birth, nationality, ethnicity, disability_status, self_identified, created_at, updated_at) VALUES\n");
        var leaderRoles = new StringBuilder("INSERT INTO user_roles (id, user_id, role_id) VALUES\n");

        var userRows = new List<string>();
        var demoRows = new List<string>();
        var leaderRows = new List<string>();
        var leaderRoleId = "c0000000-0000-0000-0000-000000000002"; // OrgA 'leader'

        void Add(int idx, Guid org, string gender, string ethnicity, string disability, string nationality, string dob, bool leader)
        {
            var userId = $"d0000000-0000-0000-0000-{idx:D12}";
            userRows.Add($"('{userId}', '{org}', 'sub-dei-emp-{idx}', 'emp{idx}@t.test', 'Emp', '{idx}', false, true)");
            demoRows.Add($"('f0000000-0000-0000-0000-{idx:D12}', '{org}', '{userId}', '{gender}', '{dob}', '{nationality}', '{ethnicity}', '{disability}', true, '2026-01-01 00:00:00', '2026-01-01 00:00:00')");
            if (leader)
            {
                leaderRows.Add($"('e1000000-0000-0000-0000-{idx:D12}', '{userId}', '{leaderRoleId}')");
            }
        }

        // OrgA: 3 archetype groups of 5 → every group exactly 5 (all clear). Groups 1+2 (female/male) are leaders.
        var i = 1;
        for (var k = 0; k < 5; k++, i++) Add(i, OrgA, "female", "mestizo", "none", "CO", "1996-03-15", true);
        for (var k = 0; k < 5; k++, i++) Add(i, OrgA, "male", "afrodescendiente", "has_disability", "US", "1986-03-15", true);
        for (var k = 0; k < 5; k++, i++) Add(i, OrgA, "non_binary", "blanco", "undisclosed", "MX", "1976-03-15", false);

        // OrgB: female=3 (SUB-FLOOR) / male=8, all mestizo/none/CO/35-44, NO leaders → gender empties but
        // nationality (CO×11) stays visible (the differencing bite on real data).
        i = 101;
        for (var k = 0; k < 3; k++, i++) Add(i, OrgB, "female", "mestizo", "none", "CO", "1986-03-15", false);
        for (var k = 0; k < 8; k++, i++) Add(i, OrgB, "male", "mestizo", "none", "CO", "1986-03-15", false);

        users.Append(string.Join(",\n", userRows)).Append(";\n");
        demos.Append(string.Join(",\n", demoRows)).Append(";\n");
        var sql = users.ToString() + demos.ToString();
        if (leaderRows.Count > 0)
        {
            leaderRoles.Append(string.Join(",\n", leaderRows)).Append(";\n");
            sql += leaderRoles.ToString();
        }

        return sql;
    }

    // Candidates (hiring funnel), promotions (promotion equity), and the two climate surveys (inclusion index).
    private const string StaticSeedSql =
        """
        -- OrgA candidates: 3 in Jan, 4 in Jun (a dateFrom=2026-05-01 window → 4; no filter → 7).
        INSERT INTO candidates (id, organization_id, first_name, last_name, email, created_at) VALUES
          ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'C', '1', 'c1@t.test', '2026-01-10 00:00:00'),
          ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'C', '2', 'c2@t.test', '2026-01-11 00:00:00'),
          ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'C', '3', 'c3@t.test', '2026-01-12 00:00:00'),
          ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'C', '4', 'c4@t.test', '2026-06-10 00:00:00'),
          ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'C', '5', 'c5@t.test', '2026-06-11 00:00:00'),
          ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'C', '6', 'c6@t.test', '2026-06-12 00:00:00'),
          ('ca000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'C', '7', 'c7@t.test', '2026-06-13 00:00:00'),
          ('ca000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'C', 'B', 'cb@t.test', '2026-06-13 00:00:00');

        -- OrgA promotions: 6 in 2026 (→ 6, clear), 3 in 2025 (→ suppressed), 2 non-promotion in 2026 (type filter).
        INSERT INTO salary_adjustments (id, organization_id, user_id, type, previous_salary, new_salary, currency, status, effective_date, requested_by_id, created_at, updated_at)
        SELECT ('5a000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
               'a0000000-0000-0000-0000-000000000001', 'promotion', 100, 110, 'USD', 'approved',
               '2026-03-01 00:00:00', 'a0000000-0000-0000-0000-000000000001', '2026-03-01 00:00:00', '2026-03-01 00:00:00'
        FROM generate_series(1, 6) g;
        INSERT INTO salary_adjustments (id, organization_id, user_id, type, previous_salary, new_salary, currency, status, effective_date, requested_by_id, created_at, updated_at)
        SELECT ('5a000000-0000-0000-0000-' || lpad((100 + g)::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
               'a0000000-0000-0000-0000-000000000001', 'promotion', 100, 110, 'USD', 'approved',
               '2025-03-01 00:00:00', 'a0000000-0000-0000-0000-000000000001', '2025-03-01 00:00:00', '2025-03-01 00:00:00'
        FROM generate_series(1, 3) g;
        INSERT INTO salary_adjustments (id, organization_id, user_id, type, previous_salary, new_salary, currency, status, effective_date, requested_by_id, created_at, updated_at)
        SELECT ('5a000000-0000-0000-0000-' || lpad((200 + g)::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
               'a0000000-0000-0000-0000-000000000001', 'merit', 100, 110, 'USD', 'approved',
               '2026-04-01 00:00:00', 'a0000000-0000-0000-0000-000000000001', '2026-04-01 00:00:00', '2026-04-01 00:00:00'
        FROM generate_series(1, 2) g;
        -- OrgB: 2 promotions in 2026 (→ suppressed, cross-org isolation from OrgA's 6).
        INSERT INTO salary_adjustments (id, organization_id, user_id, type, previous_salary, new_salary, currency, status, effective_date, requested_by_id, created_at, updated_at)
        SELECT ('5b000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '22222222-2222-2222-2222-222222222222',
               'a0000000-0000-0000-0000-0000000000b1', 'promotion', 100, 110, 'USD', 'approved',
               '2026-03-01 00:00:00', 'a0000000-0000-0000-0000-0000000000b1', '2026-03-01 00:00:00', '2026-03-01 00:00:00'
        FROM generate_series(1, 2) g;

        -- OrgA climate survey: 2 inclusion questions, 6 responses all answering q1=4/q2=4 → index 4, clear.
        INSERT INTO surveys (id, organization_id, title, type, status, questions, starts_at, ends_at, response_count, created_by_id, created_at, updated_at) VALUES
          ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Clima A', 'climate', 'active',
           '[{"text":"q1","category":"inclusion"},{"text":"q2","category":"inclusion"}]', NULL, NULL, 6,
           'a0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('50000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'Clima B', 'climate', 'active',
           '[{"text":"q1","category":"inclusion"}]', NULL, NULL, 3,
           'a0000000-0000-0000-0000-0000000000b1', '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        INSERT INTO survey_responses (id, organization_id, survey_id, user_id, answers, submitted_at)
        SELECT ('51000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
               '50000000-0000-0000-0000-000000000001', NULL, '{"q1":4,"q2":4}', '2026-05-02 00:00:00'
        FROM generate_series(1, 6) g;
        -- OrgB climate survey: 3 responses → survey-level suppressed.
        INSERT INTO survey_responses (id, organization_id, survey_id, user_id, answers, submitted_at)
        SELECT ('5b100000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '22222222-2222-2222-2222-222222222222',
               '50000000-0000-0000-0000-0000000000b0', NULL, '{"q1":4}', '2026-05-02 00:00:00'
        FROM generate_series(1, 3) g;
        """;
}
