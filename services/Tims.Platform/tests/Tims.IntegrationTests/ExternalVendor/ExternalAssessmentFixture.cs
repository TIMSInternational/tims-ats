using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Testcontainers.PostgreSql;
using Tims.Domain.Identity;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.ExternalVendor;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// Phase-5 Slice 1 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED
/// <c>assessment_results</c> ⋈ <c>assessment_assignments</c> ⋈ <c>assessment_types</c> tables (plus the
/// append-only <c>data_access_logs</c>) under the SAME RLS mechanism as <see cref="RlsFixture"/> —
/// NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c> policy. Seeds two orgs: OrgA has four COMPLETED scored results (two sharing a
/// <c>scored_at</c> to exercise the assignmentId tiebreaker) + one scored result on an IN_PROGRESS
/// assignment (INV-A leak candidate); OrgB has one completed result (INV-E cross-org).
///
/// A SECOND database (<see cref="MissingAuditConnectionString"/>) has the global <c>app_tenant</c> role
/// but NO <c>data_access_logs</c> table, so an auditor pointed at it fails its INSERT — the deterministic
/// write-failure that drives the fail-closed audit-ABORT proof (INV-D bite).
/// </summary>
public sealed class ExternalAssessmentFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_ext_read";
    private const string MissingAuditDatabase = "tims_ext_read_noaudit";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // OrgA completed assignments (a01..a04) — a03/a04 share scored_at 2026-03-01 (tiebreak on id asc).
    public static readonly Guid AssignmentA1 = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    public static readonly Guid AssignmentA2 = Guid.Parse("a0000000-0000-0000-0000-000000000002");
    public static readonly Guid AssignmentA3 = Guid.Parse("a0000000-0000-0000-0000-000000000003");
    public static readonly Guid AssignmentA4 = Guid.Parse("a0000000-0000-0000-0000-000000000004");
    public static readonly Guid AssignmentAInProgress = Guid.Parse("a0000000-0000-0000-0000-0000000000ff");
    public static readonly Guid AssignmentB1 = Guid.Parse("b0000000-0000-0000-0000-000000000001");

    // Result ids (the audit recordId) — distinct from assignment ids to prove the correct id is logged.
    public static readonly Guid ResultA1 = Guid.Parse("e0000000-0000-0000-0000-000000000001");
    public static readonly Guid ResultA2 = Guid.Parse("e0000000-0000-0000-0000-000000000002");
    public static readonly Guid ResultA3 = Guid.Parse("e0000000-0000-0000-0000-000000000003");
    public static readonly Guid ResultA4 = Guid.Parse("e0000000-0000-0000-0000-000000000004");
    public static readonly Guid ResultAInProgress = Guid.Parse("e0000000-0000-0000-0000-0000000000ff");
    public static readonly Guid ResultB1 = Guid.Parse("e0000000-0000-0000-0000-0000000000b1");

    // ---- FIX 2 endpoint boot-test identity/RBAC seed (SAME DB, privileged path, NO RLS) -----------
    // OrgA's `external` role is granted assessment:read@organization; OrgB has no such grant; a third
    // org is suspended. The `tims_` keys below drive the endpoint reject-matrix through the real HTTP
    // pipeline (auth scheme + PermissionService grant + ExternalScope + per-key rate limit).
    public static readonly Guid SuspendedOrg = Guid.Parse("33333333-3333-3333-3333-333333333333");

    // Raw bearer tokens (clients present these; the DB stores only their SHA-256 hash).
    public const string ValidEmptyScopeToken = "tims_ext_read_valid_empty_scope_00000000000000000000000001";
    public const string ValidScopedToken = "tims_ext_read_valid_scoped_000000000000000000000000000002";
    public const string ScopeExcludesToken = "tims_ext_read_scope_excludes_00000000000000000000000003";
    public const string NoGrantOrgToken = "tims_ext_read_no_grant_org_0000000000000000000000000004";
    public const string RevokedToken = "tims_ext_read_revoked_00000000000000000000000000000005";
    public const string ExpiredToken = "tims_ext_read_expired_00000000000000000000000000000006";
    public const string SuspendedOrgToken = "tims_ext_read_suspended_org_00000000000000000000000007";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    /// <summary>A second DB on the same server WITHOUT data_access_logs -- audit writes here fail.</summary>
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

        await using (var ddl = connection.CreateCommand())
        {
            ddl.CommandText = SchemaSql;
            await ddl.ExecuteNonQueryAsync();
        }

        await using (var seed = connection.CreateCommand())
        {
            seed.CommandText = SeedSql;
            await seed.ExecuteNonQueryAsync();
        }

        // Identity/RBAC plane for the endpoint boot test — privileged path (superuser, no RLS).
        await using (var identity = connection.CreateCommand())
        {
            identity.CommandText = IdentitySchemaSql + IdentitySeedSql;
            await identity.ExecuteNonQueryAsync();
        }

        await SeedApiKeysAsync(connection);

        // CREATE DATABASE cannot run inside a transaction block — a plain autocommit command is fine.
        await using (var db2 = connection.CreateCommand())
        {
            db2.CommandText = $"CREATE DATABASE {MissingAuditDatabase}";
            await db2.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    // Same unmapped-types data source the Program.cs DI uses (built fresh per call, scoped to the
    // requested connection string), so the native `band` enum column reads into a C# string identically
    // in the direct-repo tests and the booted host.
    public ExternalAssessmentDbContext NewReadContext(string? connectionString = null) =>
        new(new DbContextOptionsBuilder<ExternalAssessmentDbContext>()
            .UseNpgsql(ExternalAssessmentDataSource.Build(connectionString ?? ConnectionString)).Options);

    public DataAccessAuditDbContext NewAuditContext(string? connectionString = null) =>
        new(new DbContextOptionsBuilder<DataAccessAuditDbContext>()
            .UseNpgsql(connectionString ?? ConnectionString).Options);

    /// <summary>
    /// Returns the record_ids of assessmentResult export audit rows written by a specific actor (the
    /// audit test uses a UNIQUE actor id so the shared container never leaks counts across tests).
    /// Read as superuser (bypasses RLS), ordered by record_id.
    /// </summary>
    public async Task<List<Guid>> ExportRecordIdsForActorAsync(Guid actor)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT record_id FROM data_access_logs WHERE actor_id = @actor AND data_type = 'assessmentResult' AND action = 'export' ORDER BY record_id";
        command.Parameters.AddWithValue("actor", actor);
        var ids = new List<Guid>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            ids.Add(reader.GetGuid(0));
        }

        return ids;
    }

    private const string SchemaSql =
        """
        CREATE TABLE assessment_types (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            name text NOT NULL
        );
        CREATE TABLE assessment_assignments (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            candidate_id uuid NOT NULL,
            vacancy_id uuid NOT NULL,
            assessment_type_id uuid NOT NULL,
            status text NOT NULL,
            assigned_at timestamp(3) NOT NULL,
            started_at timestamp(3) NULL,
            completed_at timestamp(3) NULL,
            expires_at timestamp(3) NULL
        );
        CREATE TYPE "ScoreBand" AS ENUM ('below_average', 'average', 'above_average', 'excellent');
        CREATE TABLE assessment_results (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            assignment_id uuid NOT NULL UNIQUE,
            raw_score double precision NULL,
            normalized_score double precision NULL,
            percentile double precision NULL,
            band "ScoreBand" NULL,
            norm_sample_size integer NULL,
            breakdown jsonb NULL,
            interpretation jsonb NULL,
            model_version text NULL,
            scored_at timestamp(3) NOT NULL
        );
        CREATE TABLE data_access_logs (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            actor_id uuid NOT NULL,
            data_type text NOT NULL,
            record_id uuid NOT NULL,
            action text NOT NULL,
            ip_address text NULL,
            user_agent text NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        GRANT SELECT ON assessment_types, assessment_assignments, assessment_results TO app_tenant;
        GRANT SELECT, INSERT ON data_access_logs TO app_tenant;

        ALTER TABLE assessment_types ENABLE ROW LEVEL SECURITY;
        ALTER TABLE assessment_types FORCE ROW LEVEL SECURITY;
        ALTER TABLE assessment_assignments ENABLE ROW LEVEL SECURITY;
        ALTER TABLE assessment_assignments FORCE ROW LEVEL SECURITY;
        ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
        ALTER TABLE assessment_results FORCE ROW LEVEL SECURITY;
        ALTER TABLE data_access_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON assessment_types
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON assessment_assignments
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON assessment_results
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON data_access_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // Identity/RBAC schema (privileged path, no RLS): the exact columns the EF entities map.
    private const string IdentitySchemaSql =
        """
        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            is_active boolean NOT NULL DEFAULT true,
            deleted_at timestamptz NULL
        );
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            slug text NOT NULL
        );
        CREATE TABLE permissions (
            id uuid PRIMARY KEY,
            module text NOT NULL,
            action text NOT NULL
        );
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY,
            role_id uuid NOT NULL,
            permission_id uuid NOT NULL,
            scope text NOT NULL DEFAULT 'own'
        );
        CREATE TABLE api_keys (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            key_hash text NOT NULL,
            scopes jsonb NOT NULL,
            revoked_at timestamptz NULL,
            expires_at timestamptz NULL
        );
        """;

    // OrgA active + `external`→assessment:read@organization; OrgB active but NO grant; a suspended org.
    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active, deleted_at) VALUES
          ('11111111-1111-1111-1111-111111111111', true, NULL),
          ('22222222-2222-2222-2222-222222222222', true, NULL),
          ('33333333-3333-3333-3333-333333333333', false, NULL);

        INSERT INTO roles (id, organization_id, slug) VALUES
          ('ea111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'external');

        INSERT INTO permissions (id, module, action) VALUES
          ('9e000000-0000-0000-0000-000000000001', 'assessment', 'read');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'ea111111-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000001', 'organization');
        """;

    // Hash the raw tokens the same way the resolver does, so store↔verify match. Suspended-org / revoked
    // / expired keys prove the fail-closed 401 rows without needing each individually revoked.
    private async Task SeedApiKeysAsync(NpgsqlConnection connection)
    {
        var past = DateTime.UtcNow.AddMinutes(-5);

        var keys = new (string Token, Guid Id, Guid Org, string Scopes, DateTime? Revoked, DateTime? Expires)[]
        {
            (ValidEmptyScopeToken, Guid.Parse("ca000000-0000-0000-0000-000000000001"), OrgA, "[]", null, null),
            (ValidScopedToken, Guid.Parse("ca000000-0000-0000-0000-000000000002"), OrgA, """["assessment:read","read:candidates"]""", null, null),
            (ScopeExcludesToken, Guid.Parse("ca000000-0000-0000-0000-000000000003"), OrgA, """["read:candidates"]""", null, null),
            (NoGrantOrgToken, Guid.Parse("ca000000-0000-0000-0000-000000000004"), OrgB, "[]", null, null),
            (RevokedToken, Guid.Parse("ca000000-0000-0000-0000-000000000005"), OrgA, """["assessment:read"]""", DateTime.UtcNow.AddMinutes(-1), null),
            (ExpiredToken, Guid.Parse("ca000000-0000-0000-0000-000000000006"), OrgA, """["assessment:read"]""", null, past),
            (SuspendedOrgToken, Guid.Parse("ca000000-0000-0000-0000-000000000007"), SuspendedOrg, "[]", null, null),
        };

        foreach (var key in keys)
        {
            await using var insert = connection.CreateCommand();
            insert.CommandText =
                """
                INSERT INTO api_keys (id, organization_id, key_hash, scopes, revoked_at, expires_at)
                VALUES (@id, @org, @hash, @scopes::jsonb, @revoked, @expires);
                """;
            insert.Parameters.AddWithValue("id", key.Id);
            insert.Parameters.AddWithValue("org", key.Org);
            insert.Parameters.AddWithValue("hash", ApiKeyHash.Sha256Hex(key.Token));
            insert.Parameters.AddWithValue("scopes", key.Scopes);
            insert.Parameters.Add(new NpgsqlParameter("revoked", NpgsqlDbType.TimestampTz)
            {
                Value = (object?)key.Revoked ?? DBNull.Value,
            });
            insert.Parameters.Add(new NpgsqlParameter("expires", NpgsqlDbType.TimestampTz)
            {
                Value = (object?)key.Expires ?? DBNull.Value,
            });
            await insert.ExecuteNonQueryAsync();
        }
    }

    private const string SeedSql =
        """
        INSERT INTO assessment_types (id, organization_id, name) VALUES
          ('aaaaaaaa-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Cognitive Aptitude'),
          ('bbbbbbbb-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'DISC');

        INSERT INTO assessment_assignments
          (id, organization_id, candidate_id, vacancy_id, assessment_type_id, status, assigned_at, started_at, completed_at, expires_at) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'completed', '2025-12-01 00:00:00', '2025-12-02 00:00:00', '2025-12-31 00:00:00', NULL),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'completed', '2025-12-01 00:00:00', NULL, '2026-01-31 00:00:00', NULL),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'completed', '2025-12-01 00:00:00', NULL, '2026-02-28 00:00:00', NULL),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'completed', '2025-12-01 00:00:00', NULL, '2026-02-28 00:00:00', NULL),
          ('a0000000-0000-0000-0000-0000000000ff', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000ff', 'f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'in_progress', '2025-12-01 00:00:00', '2026-03-15 00:00:00', NULL, NULL),
          ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'completed', '2025-12-01 00:00:00', NULL, '2026-04-30 00:00:00', NULL);

        INSERT INTO assessment_results
          (id, organization_id, assignment_id, raw_score, normalized_score, percentile, band, norm_sample_size, breakdown, interpretation, model_version, scored_at) VALUES
          ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 10, 55, 60, 'average', 12, '{"dim":"num"}', '["ok"]', 'psy-v1', '2026-01-01 00:00:00'),
          ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002', 20, 65, 70, NULL, NULL, NULL, NULL, 'psy-v1', '2026-02-01 00:00:00'),
          ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000003', 30, 75, 80, 'above_average', 20, NULL, NULL, 'psy-v1', '2026-03-01 00:00:00'),
          ('e0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004', 40, 85, 90, 'excellent', 25, NULL, NULL, 'psy-v1', '2026-03-01 00:00:00'),
          ('e0000000-0000-0000-0000-0000000000ff', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-0000000000ff', 99, 99, 99, 'excellent', 99, '{"leak":true}', '["should-not-show"]', 'psy-v1', '2026-03-20 00:00:00'),
          ('e0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000001', 50, 50, 50, 'average', 15, NULL, NULL, 'psy-v1', '2026-05-01 00:00:00');
        """;
}
