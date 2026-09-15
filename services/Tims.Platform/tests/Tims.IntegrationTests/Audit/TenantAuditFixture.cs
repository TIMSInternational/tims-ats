using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Audit;

namespace Tims.IntegrationTests.Audit;

public sealed class TenantAuditFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_tenant_audit";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public const string PlatformOwnerSub = "sub-audit-platform-owner";
    public const string OrgUserSub = "sub-audit-org-user";

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

    public TenantAuditDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<TenantAuditDbContext>().UseNpgsql(ConnectionString).Options);

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
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            slug text NOT NULL
        );
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (id uuid PRIMARY KEY, role_id uuid NOT NULL, permission_id uuid NOT NULL, scope text NOT NULL);
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

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', NULL, 'sub-audit-platform-owner', 'owner@tims.test', 'Olivia', 'Owner', NULL, true, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-audit-org-user', 'orguser@tims.test', 'Rick', 'Recruiter', NULL, false, true);
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name) VALUES
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-audit-denied', 'denied@tims.test', 'No', 'Grant');
        INSERT INTO roles (id, organization_id, slug) VALUES
          ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','hr_admin');
        INSERT INTO user_roles (id,user_id,role_id) VALUES
          ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001');
        INSERT INTO permissions (id,module,action) VALUES
          ('e0000000-0000-0000-0000-000000000001','audit','read'),
          ('e0000000-0000-0000-0000-000000000002','audit','export');
        INSERT INTO role_permissions (id,role_id,permission_id,scope) VALUES
          ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','organization'),
          ('f0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','organization');
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name) VALUES
          ('c0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','sub-audit-read-only','reader@tims.test','Read','Only');
        INSERT INTO roles (id, organization_id, slug) VALUES
          ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','recruiter');
        INSERT INTO user_roles (id,user_id,role_id) VALUES
          ('b0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000002');
        INSERT INTO role_permissions (id,role_id,permission_id,scope) VALUES
          ('f0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001','organization');
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
        GRANT SELECT ON audit_logs, users TO app_tenant;
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        ALTER TABLE users FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON users
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON audit_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string AuditSeedSql =
        """
        INSERT INTO audit_logs (id, organization_id, actor_id, action, entity, created_at) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'login_failed', 'auth', '2026-07-20T10:00:00Z'),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'access', 'candidate', '2026-07-21T10:00:00Z'),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'access', 'candidate', '2026-07-21T10:00:00Z'),
          ('d0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', NULL, 'access', 'foreign-only', '2026-07-19T10:00:00Z'),
          ('d0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', NULL, 'access', 'foreign-only', '2026-07-19T10:00:00Z');
        INSERT INTO audit_logs (id, organization_id, actor_id, action, entity, created_at)
          SELECT gen_random_uuid(), '22222222-2222-2222-2222-222222222222', NULL, 'access', 'group-' || n, '2026-07-19T10:00:00Z' FROM generate_series(1,60) n;
        INSERT INTO audit_logs (id, organization_id, action, entity, entity_id, changes, metadata, created_at)
          SELECT gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'bulk', 'export-cap', n::text, '{"secret":"hidden"}', '{"secret":"hidden"}', timestamp '2026-07-01T10:00:00' + n * interval '1 second' FROM generate_series(1,10005) n;
        INSERT INTO audit_logs (id, organization_id, action, entity) VALUES
          ('d0000000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','=SUM(1,2)','csv-probe');
        UPDATE audit_logs SET entity_id = 'José <&>', created_at = '2026-08-01' WHERE entity = 'csv-probe';
        INSERT INTO audit_logs (id, organization_id, action, entity, entity_id, created_at) VALUES
          ('d0000000-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','page-test','history','pagination','2026-07-01'),
          ('d0000000-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111','page-test','history','pagination','2026-07-02'),
          ('d0000000-0000-0000-0000-000000000012','11111111-1111-1111-1111-111111111111','page-test','history','pagination','2026-07-02'),
          ('d0000000-0000-0000-0000-000000000013','11111111-1111-1111-1111-111111111111','cross-page','cross-page','cross-page','2026-09-01'),
          ('d0000000-0000-0000-0000-000000000014','11111111-1111-1111-1111-111111111111','cross-page','cross-page','cross-page','2026-09-02'),
          ('d0000000-0000-0000-0000-000000000015','11111111-1111-1111-1111-111111111111','cross-page','cross-page','cross-page','2026-09-03');
        UPDATE audit_logs SET user_id = actor_id, entity_id = 'record-1',
          changes = '{"before":{"status":"old"},"after":{"status":"new"}}',
          metadata = '{"source":"test"}', ip_address = '127.0.0.1', user_agent = 'audit-fixture'
          WHERE id = 'd0000000-0000-0000-0000-000000000001';
        INSERT INTO audit_logs (id, organization_id, actor_id, action, entity, created_at) VALUES
          ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
           'c0000000-0000-0000-0000-000000000001', 'test', 'foreign-reference', '2026-07-20T10:00:00Z');
        """;
}

[CollectionDefinition("TenantAudit")]
public sealed class TenantAuditCollection : ICollectionFixture<TenantAuditFixture>;
