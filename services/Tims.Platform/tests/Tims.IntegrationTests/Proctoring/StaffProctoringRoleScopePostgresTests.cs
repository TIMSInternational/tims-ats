using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Domain.Identity;
using Tims.Infrastructure;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

/// <summary>Proves the sensitive reviewer scope against current RBAC rows and real RLS.</summary>
public sealed class StaffProctoringRoleScopePostgresTests : IAsyncLifetime
{
    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid User = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid CompanyA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1");
    private static readonly Guid CompanyB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2");
    private static readonly Guid UnitA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3");
    private static readonly Guid UnitB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4");
    private static readonly Guid AssignmentA = Guid.Parse("cccccccc-cccc-cccc-cccc-ccccccccccc1");
    private static readonly Guid AssignmentB = Guid.Parse("cccccccc-cccc-cccc-cccc-ccccccccccc2");
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres")
        .WithDatabase("tims_proctoring_scope").Build();
    private string _connectionString = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
        await ExecuteAsync("CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;");
        await ExecuteAsync(SchemaSql);
        await ExecuteAsync(SeedSql);
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    [Fact]
    public async Task CompanyScopedSuperAdmin_CannotReadOrWriteOtherCompany_OrSetOrgPolicy()
    {
        await using var db = NewContext();
        var store = NewStore(db);
        var read = await store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "read", default);
        var write = await store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "update", default);

        Assert.False(read.AllowsOrganizationPolicy);
        Assert.False(write.AllowsOrganizationPolicy);
        Assert.True(await VisibleAsync(db, store, read, AssignmentA));
        Assert.False(await VisibleAsync(db, store, read, AssignmentB));
        Assert.True(await VisibleAsync(db, store, write, AssignmentA));
        Assert.False(await VisibleAsync(db, store, write, AssignmentB));
    }

    [Fact]
    public async Task UnitScope_IntersectsHrbpMembership_AndDoesNotBorrowRecruiterGrant()
    {
        await ExecuteAsync($"""
            INSERT INTO user_roles VALUES
              ('77777777-7777-7777-7777-777777777772', '{User}',
               '66666666-6666-6666-6666-666666666662', NOW() - INTERVAL '1 day',
               NULL, NULL, NULL),
              ('77777777-7777-7777-7777-777777777773', '{User}',
               '66666666-6666-6666-6666-666666666663', NOW() - INTERVAL '1 day',
               NULL, NULL, NULL);
            UPDATE user_roles SET expires_at = NOW() - INTERVAL '1 hour'
             WHERE role_id = '66666666-6666-6666-6666-666666666661';
            """);
        await using var db = NewContext();
        var store = NewStore(db);
        var read = await store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "read", default);

        Assert.True(await VisibleAsync(db, store, read, AssignmentA));
        Assert.False(await VisibleAsync(db, store, read, AssignmentB));
        Assert.False(read.AllowsOrganizationPolicy);

        // A role assignment restricted to another unit cannot borrow the HRBP's
        // unit-A membership, even though an unrelated recruiter has org scope.
        await ExecuteAsync($"UPDATE user_roles SET unit_scope = '{UnitB}' WHERE role_id = '66666666-6666-6666-6666-666666666662';");
        read = await store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "read", default);
        Assert.False(await VisibleAsync(db, store, read, AssignmentA));
        Assert.False(await VisibleAsync(db, store, read, AssignmentB));
    }

    [Fact]
    public async Task ActiveRoleUnion_IsActionSpecific_AndRevocationTakesEffectOnNextRequest()
    {
        await ExecuteAsync($"""
            INSERT INTO user_roles VALUES
              ('77777777-7777-7777-7777-777777777774', '{User}',
               '66666666-6666-6666-6666-666666666664', NOW() - INTERVAL '1 day',
               NULL, '{CompanyB}', NULL);
            """);
        await using var db = NewContext();
        var store = NewStore(db);
        var read = await store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "read", default);
        var write = await store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "update", default);

        Assert.True(await VisibleAsync(db, store, read, AssignmentA));
        Assert.True(await VisibleAsync(db, store, read, AssignmentB));
        Assert.True(await VisibleAsync(db, store, write, AssignmentA));
        Assert.False(await VisibleAsync(db, store, write, AssignmentB));
        Assert.False(read.AllowsOrganizationPolicy);

        await ExecuteAsync("""
            UPDATE user_roles SET expires_at = NOW() - INTERVAL '1 hour';
            """);
        var denied = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "read", default));
        Assert.Equal(403, denied.StatusCode);

        await ExecuteAsync("UPDATE user_roles SET expires_at = NULL; UPDATE roles SET is_active = false;");
        denied = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "update", default));
        Assert.Equal(403, denied.StatusCode);
    }

    [Fact]
    public async Task UnrestrictedOrganizationGrant_CanChangeOrgPolicy_OnlyWhileActive()
    {
        await ExecuteAsync("""
            UPDATE user_roles SET company_scope = NULL
             WHERE role_id = '66666666-6666-6666-6666-666666666661';
            """);
        await using var db = NewContext();
        var store = NewStore(db);
        var scope = await store.ResolveScopeAsync(Org, User, PrincipalType.OrgUser, "update", default);
        Assert.True(scope.AllowsOrganizationPolicy);
        Assert.True(await VisibleAsync(db, store, scope, AssignmentA));
        Assert.True(await VisibleAsync(db, store, scope, AssignmentB));
    }

    private ProctoringDbContext NewContext() => new(
        new DbContextOptionsBuilder<ProctoringDbContext>().UseNpgsql(_connectionString).Options);

    private static StaffProctoringStore NewStore(ProctoringDbContext db) =>
        new(db, new UnitAnchors(UnitA), new NoopAuditor(), new CandidateProctoringRepository(db));

    private static async Task<bool> VisibleAsync(ProctoringDbContext db,
        StaffProctoringStore store, StaffProctoringScope scope, Guid assignmentId)
    {
        await using var tenant = await TenantScope.BeginAsync(db, Org);
        var visible = await store.CanAccessAssignmentAsync(scope, assignmentId, default);
        await tenant.CommitAsync();
        return visible;
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private sealed class UnitAnchors(Guid unitId) : IAnchorLoaderFactory, IAnchorLoader
    {
        public IAnchorLoader Create(Guid organizationId, Guid userId) => this;
        public Task<IReadOnlyList<string>> TeamMemberIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>([]);
        public Task<IReadOnlyList<string>> UnitIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>([unitId.ToString()]);
        public Task<IReadOnlyList<string>> PanelInterviewIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>([]);
        public Task<IReadOnlyList<string>> LedTeamIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>([]);
        public Task<IReadOnlyList<string>> UnitMemberIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>([]);
    }

    private sealed class NoopAuditor : IDataAccessAuditor
    {
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null,
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private const string SchemaSql = """
        CREATE TABLE users (id uuid PRIMARY KEY, organization_id uuid, is_active boolean NOT NULL,
          deleted_at timestamp(3));
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
          slug text NOT NULL, is_active boolean NOT NULL);
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (id uuid PRIMARY KEY, role_id uuid NOT NULL,
          permission_id uuid NOT NULL, scope text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL, role_id uuid NOT NULL,
          assigned_at timestamp(3) NOT NULL, expires_at timestamp(3),
          company_scope uuid, unit_scope uuid);
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
          company_id uuid, business_unit_id uuid, team_id uuid, assigned_to uuid,
          created_by uuid NOT NULL, deleted_at timestamp(3));
        CREATE TABLE assessment_assignments (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
          vacancy_id uuid NOT NULL);
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_tenant;
        DO $$ DECLARE t text; BEGIN
          FOREACH t IN ARRAY ARRAY['users','roles','vacancies','assessment_assignments'] LOOP
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
            EXECUTE format('CREATE POLICY tenant_isolation ON %I USING '
              || '(organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)', t);
          END LOOP;
        END $$;
        ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON role_permissions USING (EXISTS (
          SELECT 1 FROM roles r WHERE r.id = role_id AND
            r.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
        ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
        ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON user_roles USING (EXISTS (
          SELECT 1 FROM roles r WHERE r.id = role_id AND
            r.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
        """;

    private const string SeedSql = """
        INSERT INTO users VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111', true, NULL);
        INSERT INTO roles VALUES
          ('66666666-6666-6666-6666-666666666661','11111111-1111-1111-1111-111111111111','super_admin',true),
          ('66666666-6666-6666-6666-666666666662','11111111-1111-1111-1111-111111111111','hrbp',true),
          ('66666666-6666-6666-6666-666666666663','11111111-1111-1111-1111-111111111111','recruiter',true),
          ('66666666-6666-6666-6666-666666666664','11111111-1111-1111-1111-111111111111','hr_admin',true);
        INSERT INTO permissions VALUES
          ('55555555-5555-5555-5555-555555555551','assessment','read'),
          ('55555555-5555-5555-5555-555555555552','assessment','update');
        INSERT INTO role_permissions VALUES
          ('44444444-4444-4444-4444-444444444441','66666666-6666-6666-6666-666666666661','55555555-5555-5555-5555-555555555551','organization'),
          ('44444444-4444-4444-4444-444444444442','66666666-6666-6666-6666-666666666661','55555555-5555-5555-5555-555555555552','organization'),
          ('44444444-4444-4444-4444-444444444443','66666666-6666-6666-6666-666666666662','55555555-5555-5555-5555-555555555551','unit'),
          ('44444444-4444-4444-4444-444444444444','66666666-6666-6666-6666-666666666663','55555555-5555-5555-5555-555555555551','organization'),
          ('44444444-4444-4444-4444-444444444445','66666666-6666-6666-6666-666666666664','55555555-5555-5555-5555-555555555551','organization');
        INSERT INTO user_roles VALUES
          ('77777777-7777-7777-7777-777777777771','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
           '66666666-6666-6666-6666-666666666661', NOW() - INTERVAL '1 day',
           NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', NULL);
        INSERT INTO vacancies VALUES
          ('dddddddd-dddd-dddd-dddd-ddddddddddd1','11111111-1111-1111-1111-111111111111',
           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
           NULL,NULL,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',NULL),
          ('dddddddd-dddd-dddd-dddd-ddddddddddd2','11111111-1111-1111-1111-111111111111',
           'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',
           NULL,NULL,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',NULL);
        INSERT INTO assessment_assignments VALUES
          ('cccccccc-cccc-cccc-cccc-ccccccccccc1','11111111-1111-1111-1111-111111111111',
           'dddddddd-dddd-dddd-dddd-ddddddddddd1'),
          ('cccccccc-cccc-cccc-cccc-ccccccccccc2','11111111-1111-1111-1111-111111111111',
           'dddddddd-dddd-dddd-dddd-ddddddddddd2');
        """;
}
