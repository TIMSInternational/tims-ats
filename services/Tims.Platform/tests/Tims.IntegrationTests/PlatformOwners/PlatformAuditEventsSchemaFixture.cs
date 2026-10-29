using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Fx;

namespace Tims.IntegrationTests.PlatformOwners;

/// <summary>
/// WP-03 PR-5a schema proof for the C#-owned, org-less, append-only <c>platform_audit_events</c> table.
/// One Postgres container; every test gets a FRESH database prepared like production before the DDL runs:
/// the tenant roles exist (<c>app_tenant</c>, plus Supabase's <c>anon</c>/<c>authenticated</c>), Supabase's
/// default privileges hand every new public table to those roles, and the shared
/// <c>public.tims_append_only_guard()</c> exists exactly as in the prod baseline. The migration must therefore
/// actively take the access away and must reference the guard rather than define it.
///
/// Two apply paths are covered: the EF migration (found by its id suffix, so this file compiles before the
/// migration exists) and the hand-applied script in <c>services/Tims.Platform/db/manual/</c> that the owner runs.
/// </summary>
public sealed class PlatformAuditEventsSchemaFixture : IAsyncLifetime
{
    public const string MigrationSuffix = "_platform_audit_events";

    private const string LoginRole = "postgres";
    private const string Password = "postgres";

    // Body copied from packages/db/baseline/prod-public-schema.sql (tims_append_only_guard).
    private const string GuardFunctionSql =
        """
        CREATE FUNCTION public.tims_append_only_guard() RETURNS trigger
            LANGUAGE plpgsql
            AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
                USING ERRCODE = 'insufficient_privilege';
        END;
        $$;
        """;

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase("tims_pae_admin")
        .Build();

    private int _databaseCounter;

    public string AdminConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        AdminConnectionString = _container.GetConnectionString();
        await ExecAsync(
            AdminConnectionString,
            """
            CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
            CREATE ROLE anon NOLOGIN NOBYPASSRLS;
            CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
            GRANT app_tenant, anon, authenticated TO postgres;
            """);
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    /// <summary>A fresh database with the production preconditions; <paramref name="withGuard"/> false omits the
    /// shared guard function so the precheck can be proven.</summary>
    public async Task<string> FreshDatabaseAsync(bool withGuard = true)
    {
        var name = $"tims_pae_{Interlocked.Increment(ref _databaseCounter)}";
        await ExecAsync(AdminConnectionString, $"CREATE DATABASE {name};");
        var connectionString = new NpgsqlConnectionStringBuilder(AdminConnectionString) { Database = name }.ConnectionString;
        await ExecAsync(
            connectionString,
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_tenant, anon, authenticated;");
        if (withGuard)
        {
            await ExecAsync(connectionString, GuardFunctionSql);
        }

        return connectionString;
    }

    /// <summary>Applies the EF migration whose id ends with <see cref="MigrationSuffix"/> through its own context.</summary>
    public static async Task ApplyEfMigrationAsync(string connectionString)
    {
        var contextType = FindMigrationContext();
        var builderType = typeof(DbContextOptionsBuilder<>).MakeGenericType(contextType);
        var builder = (DbContextOptionsBuilder)Activator.CreateInstance(builderType)!;
        builder.UseNpgsql(connectionString);
        await using var context = (DbContext)Activator.CreateInstance(contextType, builder.Options)!;
        await context.Database.MigrateAsync();
    }

    public static Type FindMigrationContext()
    {
        var assembly = typeof(FxRateDbContext).Assembly;
        var migration = assembly.GetTypes().FirstOrDefault(t =>
            t.GetCustomAttribute<MigrationAttribute>()?.Id.EndsWith(MigrationSuffix, StringComparison.Ordinal) == true);
        Assert.True(
            migration is not null,
            $"no EF migration with id '*{MigrationSuffix}' in {assembly.GetName().Name}");
        var contextType = migration!.GetCustomAttribute<DbContextAttribute>()?.ContextType;
        Assert.True(contextType is not null, $"migration {migration.Name} has no [DbContext] attribute");
        return contextType!;
    }

    public static string ManualScriptPath(bool rollback = false)
    {
        var manualDir = Path.Combine(FindRepoRoot(), "services", "Tims.Platform", "db", "manual");
        var forward = Directory.GetFiles(manualDir, $"*{MigrationSuffix}.sql")
            .Where(f => !f.EndsWith(".ROLLBACK.sql", StringComparison.Ordinal))
            .ToArray();
        Assert.True(forward.Length == 1, $"expected one *{MigrationSuffix}.sql in {manualDir}, found {forward.Length}");
        return rollback ? forward[0][..^".sql".Length] + ".ROLLBACK.sql" : forward[0];
    }

    public static async Task ExecAsync(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    public static async Task<T?> ScalarAsync<T>(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        var value = await command.ExecuteScalarAsync();
        return value is null or DBNull ? default : (T)value;
    }

    public static async Task<List<string>> ColumnAsync(string connectionString, string sql)
    {
        var rows = new List<string>();
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return rows;
    }

    private static string FindRepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "services", "Tims.Platform", "db", "manual")))
            {
                return dir.FullName;
            }
        }

        throw new DirectoryNotFoundException(
            "repo root (services/Tims.Platform/db/manual) not found from " + AppContext.BaseDirectory);
    }
}

[CollectionDefinition(nameof(PlatformAuditEventsSchemaCollection))]
public sealed class PlatformAuditEventsSchemaCollection : ICollectionFixture<PlatformAuditEventsSchemaFixture>;
