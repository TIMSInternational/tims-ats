using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests;

/// <summary>
/// Spins up one Postgres container with the identity + RBAC tables the permission check reads
/// (`organizations`, `users`, `roles`, `user_roles`, `permissions`, `role_permissions` — only the
/// columns the EF entities map plus required NOT NULLs) and seeds the WP2.5 scenarios exercised by
/// <see cref="PermissionServiceTests"/> and <see cref="ApiPermissionAuthTests"/>.
///
/// PRE-TENANT / privileged path (no app_tenant role, no RLS): the container's superuser connection
/// is exactly the owner connection the permission service runs on in prod.
///
/// Seeded grants (all in <see cref="OrgA"/>):
///   recruiter  → candidate:read @ organization
///   leader     → performance:read @ team, candidate:read @ team  (widest-scope stack: org &gt; team)
///   legacy     → candidate:read @ all                            (legacy alias → organization)
///   employee   → (no grants)
/// HTTP user (<see cref="HttpUserSub"/>) holds [recruiter, leader].
/// </summary>
public sealed class PermissionFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_rbac";

    public static readonly Guid OrgA = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Role slugs (stable) — the service queries by slug, so the tests reference these directly.
    public const string RecruiterSlug = "recruiter";
    public const string LeaderSlug = "leader";
    public const string EmployeeSlug = "employee";
    public const string LegacySlug = "committee"; // any staff slug; carries the legacy 'all' grant

    // The HTTP-path user whose supabase_user_id == the JWT `sub`.
    public static readonly Guid HttpUserId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public const string HttpUserSub = "sub-rbac-http-user";

    private static readonly Guid RecruiterRoleId = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    private static readonly Guid LeaderRoleId = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    private static readonly Guid EmployeeRoleId = Guid.Parse("d0000000-0000-0000-0000-000000000003");
    private static readonly Guid LegacyRoleId = Guid.Parse("d0000000-0000-0000-0000-000000000004");

    private static readonly Guid CandidateReadPermId = Guid.Parse("e0000000-0000-0000-0000-000000000001");
    private static readonly Guid PerformanceReadPermId = Guid.Parse("e0000000-0000-0000-0000-000000000002");

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
                organization_id uuid NOT NULL,
                slug text NOT NULL,
                name text NOT NULL
            );

            CREATE TABLE user_roles (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES users (id),
                role_id uuid NOT NULL REFERENCES roles (id)
            );

            CREATE TABLE permissions (
                id uuid PRIMARY KEY,
                module text NOT NULL,
                action text NOT NULL
            );

            CREATE TABLE role_permissions (
                id uuid PRIMARY KEY,
                role_id uuid NOT NULL REFERENCES roles (id),
                permission_id uuid NOT NULL REFERENCES permissions (id),
                scope text NOT NULL DEFAULT 'own'
            );
            """;
        await setup.ExecuteNonQueryAsync();

        await using var seed = connection.CreateCommand();
        seed.CommandText =
            """
            INSERT INTO organizations (id, is_active) VALUES (@orgA, true);

            INSERT INTO roles (id, organization_id, slug, name) VALUES
                (@recruiterRole, @orgA, 'recruiter', 'Recruiter'),
                (@leaderRole, @orgA, 'leader', 'Leader'),
                (@employeeRole, @orgA, 'employee', 'Employee'),
                (@legacyRole, @orgA, 'committee', 'Committee');

            INSERT INTO permissions (id, module, action) VALUES
                (@candidateRead, 'candidate', 'read'),
                (@performanceRead, 'performance', 'read');

            INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
                (gen_random_uuid(), @recruiterRole, @candidateRead, 'organization'),
                (gen_random_uuid(), @leaderRole, @performanceRead, 'team'),
                (gen_random_uuid(), @leaderRole, @candidateRead, 'team'),
                (gen_random_uuid(), @legacyRole, @candidateRead, 'all');

            INSERT INTO users (id, organization_id, supabase_user_id, email, is_platform_owner, is_active) VALUES
                (@httpUser, @orgA, @httpUserSub, 'rbac@tims.test', false, true);

            INSERT INTO user_roles (id, user_id, role_id) VALUES
                (gen_random_uuid(), @httpUser, @recruiterRole),
                (gen_random_uuid(), @httpUser, @leaderRole);
            """;
        seed.Parameters.AddWithValue("orgA", OrgA);
        seed.Parameters.AddWithValue("recruiterRole", RecruiterRoleId);
        seed.Parameters.AddWithValue("leaderRole", LeaderRoleId);
        seed.Parameters.AddWithValue("employeeRole", EmployeeRoleId);
        seed.Parameters.AddWithValue("legacyRole", LegacyRoleId);
        seed.Parameters.AddWithValue("candidateRead", CandidateReadPermId);
        seed.Parameters.AddWithValue("performanceRead", PerformanceReadPermId);
        seed.Parameters.AddWithValue("httpUser", HttpUserId);
        seed.Parameters.AddWithValue("httpUserSub", HttpUserSub);
        await seed.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }
}
