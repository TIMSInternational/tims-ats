using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests;

/// <summary>
/// Shares ONE Postgres container across the whole identity plane (identity resolution, RBAC
/// permissions, and external `tims_` API keys) to remove the startup-race flake that appeared when
/// each fixture span up its own container concurrently.
///
/// The three seeds carry fixed GUIDs that collide semantically across planes (e.g. the identity
/// OrgA == the api-key ActiveOrg; the RBAC OrgA == the api-key SuspendedOrg), so they CANNOT share a
/// single database. Instead this fixture creates three separate databases inside the one container —
/// <c>tims_identity</c>, <c>tims_rbac</c>, <c>tims_apikeys</c> — and delegates each schema+seed to
/// the relocated <c>SeedAsync</c> of its owning fixture, preserving every constant and seed row.
///
/// PRE-TENANT / privileged path (no app_tenant role, no RLS, no TenantScope): the container's
/// superuser connection is exactly the owner connection each resolver runs on in prod.
/// </summary>
public sealed class IdentitySchemaFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase("tims_shared")
        .Build();

    public string IdentityConnectionString { get; private set; } = string.Empty;

    public string RbacConnectionString { get; private set; } = string.Empty;

    public string ApiKeyConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        var baseCs = _container.GetConnectionString();

        // CREATE DATABASE cannot run in a transaction/batch — issue each as its own command.
        await using (var connection = new NpgsqlConnection(baseCs))
        {
            await connection.OpenAsync();
            foreach (var database in new[] { "tims_identity", "tims_rbac", "tims_apikeys" })
            {
                await using var create = connection.CreateCommand();
                create.CommandText = $"CREATE DATABASE {database};";
                await create.ExecuteNonQueryAsync();
            }
        }

        IdentityConnectionString = ForDatabase(baseCs, "tims_identity");
        RbacConnectionString = ForDatabase(baseCs, "tims_rbac");
        ApiKeyConnectionString = ForDatabase(baseCs, "tims_apikeys");

        await IdentityFixture.SeedAsync(IdentityConnectionString);
        await PermissionFixture.SeedAsync(RbacConnectionString);
        await ApiKeyFixture.SeedAsync(ApiKeyConnectionString);
    }

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }

    private static string ForDatabase(string baseConnectionString, string database) =>
        new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = database }.ConnectionString;
}
