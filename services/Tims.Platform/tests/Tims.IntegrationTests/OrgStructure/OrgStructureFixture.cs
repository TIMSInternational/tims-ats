using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.OrgStructure;

/// <summary>
/// Two tenants with the production RLS shape (baseline prod-public-schema.sql) on every table the org
/// structure slice and the vacancy-scoped approver directory touch: direct organization_id predicates on
/// users/roles/companies/business_units/teams/user_business_units/vacancies/audit_logs (USING + WITH CHECK),
/// parent subqueries on user_teams (teams), user_roles and role_permissions (roles). The app reads and
/// writes as app_tenant, so these policies are live under test.
/// </summary>
public sealed class OrgStructureFixture : IAsyncLifetime
{
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid CompanyA = Guid.Parse("d1000000-0000-0000-0000-000000000001");

    public static readonly Guid Admin = Guid.Parse("c1000000-0000-0000-0000-000000000001");
    public static readonly Guid Hr = Guid.Parse("c1000000-0000-0000-0000-000000000002");
    public static readonly Guid Recruiter = Guid.Parse("c1000000-0000-0000-0000-000000000003");
    public static readonly Guid LeaderA = Guid.Parse("c1000000-0000-0000-0000-000000000004");
    public static readonly Guid LeaderB = Guid.Parse("c1000000-0000-0000-0000-000000000005");
    public static readonly Guid Hrbp = Guid.Parse("c1000000-0000-0000-0000-000000000006");
    public static readonly Guid Employee = Guid.Parse("c1000000-0000-0000-0000-000000000007");
    public static readonly Guid Inactive = Guid.Parse("c1000000-0000-0000-0000-000000000008");
    public static readonly Guid Assignee = Guid.Parse("c1000000-0000-0000-0000-000000000009");
    public static readonly Guid ForeignHr = Guid.Parse("c2000000-0000-0000-0000-000000000001");

