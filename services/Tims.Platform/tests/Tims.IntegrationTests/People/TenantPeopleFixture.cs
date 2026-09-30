using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.People;

/// <summary>
/// Two tenants with the production RLS shape on the identity tables (users/roles direct predicates,
/// user_roles/role_permissions parent subqueries through roles). The directory reads as app_tenant,
/// so these policies are live under test exactly as they are in production.
/// </summary>
public sealed class TenantPeopleFixture : IAsyncLifetime
{
    public const string RecruiterSub = "sub-people-recruiter";
    public const string EmployeeSub = "sub-people-employee";
    public const string LeaderSub = "sub-people-leader";
    public const string HrAdminSub = "sub-people-hr";
    public const string HrbpSub = "sub-people-hrbp";
    public const string CommitteeSub = "sub-people-committee";
    public const string OrgBRecruiterSub = "sub-people-recruiter-b";
    public const string PlatformOwnerSub = "sub-people-platform-owner";

    public static readonly Guid Recruiter = Guid.Parse("c1000000-0000-0000-0000-000000000001");
    public static readonly Guid Admin = Guid.Parse("c1000000-0000-0000-0000-000000000002");
    public static readonly Guid HrAdmin = Guid.Parse("c1000000-0000-0000-0000-000000000003");
    public static readonly Guid Leader = Guid.Parse("c1000000-0000-0000-0000-000000000004");
    public static readonly Guid Employee = Guid.Parse("c1000000-0000-0000-0000-000000000005");
    public static readonly Guid Inactive = Guid.Parse("c1000000-0000-0000-0000-000000000006");
    public static readonly Guid Deleted = Guid.Parse("c1000000-0000-0000-0000-000000000007");
    public static readonly Guid ExternalOnly = Guid.Parse("c1000000-0000-0000-0000-000000000008");
    public static readonly Guid Underscore = Guid.Parse("c1000000-0000-0000-0000-000000000009");
    public static readonly Guid Hrbp = Guid.Parse("c1000000-0000-0000-0000-00000000000a");
    public static readonly Guid Committee = Guid.Parse("c1000000-0000-0000-0000-00000000000b");
    public static readonly Guid OrgBHrAdmin = Guid.Parse("c2000000-0000-0000-0000-000000000001");
    public static readonly Guid OrgBRecruiter = Guid.Parse("c2000000-0000-0000-0000-000000000002");
    public static readonly Guid OrgBInactiveRoleLeader = Guid.Parse("c2000000-0000-0000-0000-000000000003");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .WithDatabase("tims_tenant_people")
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        foreach (var sql in new[] { SchemaSql, SeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    private const string SchemaSql =
        """
        CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
        GRANT app_tenant TO postgres;
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamp NULL);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            avatar text NULL,
            phone text NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true,
            deleted_at timestamp NULL
        );
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id), permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        GRANT SELECT ON users, roles, permissions, role_permissions, user_roles TO app_tenant;
        ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON users USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE roles ENABLE ROW LEVEL SECURITY; ALTER TABLE roles FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON roles USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON role_permissions USING (EXISTS (SELECT 1 FROM roles par WHERE par.id = role_permissions.role_id AND par.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
        ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY; ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON user_roles USING (EXISTS (SELECT 1 FROM roles par WHERE par.id = user_roles.role_id AND par.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
        """;

    // Acme's grants are seed-access-matrix.ts's MATRIX rows (same scopes) for every permission this surface
    // reads — caller gates interview:create/update, vacancy:create/update, offer:create/update; eligibility
    // vacancy:approve, offer:approve; plus hr_admin's user:read. Deliberate divergences, each load-bearing:
    //  1. super_admin holds NO role_permissions rows, so the directory's super_admin short-circuit (the one
    //     PermissionService applies) is what lists Ada — rows would make that branch untested.
    //  2. the non-staff `external` role holds vacancy:approve + offer:approve (MATRIX gives it neither), so the
    //     staff-slug filter is what keeps Xavi out of both approver lists.
    //  3. Globex carries only the rows its tests read, and its `leader` role is DEACTIVATED (is_active=false),
    //     so Gil — whose only approve grants ride that role — must be absent from both Globex approver lists.
    //  4. b1…010 is a DRIFTED row: Acme's Uma linked to Globex's hr_admin role. It must never make her an Acme
    //     approver (the directory joins roles on the caller's organization, and RLS hides the row).
    // With MATRIX grants the leader holds BOTH approve permissions (team scope), so the vacancy/offer approver
    // lists coincide; AssignablePeopleRepositoryTests proves the repository reads the rule's permission instead.
    private const string SeedSql =
        """
        INSERT INTO organizations (id, name) VALUES
          ('11111111-1111-1111-1111-111111111111', 'Acme'),
          ('22222222-2222-2222-2222-222222222222', 'Globex');
        INSERT INTO permissions (id, module, action) VALUES
          ('e1000000-0000-0000-0000-000000000001', 'interview', 'create'),
          ('e1000000-0000-0000-0000-000000000002', 'vacancy', 'create'),
          ('e1000000-0000-0000-0000-000000000003', 'offer', 'create'),
          ('e1000000-0000-0000-0000-000000000004', 'vacancy', 'approve'),
          ('e1000000-0000-0000-0000-000000000005', 'offer', 'approve'),
          ('e1000000-0000-0000-0000-000000000006', 'user', 'read'),
          ('e1000000-0000-0000-0000-000000000007', 'interview', 'update'),
          ('e1000000-0000-0000-0000-000000000008', 'vacancy', 'update'),
          ('e1000000-0000-0000-0000-000000000009', 'offer', 'update');
        INSERT INTO roles (id, organization_id, slug, is_active) VALUES
          ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'recruiter', true),
          ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'super_admin', true),
          ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'hr_admin', true),
          ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'leader', true),
          ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'employee', true),
          ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'external', true),
          ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'hrbp', true),
          ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'committee', true),
          ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'hr_admin', true),
          ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'recruiter', true),
          ('a2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'leader', false);
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          -- recruiter (MATRIX: interview CRUD, vacancy CRUD+publish, offer read+create — all organization)
          ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'organization'),
          ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000007', 'organization'),
          ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'organization'),
          ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000008', 'organization'),
          ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 'organization'),
          -- hr_admin (MATRIX: CRUD on interview/vacancy/offer/user + vacancy/offer approve — all organization)
          ('f1000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'organization'),
          ('f1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000007', 'organization'),
          ('f1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'organization'),
          ('f1000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000008', 'organization'),
          ('f1000000-0000-0000-0000-000000000015', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'organization'),
          ('f1000000-0000-0000-0000-000000000016', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000009', 'organization'),
          ('f1000000-0000-0000-0000-000000000017', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004', 'organization'),
          ('f1000000-0000-0000-0000-000000000018', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000005', 'organization'),
          ('f1000000-0000-0000-0000-000000000019', 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000006', 'organization'),
          -- leader (MATRIX: vacancy read/create/approve, interview read/create/update, offer read/approve — team)
          ('f1000000-0000-0000-0000-000000000021', 'a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'team'),
          ('f1000000-0000-0000-0000-000000000022', 'a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004', 'team'),
          ('f1000000-0000-0000-0000-000000000023', 'a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'team'),
          ('f1000000-0000-0000-0000-000000000024', 'a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000007', 'team'),
          ('f1000000-0000-0000-0000-000000000025', 'a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000005', 'team'),
          -- hrbp (MATRIX: vacancy read/create/update, interview read/create, offer read only — unit)
          ('f1000000-0000-0000-0000-000000000031', 'a1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000002', 'unit'),
          ('f1000000-0000-0000-0000-000000000032', 'a1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000008', 'unit'),
          ('f1000000-0000-0000-0000-000000000033', 'a1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000001', 'unit'),
          -- committee (MATRIX: interview read/create/update — team)
          ('f1000000-0000-0000-0000-000000000041', 'a1000000-0000-0000-0000-000000000008', 'e1000000-0000-0000-0000-000000000001', 'team'),
          ('f1000000-0000-0000-0000-000000000042', 'a1000000-0000-0000-0000-000000000008', 'e1000000-0000-0000-0000-000000000007', 'team'),
          -- external: DIVERGENCE 2 (non-staff principal holding approve grants)
          ('f1000000-0000-0000-0000-000000000051', 'a1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000004', 'organization'),
          ('f1000000-0000-0000-0000-000000000052', 'a1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000005', 'organization'),
          -- Globex: DIVERGENCE 3 (subset; leader role deactivated)
          ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'organization'),
          ('f2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005', 'organization'),
          ('f2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'organization'),
          ('f2000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003', 'organization'),
          ('f2000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000008', 'organization'),
          ('f2000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004', 'team'),
          ('f2000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000005', 'team');
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, phone, is_platform_owner, is_active, deleted_at) VALUES
          ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-people-recruiter', 'rita@acme.test', 'Rita', 'Recruiter', NULL, '+57 300 0000001', false, true, NULL),
          ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-people-admin', 'ada@acme.test', 'Ada', 'Admin', 'https://cdn.test/ada.png', NULL, false, true, NULL),
          ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-people-hr', 'hugo@acme.test', 'Hugo', 'Hr', NULL, NULL, false, true, NULL),
          ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-people-leader', 'lia@acme.test', 'Lia', 'Leader', NULL, NULL, false, true, NULL),
          ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'sub-people-employee', 'eli@acme.test', 'Eli', 'Employee', NULL, NULL, false, true, NULL),
          ('c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'sub-people-inactive', 'ivan@acme.test', 'Ivan', 'Inactive', NULL, NULL, false, false, NULL),
          ('c1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'sub-people-deleted', 'dora@acme.test', 'Dora', 'Deleted', NULL, NULL, false, true, '2026-09-01'),
          ('c1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'sub-people-external', 'xavi@acme.test', 'Xavi', 'External', NULL, NULL, false, true, NULL),
          ('c1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'sub-people-underscore', 'uma@acme.test', 'Uma', 'Under_score', NULL, NULL, false, true, NULL),
          ('c1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'sub-people-hrbp', 'pablo@acme.test', 'Pablo', 'Partner', NULL, NULL, false, true, NULL),
          ('c1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'sub-people-committee', 'tomas@acme.test', 'Tomas', 'Committee', NULL, NULL, false, true, NULL),
          ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'sub-people-hr-b', 'foreign-hr@globex.test', 'Fiona', 'Foreign', NULL, NULL, false, true, NULL),
          ('c2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'sub-people-recruiter-b', 'foreign-rec@globex.test', 'Fabio', 'Foreign', NULL, NULL, false, true, NULL),
          ('c2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'sub-people-leader-b', 'gil@globex.test', 'Gil', 'Gone', NULL, NULL, false, true, NULL),
          ('c3000000-0000-0000-0000-000000000001', NULL, 'sub-people-platform-owner', 'owner@tims.test', 'Otto', 'Owner', NULL, NULL, true, true, NULL);
        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
          ('b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002'),
          ('b1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003'),
          ('b1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004'),
          ('b1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000005'),
          ('b1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000003'),
          ('b1000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000003'),
          ('b1000000-0000-0000-0000-000000000008', 'c1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000006'),
          ('b1000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000005'),
          ('b1000000-0000-0000-0000-000000000010', 'c1000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000001'),
          ('b1000000-0000-0000-0000-000000000011', 'c1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000007'),
          ('b1000000-0000-0000-0000-000000000012', 'c1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000008'),
          ('b2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
          ('b2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002'),
          ('b2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000003');
        """;
}

[CollectionDefinition("TenantPeople")]
public sealed class TenantPeopleCollection : ICollectionFixture<TenantPeopleFixture>;
