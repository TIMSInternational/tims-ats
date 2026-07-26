using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.AccessReview;

namespace Tims.IntegrationTests.AccessReview;

/// <summary>
/// Phase-5 Slice 18 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED identity
/// tables (RICHER column set than <see cref="Tims.IntegrationTests.Audit.AuditReadFixture"/>'s
/// schema-only roles/user_roles — access-review actually reads assigned_at/assigned_by/scopes/
/// expires_at/role name/isActive/role_permissions/permissions, so those columns are POPULATED here,
/// not just present) + `access_reviews`. Seeds 2 orgs so org-scoping is provably correct (Task 8),
/// and rows hitting every one of the 6 risk flags (Task 2's kernel) so the report/repository tests
/// have real data to assert against.
/// </summary>
public sealed class AccessReviewFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_access_review";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public const string PlatformOwnerSub = "sub-access-review-platform-owner";
    public const string OrgUserSub = "sub-access-review-org-user";

    public static readonly Guid PlatformOwnerId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid OrgUserId = Guid.Parse("c0000000-0000-0000-0000-000000000002");

    // OrgA users, one per risk-flag scenario. OrgB carries just enough to prove cross-org isolation.
    public static readonly Guid HealthyUserId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    public static readonly Guid NeverLoggedInUserId = Guid.Parse("a0000000-0000-0000-0000-000000000002");
    public static readonly Guid StaleUserId = Guid.Parse("a0000000-0000-0000-0000-000000000003");
    public static readonly Guid DeprovisionGapUserId = Guid.Parse("a0000000-0000-0000-0000-000000000004");
    public static readonly Guid ExpiredGrantUserId = Guid.Parse("a0000000-0000-0000-0000-000000000005");
    public static readonly Guid OrgBUserId = Guid.Parse("b0000000-0000-0000-0000-000000000001");

    public static readonly Guid RecruiterRoleOrgA = Guid.Parse("e0000000-0000-0000-0000-000000000001");
    public static readonly Guid RecruiterRoleOrgB = Guid.Parse("e0000000-0000-0000-0000-000000000002");
    public static readonly Guid CandidateReadPermissionId = Guid.Parse("f0000000-0000-0000-0000-000000000001");

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

        foreach (var sql in new[] { SchemaSql, SeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public AccessReviewDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AccessReviewDbContext>().UseNpgsql(ConnectionString).Options);

    // Full column set the UNION of what IdentityDbContext (auth resolution) AND AccessReviewDbContext
    // (report data) both need on the SAME physical tables — Slice-17's Task 8 hit a real bug from an
    // under-specified fixture schema; this fixture is built to avoid that class of bug from the start.
    private const string SchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamp NULL);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true,
            deleted_at timestamp NULL,
            last_login_at timestamp NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            slug text NOT NULL,
            name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE user_roles (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users (id),
            role_id uuid NOT NULL REFERENCES roles (id),
            assigned_at timestamp NOT NULL DEFAULT now(),
            assigned_by uuid NULL,
            company_scope uuid NULL,
            unit_scope uuid NULL,
            expires_at timestamp NULL
        );
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY,
            role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id),
            scope text NOT NULL DEFAULT 'own'
        );
        CREATE TABLE access_reviews (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id),
            reviewer_id uuid NOT NULL REFERENCES users (id),
            reviewed_at timestamp NOT NULL DEFAULT now(),
            user_count int NOT NULL,
            privileged_count int NOT NULL,
            stale_count int NOT NULL,
            deprovision_gap_count int NOT NULL,
            expired_gap_count int NOT NULL,
            notes varchar(2000) NULL,
            created_at timestamp NOT NULL DEFAULT now()
        );
        GRANT SELECT, INSERT, UPDATE, DELETE ON access_reviews TO app_tenant;
        ALTER TABLE access_reviews ENABLE ROW LEVEL SECURITY;
        ALTER TABLE access_reviews FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON access_reviews
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id, name, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', 'Acme Corp', true),
          ('22222222-2222-2222-2222-222222222222', 'Globex Inc', true);

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_active, deleted_at, last_login_at, is_platform_owner, created_at) VALUES
          ('c0000000-0000-0000-0000-000000000001', NULL, 'sub-access-review-platform-owner', 'owner@tims.test', 'Olivia', 'Owner', true, NULL, NULL, true, '2026-01-01T00:00:00Z'),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-access-review-org-user', 'orguser@tims.test', 'Rick', 'Recruiter', true, NULL, now() - interval '1 day', false, '2026-01-01T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-healthy', 'healthy@tims.test', 'Hana', 'Healthy', true, NULL, now() - interval '1 day', false, '2026-01-02T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-never', 'never@tims.test', 'Nate', 'NeverLoggedIn', true, NULL, NULL, false, '2026-01-03T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-stale', 'stale@tims.test', 'Stan', 'Stale', true, NULL, now() - interval '91 days', false, '2026-01-04T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-deprovision', 'deprovision@tims.test', 'Dana', 'Deprovisioned', false, NULL, now() - interval '1 day', false, '2026-01-05T00:00:00Z'),
          ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-expired', 'expired@tims.test', 'Ed', 'ExpiredGrant', true, NULL, now() - interval '1 day', false, '2026-01-06T00:00:00Z'),
          ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'sub-orgb', 'orgb@tims.test', 'Bea', 'OrgB', true, NULL, now() - interval '1 day', false, '2026-01-01T00:00:00Z');

        INSERT INTO roles (id, organization_id, slug, name, is_active) VALUES
          ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter', true),
          ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'recruiter', 'Recruiter', true);

        INSERT INTO permissions (id, module, action) VALUES
          ('f0000000-0000-0000-0000-000000000001', 'candidate', 'read');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('11110000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'own');

        -- healthy: active recruiter, recent login, no expiry — raises NO flags.
        INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by, expires_at) VALUES
          ('22220000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '2026-01-02T00:00:00Z', 'c0000000-0000-0000-0000-000000000001', NULL);

        -- deprovisionGap: inactive but still holds a role.
        INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by, expires_at) VALUES
          ('22220000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', '2026-01-05T00:00:00Z', 'c0000000-0000-0000-0000-000000000001', NULL);

        -- expiredGrant: active, role's expiry is in the past.
        INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by, expires_at) VALUES
          ('22220000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', '2026-01-06T00:00:00Z', 'c0000000-0000-0000-0000-000000000001', now() - interval '1 day');

        -- OrgB user, its own org's role — proves org-scoping in Task 8.
        INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by, expires_at) VALUES
          ('22220000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', '2026-01-01T00:00:00Z', NULL, NULL);
        """;
}

[CollectionDefinition("AccessReview")]
public sealed class AccessReviewCollection : ICollectionFixture<AccessReviewFixture>;