    public static readonly Guid Unit1 = Guid.Parse("b5000000-0000-0000-0000-000000000001");
    public static readonly Guid Unit2 = Guid.Parse("b5000000-0000-0000-0000-000000000002");
    public static readonly Guid ForeignUnit = Guid.Parse("b5000000-0000-0000-0000-000000000009");
    public static readonly Guid Team1 = Guid.Parse("7e000000-0000-0000-0000-000000000001");
    public static readonly Guid Team2 = Guid.Parse("7e000000-0000-0000-0000-000000000002");
    public static readonly Guid ForeignTeam = Guid.Parse("7e000000-0000-0000-0000-000000000009");
    public static readonly Guid Vacancy1 = Guid.Parse("5a000000-0000-0000-0000-000000000001");
    public static readonly Guid DeletedVacancy = Guid.Parse("5a000000-0000-0000-0000-000000000002");
    public static readonly Guid ForeignVacancy = Guid.Parse("5a000000-0000-0000-0000-000000000009");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres").WithDatabase("tims_org_structure").Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public static string Sub(Guid user) => $"sub-{user}";

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = SchemaSql + SeedSql;
        await command.ExecuteNonQueryAsync();
    }

    public async Task<long> CountAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return Convert.ToInt64(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    public async Task<object?> ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteScalarAsync();
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    private const string Guc = "NULLIF(current_setting('app.current_org_id', true), '')::uuid";

    private const string SchemaSql =
        $$"""
        CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
        GRANT app_tenant TO postgres;
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamp NULL);
        CREATE TABLE companies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE business_units (id uuid PRIMARY KEY, organization_id uuid NOT NULL, company_id uuid NOT NULL REFERENCES companies (id),
            name text NOT NULL, code text NULL, parent_id uuid NULL, settings jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
            created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL);
        CREATE TABLE users (id uuid PRIMARY KEY, organization_id uuid NULL REFERENCES organizations (id), supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL, first_name text NOT NULL, last_name text NOT NULL, avatar text NULL, phone text NULL,
            is_platform_owner boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, deleted_at timestamp NULL,
            business_unit_id uuid NULL, updated_at timestamp NOT NULL DEFAULT now());
        CREATE TABLE teams (id uuid PRIMARY KEY, organization_id uuid NOT NULL, business_unit_id uuid NOT NULL REFERENCES business_units (id),
            name text NOT NULL, leader_id uuid NULL REFERENCES users (id), settings jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
            created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL);
        CREATE TABLE user_teams (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), team_id uuid NOT NULL REFERENCES teams (id),
            role text NOT NULL DEFAULT 'member', joined_at timestamp NOT NULL DEFAULT now(), UNIQUE (user_id, team_id));
        CREATE TABLE user_business_units (id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users (id),
            business_unit_id uuid NOT NULL REFERENCES business_units (id), created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL,
            UNIQUE (user_id, business_unit_id));
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, team_id uuid NULL, business_unit_id uuid NULL,
            assigned_to uuid NULL, created_by uuid NOT NULL, deleted_at timestamp NULL);
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL);
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id), permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE audit_logs (id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NULL, actor_id uuid NULL, action text NOT NULL,
            entity text NOT NULL, entity_id text NULL, changes jsonb NULL, metadata jsonb NULL, ip_address text NULL, user_agent text NULL,
            created_at timestamp NOT NULL DEFAULT now());
        GRANT SELECT ON organizations, companies, vacancies, roles, permissions, role_permissions, user_roles TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON business_units, teams, user_teams, user_business_units, users TO app_tenant;
        GRANT SELECT, INSERT ON audit_logs TO app_tenant;
        DO $$ DECLARE t text; BEGIN
          FOREACH t IN ARRAY ARRAY['users','roles','companies','business_units','teams','user_business_units','vacancies','audit_logs'] LOOP
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t, t);
            EXECUTE format($f$CREATE POLICY tenant_isolation ON %I USING (organization_id = {{Guc}}) WITH CHECK (organization_id = {{Guc}})$f$, t);
          END LOOP; END $$;
        ALTER TABLE user_teams ENABLE ROW LEVEL SECURITY; ALTER TABLE user_teams FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON user_teams USING (EXISTS (SELECT 1 FROM teams par WHERE par.id = user_teams.team_id AND par.organization_id = {{Guc}}))
            WITH CHECK (EXISTS (SELECT 1 FROM teams par WHERE par.id = user_teams.team_id AND par.organization_id = {{Guc}}));
        ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON role_permissions USING (EXISTS (SELECT 1 FROM roles par WHERE par.id = role_permissions.role_id AND par.organization_id = {{Guc}}));
        ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY; ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON user_roles USING (EXISTS (SELECT 1 FROM roles par WHERE par.id = user_roles.role_id AND par.organization_id = {{Guc}}));
        """;

    // Grants mirror seed-access-matrix.ts for the actions exercised: hr_admin holds organization:* and
    // vacancy:approve at organization scope; recruiter vacancy:create; leader vacancy:approve at TEAM scope;
    // hrbp vacancy:approve at UNIT scope; employee nothing relevant.
    private const string SeedSql =
        """
        INSERT INTO organizations (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Acme'), ('22222222-2222-2222-2222-222222222222', 'Globex');
        INSERT INTO companies (id, organization_id, name) VALUES
          ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Acme SAS'),
          ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Globex SA');
        INSERT INTO permissions (id, module, action) VALUES
          ('e1000000-0000-0000-0000-000000000001', 'organization', 'read'), ('e1000000-0000-0000-0000-000000000002', 'organization', 'create'),
          ('e1000000-0000-0000-0000-000000000003', 'organization', 'update'), ('e1000000-0000-0000-0000-000000000004', 'vacancy', 'create'),
          ('e1000000-0000-0000-0000-000000000005', 'vacancy', 'approve');
        INSERT INTO roles (id, organization_id, slug) VALUES
          ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'super_admin'),
          ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'hr_admin'),
          ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'recruiter'),
          ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'leader'),
          ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'hrbp'),
          ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'employee'),
          ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'hr_admin');
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'organization'),
          ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'organization'),
          ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003', 'organization'),
          ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000005', 'organization'),
          ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004', 'organization'),
          ('f1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000005', 'team'),
          ('f1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004', 'team'),
          ('f1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005', 'unit'),
          ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'organization'),
          ('f2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 'organization');
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_active) VALUES
          ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000001', 'ada@acme.test', 'Ada', 'Admin', true),
          ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000002', 'hugo@acme.test', 'Hugo', 'Hr', true),
          ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000003', 'rita@acme.test', 'Rita', 'Recruiter', true),
          ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000004', 'lia@acme.test', 'Lia', 'LeaderA', true),
          ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000005', 'leo@acme.test', 'Leo', 'LeaderB', true),
          ('c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000006', 'bea@acme.test', 'Bea', 'Hrbp', true),
          ('c1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000007', 'eli@acme.test', 'Eli', 'Employee', true),
          ('c1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000008', 'ivan@acme.test', 'Ivan', 'Inactive', false),
          ('c1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'sub-c1000000-0000-0000-0000-000000000009', 'ana@acme.test', 'Ana', 'Assignee', true),
          ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'sub-c2000000-0000-0000-0000-000000000001', 'fiona@globex.test', 'Fiona', 'Foreign', true);
        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
          ('b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002'),
          ('b1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003'),
          ('b1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004'),
          ('b1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000004'),
          ('b1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000005'),
          ('b1000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000006'),
          ('b1000000-0000-0000-0000-000000000008', 'c1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000002'),
          ('b1000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000004'),
          ('b2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');
        INSERT INTO business_units (id, organization_id, company_id, name, updated_at) VALUES
          ('b5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001', 'Comercial', now()),
          ('b5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001', 'Operaciones', now()),
          ('b5000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'd2000000-0000-0000-0000-000000000001', 'Foreign unit', now());
        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, updated_at) VALUES
          ('7e000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b5000000-0000-0000-0000-000000000001', 'Ventas', 'c1000000-0000-0000-0000-000000000004', now()),
          ('7e000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b5000000-0000-0000-0000-000000000002', 'Logistica', 'c1000000-0000-0000-0000-000000000005', now()),
          ('7e000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'b5000000-0000-0000-0000-000000000009', 'Foreign team', 'c2000000-0000-0000-0000-000000000001', now());
        INSERT INTO user_business_units (id, organization_id, user_id, business_unit_id, updated_at) VALUES
          ('9b000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000006', 'b5000000-0000-0000-0000-000000000001', now());
        INSERT INTO vacancies (id, organization_id, team_id, business_unit_id, assigned_to, created_by, deleted_at) VALUES
          ('5a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '7e000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000003', NULL),
          ('5a000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '7e000000-0000-0000-0000-000000000001', NULL, NULL, 'c1000000-0000-0000-0000-000000000003', '2026-09-01'),
          ('5a000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', '7e000000-0000-0000-0000-000000000009', NULL, NULL, 'c2000000-0000-0000-0000-000000000001', NULL);
        """;
}

[CollectionDefinition("OrgStructure")]
public sealed class OrgStructureCollection : ICollectionFixture<OrgStructureFixture>;
