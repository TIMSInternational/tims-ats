using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Testcontainers.PostgreSql;
using Tims.Domain.Identity;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.ExternalVendor;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// Phase-5 Slice 2 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED
/// <c>preemployment_validations</c> table — WITH its real <c>single_completer_chk</c> CHECK constraint —
/// plus the append-only <c>data_access_logs</c>, under the SAME RLS mechanism as the other fixtures
/// (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c> policy with WITH CHECK). Seeds pending validations in OrgA (one per destructive
/// test so runs never collide) + one already-<c>passed</c> row (CONFLICT source) + one pending row in OrgB
/// (cross-org). A privileged identity/RBAC plane seeds OrgA's <c>external</c>→<c>validation:update</c>
/// grant + the <c>tims_</c> keys the endpoint reject-matrix drives.
///
/// A SECOND database (<see cref="MissingAuditConnectionString"/>) has the global <c>app_tenant</c> role
/// but NO <c>data_access_logs</c> table, so an auditor pointed at it fails its INSERT — the deterministic
/// audit failure that drives the fail-SOFT no-rollback proof (INV-6 bite).
/// </summary>
public sealed class ExternalValidationFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_ext_write";
    private const string MissingAuditDatabase = "tims_ext_write_noaudit";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid SuspendedOrg = Guid.Parse("33333333-3333-3333-3333-333333333333");

    // Distinct pending validations — one per destructive test so the shared container never collides.
    public static readonly Guid ValidationProvenance = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid ValidationDouble = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    public static readonly Guid ValidationAudit = Guid.Parse("d0000000-0000-0000-0000-000000000003");
    public static readonly Guid ValidationFailSoft = Guid.Parse("d0000000-0000-0000-0000-000000000004");
    public static readonly Guid ValidationEndpoint = Guid.Parse("d0000000-0000-0000-0000-000000000005");
    public static readonly Guid ValidationClock = Guid.Parse("d0000000-0000-0000-0000-000000000006");
    public static readonly Guid ValidationAlreadyPassed = Guid.Parse("d0000000-0000-0000-0000-0000000000ff");
    public static readonly Guid ValidationOrgB = Guid.Parse("db000000-0000-0000-0000-000000000001");

    // The api-key id that resolves for the scoped write key (the DB provenance + audit actor for the
    // endpoint 200 path).
    public static readonly Guid ValidScopedKeyId = Guid.Parse("ca000000-0000-0000-0000-000000000001");

    // FIX 6: real api_keys rows used ONLY as the provenance actor (completed_by_api_key_id) by the writing
    // use-case tests — so the write references a genuine key under the FK to api_keys(id), faithful to prod.
    // Distinct per test so the audit-count assertions stay isolated on the shared container.
    public static readonly Guid ActorDoubleKeyId = Guid.Parse("ca000000-0000-0000-0000-0000000000d1");
    public static readonly Guid ActorAuditKeyId = Guid.Parse("ca000000-0000-0000-0000-0000000000d2");
    public static readonly Guid ActorFailSoftKeyId = Guid.Parse("ca000000-0000-0000-0000-0000000000d3");

    // Raw bearer tokens (clients present these; the DB stores only their SHA-256 hash).
    public const string ValidScopedToken = "tims_ext_write_valid_scoped_00000000000000000000000001";
    public const string EmptyScopeToken = "tims_ext_write_empty_scope_000000000000000000000000002";
    public const string WrongScopeToken = "tims_ext_write_wrong_scope_000000000000000000000000003";
    public const string NoGrantOrgToken = "tims_ext_write_no_grant_org_00000000000000000000000004";
    public const string RevokedToken = "tims_ext_write_revoked_0000000000000000000000000000005";

    // FIX 7: an EXPIRED key (OrgA) and a key on the SUSPENDED org (both → 401 in the reject-matrix), the
    // latter finally wiring the previously-dead SuspendedOrg constant.
    public const string ExpiredToken = "tims_ext_write_expired_00000000000000000000000000000006";
    public const string SuspendedOrgToken = "tims_ext_write_suspended_org_0000000000000000000000007";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    /// <summary>A second DB on the same server WITHOUT data_access_logs — audit writes here fail.</summary>
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
            ddl.CommandText = SchemaSql + IdentitySchemaSql + SeedSql + IdentitySeedSql;
            await ddl.ExecuteNonQueryAsync();
        }

        await SeedApiKeysAsync(connection);

        await using (var db2 = connection.CreateCommand())
        {
            db2.CommandText = $"CREATE DATABASE {MissingAuditDatabase}";
            await db2.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public ExternalValidationDbContext NewValidationContext(string? connectionString = null) =>
        new(new DbContextOptionsBuilder<ExternalValidationDbContext>()
            .UseNpgsql(connectionString ?? ConnectionString).Options);

    public DataAccessAuditDbContext NewAuditContext(string? connectionString = null) =>
        new(new DbContextOptionsBuilder<DataAccessAuditDbContext>()
            .UseNpgsql(connectionString ?? ConnectionString).Options);

    public async Task<NpgsqlConnection> OpenSuperuserConnectionAsync()
    {
        var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    /// <summary>Reads a validation row as superuser (bypasses RLS) — null if absent.</summary>
    public async Task<ValidationSnapshot?> GetValidationAsync(Guid id)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT status, completed_by_id, completed_by_api_key_id, completed_at, result, notes FROM preemployment_validations WHERE id = @id";
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new ValidationSnapshot(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetGuid(1),
            reader.IsDBNull(2) ? null : reader.GetGuid(2),
            reader.IsDBNull(3) ? null : reader.GetDateTime(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5));
    }

    /// <summary>
    /// FIX 4: reads a top-level field out of the stored <c>result</c> jsonb via <c>result-&gt;&gt;'key'</c>
    /// (superuser). Returns the field's text value, or null if the key is absent OR <c>result</c> is not a
    /// queryable jsonb OBJECT (e.g. a double-encoded JSON string) — so a storage regression bites.
    /// </summary>
    public async Task<string?> GetValidationResultFieldAsync(Guid id, string key)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT result ->> @key FROM preemployment_validations WHERE id = @id";
        command.Parameters.AddWithValue("key", key);
        command.Parameters.AddWithValue("id", id);
        var value = await command.ExecuteScalarAsync();
        return value is DBNull or null ? null : (string)value;
    }

    /// <summary>Counts vendor update audit rows written by a specific actor (unique per test).</summary>
    public async Task<int> CountVendorUpdateAuditRowsAsync(Guid actor)
    {
        await using var connection = await OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT count(*) FROM data_access_logs WHERE actor_id = @actor AND data_type = 'preemploymentValidation' AND action = 'update'";
        command.Parameters.AddWithValue("actor", actor);
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    private const string SchemaSql =
        """
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
            created_at timestamp(3) NOT NULL DEFAULT now(),
            updated_at timestamp(3) NOT NULL DEFAULT now(),
            CONSTRAINT preemployment_validations_single_completer_chk
                CHECK (completed_by_id IS NULL OR completed_by_api_key_id IS NULL)
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

        GRANT SELECT, UPDATE ON preemployment_validations TO app_tenant;
        GRANT SELECT, INSERT ON data_access_logs TO app_tenant;

        ALTER TABLE preemployment_validations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE preemployment_validations FORCE ROW LEVEL SECURITY;
        ALTER TABLE data_access_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON preemployment_validations
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON data_access_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // Five pending OrgA rows (one per destructive test) + one already-passed (CONFLICT) + one OrgB row.
    private const string SeedSql =
        """
        INSERT INTO preemployment_validations
          (id, organization_id, offer_id, type, status, completed_at) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001', 'background_check', 'pending', NULL),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001', 'background_check', 'pending', NULL),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001', 'background_check', 'pending', NULL),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001', 'background_check', 'pending', NULL),
          ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001', 'background_check', 'pending', NULL),
          ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001', 'background_check', 'pending', NULL),
          ('d0000000-0000-0000-0000-0000000000ff', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001', 'background_check', 'passed', '2026-01-01 00:00:00'),
          ('db000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-0000000000b1', 'background_check', 'pending', NULL);
        """;

    // Identity/RBAC schema (privileged path, no RLS): the exact columns the EF entities + resolver map.
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

        -- FIX 6: the REAL prod FK (migration 20260713140000) — provenance must reference a genuine api key.
        -- Added after api_keys exists (preemployment_validations was created earlier in SchemaSql).
        ALTER TABLE preemployment_validations
            ADD CONSTRAINT preemployment_validations_completed_by_api_key_id_fkey
            FOREIGN KEY (completed_by_api_key_id) REFERENCES api_keys (id)
            ON DELETE SET NULL ON UPDATE CASCADE;
        """;

    // OrgA active + `external`→validation:update@organization; OrgB active but NO grant; a suspended org.
    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active, deleted_at) VALUES
          ('11111111-1111-1111-1111-111111111111', true, NULL),
          ('22222222-2222-2222-2222-222222222222', true, NULL),
          ('33333333-3333-3333-3333-333333333333', false, NULL);

        INSERT INTO roles (id, organization_id, slug) VALUES
          ('ea111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'external');

        INSERT INTO permissions (id, module, action) VALUES
          ('9e000000-0000-0000-0000-000000000001', 'validation', 'update');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'ea111111-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000001', 'organization');
        """;

    private async Task SeedApiKeysAsync(NpgsqlConnection connection)
    {
        var keys = new (string Token, Guid Id, Guid Org, string Scopes, DateTime? Revoked, DateTime? Expires)[]
        {
            (ValidScopedToken, ValidScopedKeyId, OrgA, """["validation:write"]""", null, null),
            (EmptyScopeToken, Guid.Parse("ca000000-0000-0000-0000-000000000002"), OrgA, "[]", null, null),
            (WrongScopeToken, Guid.Parse("ca000000-0000-0000-0000-000000000003"), OrgA, """["assessment:read"]""", null, null),
            (NoGrantOrgToken, Guid.Parse("ca000000-0000-0000-0000-000000000004"), OrgB, """["validation:write"]""", null, null),
            (RevokedToken, Guid.Parse("ca000000-0000-0000-0000-000000000005"), OrgA, """["validation:write"]""", DateTime.UtcNow.AddMinutes(-1), null),
            // FIX 7: expired (OrgA) + suspended-org (SuspendedOrg) keys — both rejected 401 in the matrix.
            (ExpiredToken, Guid.Parse("ca000000-0000-0000-0000-000000000006"), OrgA, """["validation:write"]""", null, DateTime.UtcNow.AddMinutes(-5)),
            (SuspendedOrgToken, Guid.Parse("ca000000-0000-0000-0000-000000000007"), SuspendedOrg, """["validation:write"]""", null, null),
            // FIX 6: provenance-actor keys (never presented as a bearer) so the writing tests' vendor UPDATE
            // sets completed_by_api_key_id to a REAL api_keys.id under the FK. Empty scopes / dummy tokens.
            ("tims_ext_write_actor_double_00000000000000000000000d1", ActorDoubleKeyId, OrgA, "[]", null, null),
            ("tims_ext_write_actor_audit_000000000000000000000000d2", ActorAuditKeyId, OrgA, "[]", null, null),
            ("tims_ext_write_actor_failsoft_0000000000000000000000d3", ActorFailSoftKeyId, OrgA, "[]", null, null),
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
}

/// <summary>A superuser read of a validation row (RLS bypassed) for the integration assertions.</summary>
public sealed record ValidationSnapshot(
    string Status,
    Guid? CompletedById,
    Guid? CompletedByApiKeyId,
    DateTime? CompletedAt,
    string? Result,
    string? Notes);
