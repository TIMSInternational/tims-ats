using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Evaluation360;

namespace Tims.IntegrationTests.Evaluation360;

/// <summary>
/// Phase-5 Slice 13 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED evaluation360 tables
/// (<c>review_cycles</c>, <c>rater_assignments</c>, <c>rater_responses</c>) with the NATIVE Prisma enum types and the
/// real UNIQUE constraints ([cycle_id, subject_user_id, rater_user_id] on assignments — needed for the assignRaters
/// ON CONFLICT DO NOTHING; [assignment_id, competency_key] on responses), under the SAME RLS mechanism as the read
/// fixtures (NOLOGIN/NOBYPASSRLS <c>app_tenant</c> with SELECT/INSERT/UPDATE on the three tables, ENABLE + FORCE ROW
/// LEVEL SECURITY, fail-closed <c>tenant_isolation</c> whose USING also gates INSERT/UPDATE) + the identity/RBAC plane
/// (privileged, no RLS).
///
/// The seed proves the state machine (a cycle in EVERY state, plus dedicated cycles per mutating test so the suite is
/// order-independent), assignRaters (draft/open allowed; closed → cycleNotOpen; a pre-existing assignment for the
/// skipDuplicates count), and — the load-bearing invariant — submitRatings IDENTITY-anchoring: RaterA and RaterB are
/// in the SAME org (OrgA), so RLS passes both rows for any caller; the ONLY thing separating them is the
/// <c>rater_user_id</c> HARD-FILTER, so an org-admin (organization scope) can NEVER claim/submit on RaterA's
/// assignment (→ false/NOT_FOUND). RaterA holds the <c>employee</c> role (NO evaluation360 grant) — proving the
/// self-service submit works on identity alone while the STAFF writes reject the same user (403).
/// </summary>
public sealed class Evaluation360WriteFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_evaluation360_write";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Staff / rater principals (OrgA).
    public static readonly Guid OrgAdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid TeamLeadId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid RaterAId = Guid.Parse("c0000000-0000-0000-0000-0000000000a1");
    public static readonly Guid RaterBId = Guid.Parse("c0000000-0000-0000-0000-0000000000b1");
    public static readonly Guid Subject1 = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid Subject2 = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    public static readonly Guid OrgBUserId = Guid.Parse("d0000000-0000-0000-0000-0000000000b9");
    public static readonly Guid MissingUserId = Guid.Parse("d0000000-0000-0000-0000-0000000000ff"); // never seeded

    public const string OrgAdminSub = "sub-e360w-org-admin"; // hr_admin @ organization
    public const string TeamLeadSub = "sub-e360w-team-lead"; // leader @ team (narrow → 403 org-gate)
    public const string RaterASub = "sub-e360w-rater-a";     // employee, NO eval grant (403 staff / 200 self-service)
    public const string RaterBSub = "sub-e360w-rater-b";     // employee, NO eval grant

    // Cycles — one dedicated per MUTATING test (order-independent). Repo-test cycles.
    public static readonly Guid CycleOpenOk = Guid.Parse("7c000000-0000-0000-0000-000000000001");        // draft → open
    public static readonly Guid CycleOpenConflict = Guid.Parse("7c000000-0000-0000-0000-000000000002");  // open (open→409)
    public static readonly Guid CycleCloseOk = Guid.Parse("7c000000-0000-0000-0000-000000000003");       // open → closed
    public static readonly Guid CycleCloseConflict = Guid.Parse("7c000000-0000-0000-0000-000000000004"); // draft (close→409)
    public static readonly Guid CyclePublishOk = Guid.Parse("7c000000-0000-0000-0000-000000000005");     // closed → published
    public static readonly Guid CyclePublishConflict = Guid.Parse("7c000000-0000-0000-0000-000000000006"); // open (publish→409)
    public static readonly Guid CycleAssignOpen = Guid.Parse("7c000000-0000-0000-0000-000000000007");    // open (assign ok)
    public static readonly Guid CycleAssignDraft = Guid.Parse("7c000000-0000-0000-0000-000000000008");   // draft (assign ok)
    public static readonly Guid CycleAssignClosed = Guid.Parse("7c000000-0000-0000-0000-000000000009");  // closed (assign→cycleNotOpen)
    public static readonly Guid CycleAssignMissing = Guid.Parse("7c000000-0000-0000-0000-00000000000a"); // open (missing user)
    public static readonly Guid CycleAssignDup = Guid.Parse("7c000000-0000-0000-0000-00000000000b");     // open (skipDuplicates)
    public static readonly Guid CycleSubmit = Guid.Parse("7c000000-0000-0000-0000-00000000000c");        // open (submit + forge)
    public static readonly Guid CycleClaimIdem = Guid.Parse("7c000000-0000-0000-0000-00000000000d");     // open (claim-idempotency)
    public static readonly Guid CycleSubmitClosed = Guid.Parse("7c000000-0000-0000-0000-00000000000e");  // closed (submit→409)
    public static readonly Guid CycleOrgB = Guid.Parse("7c000000-0000-0000-0000-0000000000bb");          // OrgB open (cross-org)

    // Endpoint-test cycles.
    public static readonly Guid CycleEpOpen = Guid.Parse("7c000000-0000-0000-0000-0000000000e1");   // draft (HTTP open)
    public static readonly Guid CycleEpAssign = Guid.Parse("7c000000-0000-0000-0000-0000000000e2"); // open (HTTP assign)
    public static readonly Guid CycleEpSubmit = Guid.Parse("7c000000-0000-0000-0000-0000000000e3"); // open (HTTP submit + forge)

    // Assignments.
    public static readonly Guid AssignDupExisting = Guid.Parse("a5510000-0000-0000-0000-0000000000b0"); // CycleAssignDup, S1×RaterA
    public static readonly Guid AssignForgeTarget = Guid.Parse("a5510000-0000-0000-0000-0000000000c1"); // CycleSubmit, S1×RaterA
    public static readonly Guid AssignSubmitOk = Guid.Parse("a5510000-0000-0000-0000-0000000000c2");    // CycleSubmit, S2×RaterA
    public static readonly Guid AssignClaimIdem = Guid.Parse("a5510000-0000-0000-0000-0000000000d1");   // CycleClaimIdem, S1×RaterA
    public static readonly Guid AssignClosedPending = Guid.Parse("a5510000-0000-0000-0000-0000000000e1"); // CycleSubmitClosed, S1×RaterA
    public static readonly Guid AssignEpSubmit = Guid.Parse("a5510000-0000-0000-0000-0000000000f1");    // CycleEpSubmit, S1×RaterA (HTTP success)
    public static readonly Guid AssignEpForge = Guid.Parse("a5510000-0000-0000-0000-0000000000f2");     // CycleEpSubmit, S2×RaterA (HTTP forge target)

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    private NpgsqlDataSource? _dataSource;

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        // The SAME enum-mapped data source the Program.cs DI uses for the write context.
        _dataSource = Evaluation360ReadDataSource.Build(ConnectionString);

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

        foreach (var sql in new[] { IdentitySchemaSql, Eval360SchemaSql, RlsSql, IdentitySeedSql, Eval360SeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync()
    {
        if (_dataSource is not null)
        {
            await _dataSource.DisposeAsync();
        }

        await _container.DisposeAsync();
    }

    public Evaluation360WriteDbContext NewWriteContext() =>
        new(new DbContextOptionsBuilder<Evaluation360WriteDbContext>()
            .UseNpgsql(_dataSource!, Evaluation360ReadDataSource.MapEnums)
            .Options);

    public async Task<NpgsqlConnection> OpenSuperuserConnectionAsync()
    {
        var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    /// <summary>The cycle's status as superuser (bypasses RLS) — null if absent.</summary>
    public async Task<string?> GetCycleStatusAsync(Guid cycleId) => await ScalarAsync<string>(
        "SELECT status::text FROM review_cycles WHERE id = @id", cycleId);

    /// <summary>The assignment's status as superuser — null if absent.</summary>
    public async Task<string?> GetAssignmentStatusAsync(Guid assignmentId) => await ScalarAsync<string>(
        "SELECT status::text FROM rater_assignments WHERE id = @id", assignmentId);

    /// <summary>Count of rater_assignments in a cycle (superuser).</summary>
    public async Task<int> CountAssignmentsAsync(Guid cycleId) => await CountAsync(
        "SELECT COUNT(*)::int FROM rater_assignments WHERE cycle_id = @id", cycleId);

    /// <summary>Count of rater_responses for an assignment (superuser).</summary>
    public async Task<int> CountResponsesAsync(Guid assignmentId) => await CountAsync(
        "SELECT COUNT(*)::int FROM rater_responses WHERE assignment_id = @id", assignmentId);

    private async Task<T?> ScalarAsync<T>(string sql, Guid id) where T : class
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        return (T?)await command.ExecuteScalarAsync();
    }

    private async Task<int> CountAsync(string sql, Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    // Identity/RBAC plane (privileged, no RLS): principal resolution + grant checks run as `postgres`. The one `users`
    // table serves BOTH this (supabase_user_id/is_platform_owner/is_active) AND the tenant reads (organization_id for
    // the assignRaters membership validation).
    private const string IdentitySchemaSql =
        """
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
        """;

    // Native Prisma enum types + the three eval tables (faithful to prod, incl. the two unique constraints).
    private const string Eval360SchemaSql =
        """
        CREATE TYPE "ReviewCycleStatus" AS ENUM ('draft', 'open', 'closed', 'published');
        CREATE TYPE "RaterRelationship" AS ENUM ('self', 'manager', 'peer', 'direct_report');
        CREATE TYPE "RaterAssignmentStatus" AS ENUM ('pending', 'submitted');

        CREATE TABLE review_cycles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            name text NOT NULL,
            status "ReviewCycleStatus" NOT NULL DEFAULT 'draft',
            opens_at timestamp(3) NULL,
            closes_at timestamp(3) NULL,
            published_at timestamp(3) NULL,
            created_by_id uuid NOT NULL,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL
        );
        CREATE TABLE rater_assignments (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            cycle_id uuid NOT NULL REFERENCES review_cycles (id),
            subject_user_id uuid NOT NULL,
            rater_user_id uuid NOT NULL,
            relationship "RaterRelationship" NOT NULL,
            status "RaterAssignmentStatus" NOT NULL DEFAULT 'pending',
            submitted_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL,
            UNIQUE (cycle_id, subject_user_id, rater_user_id)
        );
        CREATE TABLE rater_responses (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            assignment_id uuid NOT NULL REFERENCES rater_assignments (id),
            competency_key text NOT NULL,
            rating integer NOT NULL,
            comment varchar(5000) NULL,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL,
            UNIQUE (assignment_id, competency_key)
        );
        """;

    // Org-scoped RLS. app_tenant gets SELECT on users (membership validation) + SELECT/INSERT/UPDATE on the three
    // write tables. The USING predicate ALSO gates INSERT/UPDATE (WITH CHECK defaults to USING).
    private const string RlsSql =
        """
        GRANT SELECT ON users TO app_tenant;
        GRANT SELECT, INSERT, UPDATE ON review_cycles, rater_assignments, rater_responses TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;              ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;      ALTER TABLE review_cycles FORCE ROW LEVEL SECURITY;
        ALTER TABLE rater_assignments ENABLE ROW LEVEL SECURITY;  ALTER TABLE rater_assignments FORCE ROW LEVEL SECURITY;
        ALTER TABLE rater_responses ENABLE ROW LEVEL SECURITY;    ALTER TABLE rater_responses FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users             USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON review_cycles     USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON rater_assignments USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON rater_responses   USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        -- hr_admin@organization (create+update pass org-gate); leader@team is narrow (→ 403, Codex F3); employee has
        -- NO evaluation360 grant. OrgB hr_admin for cross-org resolution.
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'OrgB HR');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'evaluation360', 'create'),
          ('b0000000-0000-0000-0000-000000000002', 'evaluation360', 'update');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'team'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization');
        -- NOTE: 'employee' (RaterA/RaterB) intentionally has NO evaluation360 grant.

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-e360w-org-admin', 'admin@tims.test',  'Ana',   'Admin',    false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-e360w-team-lead', 'lead@tims.test',   'Tara',  'Lead',     false, true),
          ('c0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'sub-e360w-rater-a',   'a@tims.test',      'Alex',  'RaterA',   false, true),
          ('c0000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'sub-e360w-rater-b',   'b@tims.test',      'Bella', 'RaterB',   false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-e360w-subject-1', 's1@tims.test',     'Sam',   'Subject',  false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-e360w-subject-2', 's2@tims.test',     'Sue',   'Subject2', false, true),
          ('d0000000-0000-0000-0000-0000000000b9', '22222222-2222-2222-2222-222222222222', 'sub-e360w-orgb-user', 'ub@tims.test',     'Ugo',   'OrgB',     false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000003');
        """;

    // Cycles in every state + dedicated per-mutating-test cycles; pending assignments for the submit/forge bites.
    // created_by_id = org-admin (OrgB cycle = the OrgB user). All timestamps fixed.
    private const string Eval360SeedSql =
        """
        INSERT INTO review_cycles (id, organization_id, name, status, opens_at, closes_at, published_at, created_by_id, created_at, updated_at) VALUES
          ('7c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Open OK (draft)',       'draft',     NULL,                  NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Open Conflict (open)',  'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Close OK (open)',       'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Close Conflict (draft)','draft',     NULL,                  NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Publish OK (closed)',   'closed',    '2026-06-01 00:00:00', '2026-06-02 00:00:00', NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Publish Conf (open)',   'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Assign Open',           'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Assign Draft',          'draft',     NULL,                  NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Assign Closed',         'closed',    '2026-06-01 00:00:00', '2026-06-02 00:00:00', NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Assign Missing',        'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Assign Dup',            'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Submit',                'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Claim Idem',            'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'Submit Closed',         'closed',    '2026-06-01 00:00:00', '2026-06-02 00:00:00', NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'Ep Open (draft)',       'draft',     NULL,                  NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'Ep Assign (open)',      'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111', 'Ep Submit (open)',      'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-0000000000bb', '22222222-2222-2222-2222-222222222222', 'OrgB Open',             'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'd0000000-0000-0000-0000-0000000000b9', '2026-06-01 00:00:00', '2026-06-01 00:00:00');

        -- Pending assignments (RaterA). AssignForgeTarget + AssignSubmitOk share the Submit cycle (distinct subjects);
        -- AssignEpForge + AssignEpSubmit share the Ep Submit cycle. All pending, so a claim is possible.
        INSERT INTO rater_assignments (id, organization_id, cycle_id, subject_user_id, rater_user_id, relationship, status, submitted_at, created_at, updated_at) VALUES
          ('a5510000-0000-0000-0000-0000000000b0', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'peer', 'pending', NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'peer', 'pending', NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'peer', 'pending', NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'peer', 'pending', NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000e', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'peer', 'pending', NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-0000000000e3', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'peer', 'pending', NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-0000000000e3', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'peer', 'pending', NULL, '2026-06-01 00:00:00', '2026-06-01 00:00:00');
        """;
}
