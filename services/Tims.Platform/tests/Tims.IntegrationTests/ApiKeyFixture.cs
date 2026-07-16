using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Testcontainers.PostgreSql;
using Tims.Domain.Identity;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// Spins up one Postgres container with a MINIMAL hand-authored schema for the external `tims_`
/// API-key plane (`organizations` + `api_keys` — only the columns <see cref="IdentityDbContext"/>
/// maps, plus the jsonb `scopes`) and seeds the scenarios exercised by the WP2.3 tests: an active
/// org, a suspended org, a soft-deleted org, and keys that are valid / empty-scope / revoked /
/// expired / on a locked-out org / with malformed scopes.
///
/// This is the PRE-TENANT / privileged path, so — like <see cref="IdentityFixture"/> — there is no
/// app_tenant role, no RLS, and no TenantScope. Key hashes are the SHA-256 of the raw tokens via
/// the same <see cref="ApiKeyHash.Sha256Hex"/> the resolver uses, so the store↔verify hash matches.
/// </summary>
public sealed class ApiKeyFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_apikeys";

    public static readonly Guid ActiveOrg = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid SuspendedOrg = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid DeletedOrg = Guid.Parse("33333333-3333-3333-3333-333333333333");

    // Raw bearer tokens (what a client presents). The DB stores only their SHA-256 hash.
    public const string ValidToken = "tims_test_valid_key_0000000000000000000000000000000000000001";
    public const string EmptyScopeToken = "tims_test_empty_scope_00000000000000000000000000000000000002";
    public const string RevokedToken = "tims_test_revoked_key_0000000000000000000000000000000000003";
    public const string ExpiredToken = "tims_test_expired_key_0000000000000000000000000000000000004";
    public const string SuspendedOrgToken = "tims_test_suspended_org_00000000000000000000000000000000005";
    public const string DeletedOrgToken = "tims_test_deleted_org_00000000000000000000000000000000000006";
    public const string MalformedScopeToken = "tims_test_malformed_scope_000000000000000000000000000000007";
    public const string UnknownToken = "tims_test_unknown_key_never_seeded_0000000000000000000000008";

    public static readonly Guid ValidKeyId = Guid.Parse("a0000000-0000-0000-0000-0000000000a1");
    public static readonly Guid EmptyScopeKeyId = Guid.Parse("a0000000-0000-0000-0000-0000000000a2");

    // The parsed scopes seeded for ValidToken (order-preserving).
    public static readonly string[] ValidScopes = ["read:candidates", "read:validations"];

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

        await using (var setup = connection.CreateCommand())
        {
            setup.CommandText =
                """
                CREATE TABLE organizations (
                    id uuid PRIMARY KEY,
                    is_active boolean NOT NULL DEFAULT true,
                    deleted_at timestamptz NULL
                );

                CREATE TABLE api_keys (
                    id uuid PRIMARY KEY,
                    organization_id uuid NOT NULL REFERENCES organizations (id),
                    key_hash text NOT NULL,
                    scopes jsonb NOT NULL,
                    revoked_at timestamptz NULL,
                    expires_at timestamptz NULL
                );
                """;
            await setup.ExecuteNonQueryAsync();
        }

        await using (var orgs = connection.CreateCommand())
        {
            orgs.CommandText =
                """
                INSERT INTO organizations (id, is_active, deleted_at) VALUES
                    (@active, true, NULL),
                    (@suspended, false, NULL),
                    (@deleted, true, @deletedAt);
                """;
            orgs.Parameters.AddWithValue("active", ActiveOrg);
            orgs.Parameters.AddWithValue("suspended", SuspendedOrg);
            orgs.Parameters.AddWithValue("deleted", DeletedOrg);
            orgs.Parameters.AddWithValue("deletedAt", DateTime.UtcNow.AddDays(-1));
            await orgs.ExecuteNonQueryAsync();
        }

        var future = DateTime.UtcNow.AddYears(1);
        var past = DateTime.UtcNow.AddMinutes(-5);

        // (rawToken, id, orgId, scopesJson, revokedAt, expiresAt)
        var keys = new (string Token, Guid Id, Guid Org, string Scopes, DateTime? Revoked, DateTime? Expires)[]
        {
            (ValidToken, ValidKeyId, ActiveOrg, """["read:candidates","read:validations"]""", null, null),
            (EmptyScopeToken, EmptyScopeKeyId, ActiveOrg, "[]", null, future),
            (RevokedToken, Guid.Parse("a0000000-0000-0000-0000-0000000000a3"), ActiveOrg, """["read:candidates"]""", DateTime.UtcNow.AddMinutes(-1), null),
            (ExpiredToken, Guid.Parse("a0000000-0000-0000-0000-0000000000a4"), ActiveOrg, """["read:candidates"]""", null, past),
            (SuspendedOrgToken, Guid.Parse("a0000000-0000-0000-0000-0000000000a5"), SuspendedOrg, """["read:candidates"]""", null, null),
            (DeletedOrgToken, Guid.Parse("a0000000-0000-0000-0000-0000000000a6"), DeletedOrg, """["read:candidates"]""", null, null),
            (MalformedScopeToken, Guid.Parse("a0000000-0000-0000-0000-0000000000a7"), ActiveOrg, "[1,2]", null, null),
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

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }

    public static DbContextOptions<IdentityDbContext> BuildOptions(string connectionString)
    {
        return new DbContextOptionsBuilder<IdentityDbContext>()
            .UseNpgsql(connectionString)
            .Options;
    }
}
