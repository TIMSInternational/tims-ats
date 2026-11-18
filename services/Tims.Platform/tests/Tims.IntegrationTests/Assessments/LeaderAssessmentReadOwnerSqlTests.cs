using Npgsql;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// Round 11 (e2e H9, owner default D6): the owner SQL <c>db/owner/leader_assessment_read.sql</c>, applied verbatim the
/// way <c>psql -v org_id=…</c> applies it, gives the named organization's seeded <c>leader</c> role
/// <c>assessment:read</c> at team scope, touches no other organization, is idempotent, and leaves an existing
/// assessment:read grant at its own scope. The tables carry the production unique constraints
/// (<c>permissions(module, action)</c>, <c>role_permissions(role_id, permission_id)</c>).
/// </summary>
public sealed class LeaderAssessmentReadOwnerSqlTests
{
    private static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid OrgC = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private const string Schema =
        """
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL,
            UNIQUE (organization_id, slug));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL, description text NULL,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (module, action));
        CREATE TABLE role_permissions (id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own',
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (role_id, permission_id));
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'leader', 'Líder'),
          ('a0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'employee', 'Colaborador'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'leader', 'Líder'),
          ('a0000000-0000-0000-0000-0000000000c1', '33333333-3333-3333-3333-333333333333', 'leader', 'Líder');
        INSERT INTO permissions (id, module, action) VALUES ('b0000000-0000-0000-0000-000000000001', 'vacancy', 'read');
        """;

    private static string OwnerSql =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "owner-sql", "leader_assessment_read.sql"));

    [Fact]
    public async Task Grants_the_named_organizations_leader_assessment_read_at_team_scope_only_and_is_idempotent()
    {
        await using var database = await ProviderTestDatabase.StartAsync("r11_leader_grant");
        await ExecuteAsync(database, Schema);

        await ApplyOwnerSqlAsync(database, OrgA);
        await ApplyOwnerSqlAsync(database, OrgA); // a re-run changes nothing

        Assert.Equal(["read|team"], await AssessmentGrantsAsync(database, OrgA, "leader"));
        Assert.Empty(await AssessmentGrantsAsync(database, OrgA, "employee"));
        Assert.Empty(await AssessmentGrantsAsync(database, OrgB, "leader")); // another organization is untouched
        Assert.Equal(1L, await ScalarAsync(database, "SELECT count(*) FROM permissions WHERE module = 'assessment'"));
    }

    [Fact]
    public async Task Keeps_an_existing_assessment_read_grant_at_its_own_scope()
    {
        await using var database = await ProviderTestDatabase.StartAsync("r11_leader_keep");
        await ExecuteAsync(database, Schema + """
            INSERT INTO permissions (id, module, action) VALUES ('b0000000-0000-0000-0000-000000000002', 'assessment', 'read');
            INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
              ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-000000000002', 'organization');
            """);

        await ApplyOwnerSqlAsync(database, OrgC);

        Assert.Equal(["read|organization"], await AssessmentGrantsAsync(database, OrgC, "leader"));
    }

    // psql substitutes :'org_id' with the quoted literal; nothing else in the file is a psql variable.
    private static Task ApplyOwnerSqlAsync(ProviderTestDatabase database, Guid organizationId)
    {
        var sql = OwnerSql;
        Assert.Equal(2, sql.Split(":'org_id'").Length - 1);
        return ExecuteAsync(database, sql.Replace(":'org_id'", $"'{organizationId}'", StringComparison.Ordinal));
    }

    private static async Task<List<string>> AssessmentGrantsAsync(ProviderTestDatabase database, Guid org, string slug)
    {
        await using var connection = new NpgsqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT p.action || '|' || rp.scope FROM roles r JOIN role_permissions rp ON rp.role_id = r.id "
            + "JOIN permissions p ON p.id = rp.permission_id AND p.module = 'assessment' "
            + "WHERE r.organization_id = @o AND r.slug = @s ORDER BY 1", connection);
        command.Parameters.AddWithValue("o", org);
        command.Parameters.AddWithValue("s", slug);
        var grants = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            grants.Add(reader.GetString(0));
        }

        return grants;
    }

    private static async Task<object?> ScalarAsync(ProviderTestDatabase database, string sql)
    {
        await using var connection = new NpgsqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteScalarAsync();
    }

    private static async Task ExecuteAsync(ProviderTestDatabase database, string sql)
    {
        await using var connection = new NpgsqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
