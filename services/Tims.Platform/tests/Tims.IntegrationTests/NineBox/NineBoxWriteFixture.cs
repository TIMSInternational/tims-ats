using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.NineBox;

namespace Tims.IntegrationTests.NineBox;

/// <summary>
/// Phase-5 Slice 15 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED nine-box calibration WRITE
/// tables (<c>calibration_sessions</c> + <c>calibration_members</c> + <c>calibration_votes</c>) + the identity/RBAC
/// plane, all under the SAME RLS mechanism as the read fixture (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE
/// ROW LEVEL SECURITY, fail-closed <c>tenant_isolation</c>). CRUCIALLY the member/vote policies are the real
/// SESSION-SUBQUERY policy (EXISTS session WHERE session_id AND org = GUC, USING + WITH CHECK) — those tables have NO
/// organization_id, so the session linkage is the ONLY tenant guard. app_tenant holds SELECT/INSERT/UPDATE/DELETE on
/// the three calibration tables + SELECT on users. The tables carry the REAL Prisma unique constraints
/// (calibration_members_session_id_user_id_key + calibration_votes_session_id_evaluated_user_id_voter_id_key) so the
/// dedup 409 + the vote upsert ON CONFLICT trip REAL constraints.
///
/// Scope seed (OrgA): OrgAdmin = ninebox create+update @ organization (passes requireOrgScope; NOT a member of any
/// vote session → the org-admin-can't-forge bite). Committee = ninebox create+update @ team (narrow — the
/// requireOrgScope 403 bites) AND a calibration_member of every vote session (so it can vote → membership authority
/// beats narrow scope, the marquee). NoGrant = no ninebox grant (403). OrgB is a distinct org (cross-org RLS
/// isolation). Each MUTATING test owns a DISTINCT session/row (the whole suite shares this ONE container and runs
/// sequentially in the "NineBoxWrite" collection).
/// </summary>
public sealed class NineBoxWriteFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_ninebox_write";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Staff principals
    public static readonly Guid OrgAdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid CommitteeId = Guid.Parse("c0000000-0000-0000-0000-000000000002"); // leader@team + member
    public static readonly Guid NoGrantId = Guid.Parse("c0000000-0000-0000-0000-000000000003");
    public static readonly Guid OrgBAdminId = Guid.Parse("c0000000-0000-0000-0000-0000000000b0");

    // Non-caller users (evaluated targets + candidate members)
    public static readonly Guid E1Id = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // OrgA evaluated target
    public static readonly Guid M1Id = Guid.Parse("d0000000-0000-0000-0000-000000000002"); // OrgA member
    public static readonly Guid M2Id = Guid.Parse("d0000000-0000-0000-0000-000000000003"); // OrgA member
    public static readonly Guid MbId = Guid.Parse("d0000000-0000-0000-0000-0000000000b0"); // OrgB (cross-org)
    public static readonly Guid MissingUserId = Guid.Parse("d0000000-0000-0000-0000-0000000000ff"); // never seeded

    // Sessions — one dedicated per mutating test (order-independent).
    public static readonly Guid SessVoteRepo = Guid.Parse("ca000000-0000-0000-0000-000000000001");  // draft, member Committee
    public static readonly Guid SessVoteForge = Guid.Parse("ca000000-0000-0000-0000-000000000002"); // draft, member Committee, seeded vote
    public static readonly Guid SessVoteEval = Guid.Parse("ca000000-0000-0000-0000-000000000003");  // draft, member Committee
    public static readonly Guid SessVoteEp = Guid.Parse("ca000000-0000-0000-0000-000000000004");    // draft, member Committee
    public static readonly Guid SessAddOk = Guid.Parse("ca000000-0000-0000-0000-000000000005");     // draft, no members
    public static readonly Guid SessAddDup = Guid.Parse("ca000000-0000-0000-0000-000000000006");    // draft, member M1
    public static readonly Guid SessAddEp = Guid.Parse("ca000000-0000-0000-0000-000000000007");     // draft, no members
    public static readonly Guid SessAddEpDup = Guid.Parse("ca000000-0000-0000-0000-000000000008");  // draft, member M1
    public static readonly Guid SessRemoveOk = Guid.Parse("ca000000-0000-0000-0000-000000000009");  // draft, member M1
    public static readonly Guid SessRemoveEp = Guid.Parse("ca000000-0000-0000-0000-00000000000a");  // draft, member M1
    public static readonly Guid SessFinalizeOk = Guid.Parse("ca000000-0000-0000-0000-00000000000b");// draft
    public static readonly Guid SessFinalizeEp = Guid.Parse("ca000000-0000-0000-0000-00000000000c");// draft
    public static readonly Guid SessOrgB = Guid.Parse("ca000000-0000-0000-0000-0000000000b0");      // OrgB, draft, member Mb
    public static readonly Guid MissingSessionId = Guid.Parse("ca000000-0000-0000-0000-0000000000ff"); // never seeded

    public const string Period = "2026Q1";

    public const string OrgAdminSub = "sub-nbw-org";
    public const string CommitteeSub = "sub-nbw-committee";
    public const string NoGrantSub = "sub-nbw-none";
    public const string OrgBAdminSub = "sub-nbw-orgb";

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

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, CalibrationSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public NineBoxWriteDbContext NewWriteContext() =>
        new(new DbContextOptionsBuilder<NineBoxWriteDbContext>().UseNpgsql(ConnectionString).Options);

    public async Task<NpgsqlConnection> OpenSuperuserConnectionAsync()
    {
        var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    public async Task<bool> SessionExistsAsync(Guid id) => await ScalarBoolAsync(
        "SELECT EXISTS(SELECT 1 FROM calibration_sessions WHERE id = @id)", id);

    public async Task<string?> GetSessionStatusAsync(Guid id) => await ScalarStringAsync(
        "SELECT status FROM calibration_sessions WHERE id = @id", id);

    public async Task<bool> SessionHasCompletedAtAsync(Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT completed_at IS NOT NULL FROM calibration_sessions WHERE id = @id";
        command.Parameters.AddWithValue("id", id);
        return (bool)(await command.ExecuteScalarAsync())!;
    }

    public async Task<int> CountMembersAsync(Guid sessionId) => await CountAsync(
        "SELECT COUNT(*)::int FROM calibration_members WHERE session_id = @id", sessionId);

    public async Task<bool> MemberExistsAsync(Guid sessionId, Guid userId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM calibration_members WHERE session_id = @s AND user_id = @u)";
        command.Parameters.AddWithValue("s", sessionId);
        command.Parameters.AddWithValue("u", userId);
        return (bool)(await command.ExecuteScalarAsync())!;
    }

    public async Task<int> CountVotesAsync(Guid sessionId, Guid evaluatedUserId, Guid voterId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT COUNT(*)::int FROM calibration_votes WHERE session_id = @s AND evaluated_user_id = @e AND voter_id = @v";
        command.Parameters.AddWithValue("s", sessionId);
        command.Parameters.AddWithValue("e", evaluatedUserId);
        command.Parameters.AddWithValue("v", voterId);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    public async Task<string?> GetVoteQuadrantAsync(Guid sessionId, Guid evaluatedUserId, Guid voterId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT quadrant FROM calibration_votes WHERE session_id = @s AND evaluated_user_id = @e AND voter_id = @v";
        command.Parameters.AddWithValue("s", sessionId);
        command.Parameters.AddWithValue("e", evaluatedUserId);
        command.Parameters.AddWithValue("v", voterId);
        var result = await command.ExecuteScalarAsync();
        return result is DBNull or null ? null : (string)result;
    }

    public async Task<string?> GetVoteJustificationAsync(Guid sessionId, Guid evaluatedUserId, Guid voterId)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT justification FROM calibration_votes WHERE session_id = @s AND evaluated_user_id = @e AND voter_id = @v";
        command.Parameters.AddWithValue("s", sessionId);
        command.Parameters.AddWithValue("e", evaluatedUserId);
        command.Parameters.AddWithValue("v", voterId);
        var result = await command.ExecuteScalarAsync();
        return result is DBNull or null ? null : (string)result;
    }

    private async Task<bool> ScalarBoolAsync(string sql, Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        return (bool)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string?> ScalarStringAsync(string sql, Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        var result = await command.ExecuteScalarAsync();
        return result is DBNull or null ? null : (string)result;
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
    // the in-org validation). calibration_members/votes carry NO organization_id (tenancy via the session FK).
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
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');

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
        -- Prisma @@unique emits a UNIQUE INDEX (NOT a table constraint), exactly as `prisma db push` does on prod.
        -- This is prod-faithful and load-bearing: the vote upsert must use ON CONFLICT (columns) — a unique INDEX
        -- is NOT usable by `ON CONFLICT ON CONSTRAINT <name>` (that requires a real constraint → 500 on the live DB,
        -- the bug the parity write-verify harness caught). The addCalibrationMember dedup 409 still trips: a unique-
        -- index violation reports the index name in the error's ConstraintName (23505), which IsMemberUniqueViolation matches.
        CREATE UNIQUE INDEX calibration_members_session_id_user_id_key ON calibration_members (session_id, user_id);
        CREATE UNIQUE INDEX calibration_votes_session_id_evaluated_user_id_voter_id_key ON calibration_votes (session_id, evaluated_user_id, voter_id);
        """;

    // users + calibration_sessions are org-scoped; calibration_members/votes join their parent session (which is
    // itself RLS'd). The USING predicate ALSO gates INSERT/UPDATE/DELETE (WITH CHECK defaults to USING) — so a
    // member/vote whose session is not in the caller's org is blocked on INSERT (the session-subquery WITH CHECK).
    private const string RlsSql =
        """
        GRANT SELECT ON users TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON calibration_sessions, calibration_members, calibration_votes TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                 ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE calibration_sessions ENABLE ROW LEVEL SECURITY;  ALTER TABLE calibration_sessions FORCE ROW LEVEL SECURITY;
        ALTER TABLE calibration_members ENABLE ROW LEVEL SECURITY;   ALTER TABLE calibration_members FORCE ROW LEVEL SECURITY;
        ALTER TABLE calibration_votes ENABLE ROW LEVEL SECURITY;     ALTER TABLE calibration_votes FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users                USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON calibration_sessions USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON calibration_members  USING (EXISTS (SELECT 1 FROM calibration_sessions s WHERE s.id = calibration_members.session_id));
        CREATE POLICY tenant_isolation ON calibration_votes    USING (EXISTS (SELECT 1 FROM calibration_sessions s WHERE s.id = calibration_votes.session_id));
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
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'OrgB HR');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'ninebox', 'create'),
          ('b0000000-0000-0000-0000-000000000002', 'ninebox', 'update');

        -- hr_admin @ organization (create+update, passes requireOrgScope); leader @ team is NARROW (create+update —
        -- the requireOrgScope 403 bites; but membership lets it vote). employee (NoGrant) has NO ninebox grant → 403.
        -- OrgB hr_admin @ organization for cross-org resolution.
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'team'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-nbw-org',       'org@tims.test',       'Ana',   'Admin',     false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-nbw-committee', 'committee@tims.test', 'Cam',   'Committee', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-nbw-none',      'none@tims.test',      'Ned',   'None',      false, true),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-nbw-orgb',      'orgb@tims.test',      'Bob',   'OrgB',      false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-nbw-e1',        'e1@tims.test',        'Eve',   'One',       false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-nbw-m1',        'm1@tims.test',        'Mia',   'Member1',   false, true),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-nbw-m2',        'm2@tims.test',        'Max',   'Member2',   false, true),
          ('d0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-nbw-mb',        'mb@tims.test',        'Bea',   'OrgB',      false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');
        """;

    // Sessions (all draft) + seeded members/votes. created_by_id = org-admin (OrgB session = the OrgB admin). All
    // timestamps fixed. Committee is a member of every vote session (so it can vote); OrgAdmin is a member of NONE.
    private const string CalibrationSeedSql =
        """
        INSERT INTO calibration_sessions (id, organization_id, period, status, scheduled_at, completed_at, created_by_id, created_at, updated_at) VALUES
          ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-000000000001', '2026-05-01 00:00:00', '2026-05-01 00:00:00'),
          ('ca000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', '2026Q1', 'draft', NULL, NULL, 'c0000000-0000-0000-0000-0000000000b0', '2026-05-01 00:00:00', '2026-05-01 00:00:00');

        INSERT INTO calibration_members (id, session_id, user_id, status, created_at) VALUES
          -- Committee is a member of every vote session (SessVoteRepo/Forge/Eval/Ep).
          ('cb000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'invited', '2026-05-01 01:00:00'),
          ('cb000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'invited', '2026-05-01 01:00:00'),
          ('cb000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'invited', '2026-05-01 01:00:00'),
          ('cb000000-0000-0000-0000-000000000004', 'ca000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', 'invited', '2026-05-01 01:00:00'),
          -- M1 seeded on the dedup + remove sessions.
          ('cb000000-0000-0000-0000-000000000006', 'ca000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000002', 'invited', '2026-05-01 01:00:00'),
          ('cb000000-0000-0000-0000-000000000008', 'ca000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000002', 'invited', '2026-05-01 01:00:00'),
          ('cb000000-0000-0000-0000-000000000009', 'ca000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000002', 'invited', '2026-05-01 01:00:00'),
          ('cb000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'invited', '2026-05-01 01:00:00'),
          -- OrgB member on the OrgB session (cross-org).
          ('cb000000-0000-0000-0000-0000000000b0', 'ca000000-0000-0000-0000-0000000000b0', 'd0000000-0000-0000-0000-0000000000b0', 'invited', '2026-05-01 01:00:00');

        -- SessVoteForge seeds a vote by Committee → E1 ('star') so the org-admin-can't-overwrite bite has a real row.
        INSERT INTO calibration_votes (id, session_id, evaluated_user_id, voter_id, quadrant, justification, created_at) VALUES
          ('cc000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'star', 'seed', '2026-05-01 02:00:00');
        """;
}
