using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.AssessmentTypes;

/// <summary>
/// F13 Testcontainers fixture: one real Postgres with the Prisma-shaped <c>assessment_types</c> (real
/// <c>(organization_id, code)</c> unique INDEX, as <c>prisma db push</c> emits it) + <c>audit_logs</c>, both under the
/// production RLS mechanism (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE RLS, fail-closed
/// <c>tenant_isolation</c> on <c>organization_id</c>), plus the identity/RBAC plane the staff gate reads.
///
/// Principals (OrgA unless noted): Admin = assessment create+update @ organization; Narrow = create+update @ team
/// (fails the org-scope requirement → 403); ReadOnly = assessment read only (→ 403); OrgBAdmin = OrgB admin
/// (cross-org). Seeded types: OrgA "Existente" (duplicate-name target), OrgA "Retirado" (DEACTIVATED — its name is
/// free to reuse, its code is not) and one OrgB type (cross-org target).
/// </summary>
public sealed class AssessmentTypeWriteFixture : IAsyncLifetime
{
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid AdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid ExistingTypeId = Guid.Parse("7a000000-0000-0000-0000-000000000001");
    public static readonly Guid OrgBTypeId = Guid.Parse("7a000000-0000-0000-0000-0000000000b0");
    public static readonly Guid RetiredTypeId = Guid.Parse("7a000000-0000-0000-0000-000000000002");

    public const string AdminSub = "sub-atw-admin";
    public const string NarrowSub = "sub-atw-narrow";
    public const string ReadOnlySub = "sub-atw-read";
    public const string OrgBAdminSub = "sub-atw-orgb";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .WithDatabase("tims_assessment_type_write")
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        foreach (var sql in new[] { "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;", SchemaSql, SeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public async Task<T?> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        var result = await command.ExecuteScalarAsync();
        return result is null or DBNull ? default : (T)result;
    }

    public Task<long> CountAuditAsync(Guid entityId, string action) => CountAsync(
        "SELECT COUNT(*) FROM audit_logs WHERE entity = 'assessment_type' AND entity_id = @e AND action = @a",
        ("e", entityId.ToString()), ("a", action));

    public async Task<long> CountAsync(string sql, params (string Name, object Value)[] parameters) =>
        await ScalarAsync<long>(sql, parameters);

    private const string SchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY, organization_id uuid NULL, supabase_user_id text NOT NULL UNIQUE, email text NOT NULL,
            first_name text NOT NULL, last_name text NOT NULL, is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');

        CREATE TABLE assessment_types (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, code text NOT NULL,
            description text NULL, duration integer NULL, is_active boolean NOT NULL DEFAULT true, config jsonb NULL,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL);
        CREATE UNIQUE INDEX assessment_types_organization_id_code_key ON assessment_types (organization_id, code);
        CREATE INDEX assessment_types_organization_id_idx ON assessment_types (organization_id);

        CREATE TABLE audit_logs (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations (id), user_id uuid NULL,
            actor_id uuid NULL, action text NOT NULL, entity text NOT NULL, entity_id text NULL, changes jsonb NULL,
            metadata jsonb NULL, ip_address text NULL, user_agent text NULL,
            created_at timestamp(3) NOT NULL DEFAULT now());

        GRANT SELECT ON users TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_types TO app_tenant;
        GRANT SELECT, INSERT ON audit_logs TO app_tenant;
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;            ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE assessment_types ENABLE ROW LEVEL SECURITY; ALTER TABLE assessment_types FORCE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;       ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON users USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON assessment_types
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON audit_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id) VALUES ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'viewer', 'Viewer'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'recruiter', 'OrgB Recruiter');
        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'assessment', 'create'),
          ('b0000000-0000-0000-0000-000000000002', 'assessment', 'update'),
          ('b0000000-0000-0000-0000-000000000003', 'assessment', 'read');
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'team'),
          ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'organization'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization');
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-atw-admin',  'admin@tims.test',  'Ana', 'Admin'),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-atw-narrow', 'narrow@tims.test', 'Leo', 'Narrow'),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-atw-read',   'read@tims.test',   'Rea', 'Reader'),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-atw-orgb',   'orgb@tims.test',   'Bob', 'OrgB');
        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');
        INSERT INTO assessment_types (id, organization_id, name, code, is_active, updated_at) VALUES
          ('7a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Existente', 'existente', true, '2026-05-01 00:00:00'),
          ('7a000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Retirado', 'retirado', false, '2026-05-01 00:00:00'),
          ('7a000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'Tipo OrgB', 'tipo_orgb', true, '2026-05-01 00:00:00');
        """;
}
