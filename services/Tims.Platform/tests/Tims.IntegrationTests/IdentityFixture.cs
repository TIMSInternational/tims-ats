using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// Spins up one Postgres container with a MINIMAL hand-authored schema for the identity plane
/// (`users`, `roles`, `user_roles` — only the columns <see cref="IdentityDbContext"/> maps plus
/// required NOT NULLs) and seeds the scenarios exercised by <see cref="IdentityResolutionTests"/>.
///
/// This is the PRE-TENANT / privileged path, so — unlike <c>RlsFixture</c> — there is no
/// app_tenant role, no RLS, and no TenantScope: the container's superuser connection is exactly
/// the owner connection the resolver runs on in prod.
/// </summary>
public sealed class IdentityFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_identity";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");

    // Users
    public static readonly Guid ActiveStaffUserId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    public static readonly Guid PlatformOwnerUserId = Guid.Parse("a0000000-0000-0000-0000-000000000002");
    public static readonly Guid InactiveUserId = Guid.Parse("a0000000-0000-0000-0000-000000000003");
    public static readonly Guid OrglessOwnerUserId = Guid.Parse("a0000000-0000-0000-0000-000000000004");

    public const string ActiveStaffSub = "sub-active-staff";
    public const string PlatformOwnerSub = "sub-platform-owner";
    public const string InactiveSub = "sub-inactive";
    public const string OrglessOwnerSub = "sub-orgless-owner";
    public const string UnknownSub = "sub-does-not-exist";

    // Roles
    private static readonly Guid RecruiterRoleId = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private static readonly Guid ExternalRoleId = Guid.Parse("b0000000-0000-0000-0000-000000000002");

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

        await using var setup = connection.CreateCommand();
        setup.CommandText =
            """
            CREATE TABLE organizations (
                id uuid PRIMARY KEY,
                is_active boolean NOT NULL DEFAULT true
            );

            CREATE TABLE users (
                id uuid PRIMARY KEY,
                organization_id uuid NULL REFERENCES organizations (id),
                supabase_user_id text NOT NULL UNIQUE,
                email text NOT NULL,
                is_platform_owner boolean NOT NULL DEFAULT false,
                is_active boolean NOT NULL DEFAULT true
            );

            CREATE TABLE roles (
                id uuid PRIMARY KEY,
                organization_id uuid NULL,
                slug text NOT NULL,
                name text NOT NULL
            );

            CREATE TABLE user_roles (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES users (id),
                role_id uuid NOT NULL REFERENCES roles (id)
            );
            """;
        await setup.ExecuteNonQueryAsync();

        await using var seed = connection.CreateCommand();
        seed.CommandText =
            """
            INSERT INTO organizations (id, is_active) VALUES (@orgA, true);

            INSERT INTO roles (id, organization_id, slug, name) VALUES
                (@recruiterRole, @orgA, 'recruiter', 'Recruiter'),
                (@externalRole, @orgA, 'external', 'External Integration');

            INSERT INTO users (id, organization_id, supabase_user_id, email, is_platform_owner, is_active) VALUES
                (@activeStaff, @orgA, @activeStaffSub, 'staff@tims.test', false, true),
                (@platformOwner, @orgA, @platformOwnerSub, 'owner@tims.test', true, true),
                (@inactive, @orgA, @inactiveSub, 'inactive@tims.test', false, false),
                (@orglessOwner, NULL, @orglessOwnerSub, 'root@tims.test', true, true);

            -- Active staff holds BOTH recruiter (staff) and external (non-staff, must be filtered).
            INSERT INTO user_roles (id, user_id, role_id) VALUES
                (gen_random_uuid(), @activeStaff, @recruiterRole),
                (gen_random_uuid(), @activeStaff, @externalRole),
                -- Owner carries a recruiter grant that must collapse to ['platform_owner'].
                (gen_random_uuid(), @platformOwner, @recruiterRole),
                (gen_random_uuid(), @inactive, @recruiterRole);
            """;
        seed.Parameters.AddWithValue("orgA", OrgA);
        seed.Parameters.AddWithValue("recruiterRole", RecruiterRoleId);
        seed.Parameters.AddWithValue("externalRole", ExternalRoleId);
        seed.Parameters.AddWithValue("activeStaff", ActiveStaffUserId);
        seed.Parameters.AddWithValue("platformOwner", PlatformOwnerUserId);
        seed.Parameters.AddWithValue("inactive", InactiveUserId);
        seed.Parameters.AddWithValue("orglessOwner", OrglessOwnerUserId);
        seed.Parameters.AddWithValue("activeStaffSub", ActiveStaffSub);
        seed.Parameters.AddWithValue("platformOwnerSub", PlatformOwnerSub);
        seed.Parameters.AddWithValue("inactiveSub", InactiveSub);
        seed.Parameters.AddWithValue("orglessOwnerSub", OrglessOwnerSub);
        await seed.ExecuteNonQueryAsync();
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
