using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Audit;

namespace Tims.IntegrationTests.Audit;

/// <summary>
/// Phase-5 Slice 17 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED
/// <c>audit_logs</c> table (RLS-protected, exactly like every other read fixture) + the identity
/// plane, seeded with rows in TWO orgs so a cross-org read either DOES or DOES NOT bleed —
/// provably. `is_platform_owner` on the seeded `users` row backs the 4-principal-type auth matrix
/// (only one seeded user has it `true`). Reused by Task 8's cross-org + auth-matrix tests — do not
/// duplicate this fixture there.
/// </summary>
public sealed class AuditReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_audit_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public const string PlatformOwnerSub = "sub-audit-platform-owner";
    public const string OrgUserSub = "sub-audit-org-user";

    // Named so tests can assert by id instead of by a since-removed flat OrganizationId field on
    // AuditLogListItem (the real TS select never returns organizationId — see Task 1/2).
    public static readonly Guid LogOrgA1 = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid LogOrgA2 = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    public static readonly Guid LogOrgB1 = Guid.Parse("d0000000-0000-0000-0000-000000000003");
    public static readonly Guid OrgUserId = Guid.Parse("c0000000-0000-0000-0000-000000000002");

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
            role.CommandText = "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;";
            await role.ExecuteNonQueryAsync();
        }

        foreach (var sql in new[] { IdentitySchemaSql, IdentitySeedSql, AuditSchemaSql, AuditSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public AuditReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<AuditReadDbContext>().UseNpgsql(ConnectionString).Options);

    private const string IdentitySchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NULL,
            last_name text NULL,
            avatar text NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        -- Empty on purpose: PlatformOwnerGate checks PrincipalType only, never a role grant, but
        -- IdentityRepository.FindBySupabaseUserIdAsync unconditionally `.Include(u => u.UserRoles)
        -- .ThenInclude(ur => ur.Role)`s every staff lookup (both principals below go through it) —
        -- without these tables the query 500s on "relation does not exist" (mirrors ReportingReadFixture's
        -- identical roles/user_roles pair, kept schema-only here since no test needs a seeded grant row).
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            slug text NOT NULL
        );
        CREATE TABLE user_roles (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users (id),
            role_id uuid NOT NULL REFERENCES roles (id)
        );
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, name, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', 'Acme Corp', true),
          ('22222222-2222-2222-2222-222222222222', 'Globex Inc', true);

        -- one real platform owner (org-less) + one ordinary org-scoped staff user (no grants needed —
        -- PlatformOwnerGate checks PrincipalType only, never a permission grant). The org-user is also
        -- the actor on the OrgA audit rows below, so first_name/last_name back the nested `actor` join.
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', NULL, 'sub-audit-platform-owner', 'owner@tims.test', 'Olivia', 'Owner', NULL, true, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-audit-org-user', 'orguser@tims.test', 'Rick', 'Recruiter', NULL, false, true);
        """;

    private const string AuditSchemaSql =
        """
        CREATE TABLE audit_logs (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            user_id uuid NULL,
            actor_id uuid NULL,
            action text NOT NULL,
            entity text NOT NULL,
            entity_id text NULL,
            changes jsonb NULL,
            metadata jsonb NULL,
            ip_address text NULL,
            user_agent text NULL,
            created_at timestamp NOT NULL DEFAULT now()
        );
        GRANT SELECT ON audit_logs TO app_tenant;
        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON audit_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // 2 rows in OrgA, 1 in OrgB — a cross-org bleed (or its absence) changes the counts, not just
    // a total (mirrors the reporting fixture's "distinct per-org data" discipline).
    private const string AuditSeedSql =
        """
        INSERT INTO audit_logs (id, organization_id, actor_id, action, entity, created_at) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'login_failed', 'auth', '2026-07-20T10:00:00Z'),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'access', 'candidate', '2026-07-21T10:00:00Z'),
          ('d0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', NULL, 'login_failed', 'auth', '2026-07-19T10:00:00Z');
        """;
}

// Declared alongside the fixture (not in a per-test file) so every test class in this task AND
// Task 8 (AuditReadCrossOrgTests, AuditReadEndpointAuthTests) can reference [Collection("AuditRead")]
// without redeclaring this — xUnit requires exactly one [CollectionDefinition] per collection name.
[CollectionDefinition("AuditRead")]
public sealed class AuditReadCollection : ICollectionFixture<AuditReadFixture>;
