using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Evaluation360;

namespace Tims.IntegrationTests.Evaluation360;

/// <summary>
/// Phase-5 Slice 7 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED evaluation360 tables
/// (<c>review_cycles</c>, <c>rater_assignments</c>, <c>rater_responses</c>) with the NATIVE Prisma enum types
/// (<c>ReviewCycleStatus</c>/<c>RaterRelationship</c>/<c>RaterAssignmentStatus</c>, faithful to prod) under the
/// SAME RLS mechanism as the other read fixtures (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW
/// LEVEL SECURITY, fail-closed <c>tenant_isolation</c>) + the identity/RBAC plane (privileged, no RLS).
///
/// The seed proves BOTH auth patterns and the identity-anchoring bite. RaterA and RaterB are in the SAME org
/// (OrgA) — so RLS passes BOTH of their rows for either caller, and the ONLY thing separating them is the
/// self-service <c>rater_user_id</c>/<c>subject_user_id</c> HARD-FILTER: neutralizing it would make A see B's
/// tasks/report-cycles (and vice-versa), flipping every identity-anchoring assertion. RaterA holds the
/// <c>employee</c> role (NO evaluation360 grant) — proving self-service works on identity alone (200) while the
/// staff reads reject the same user (403).
/// </summary>
public sealed class Evaluation360ReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_evaluation360_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Cycles (OrgA): open (rater-tasks + progress), two published (subject anchoring), closed (published gate).
    public static readonly Guid OpenCycle = Guid.Parse("7c000000-0000-0000-0000-00000000000f");
    public static readonly Guid PublishedCycleA = Guid.Parse("7c000000-0000-0000-0000-00000000000a");
    public static readonly Guid PublishedCycleB = Guid.Parse("7c000000-0000-0000-0000-00000000000b");
    public static readonly Guid ClosedCycle = Guid.Parse("7c000000-0000-0000-0000-00000000000c");
    public static readonly Guid OrgBPublishedCycle = Guid.Parse("7c000000-0000-0000-0000-0000000000bb");

    // Users that AUTHENTICATE (subs).
    public const string OrgAdminSub = "sub-e360-org-admin";   // hr_admin @ organization (staff org-gate passes)
    public const string CompanySub = "sub-e360-company";      // recruiter @ company (staff org-gate passes)
    public const string TeamLeadSub = "sub-e360-team-lead";   // leader @ team (narrow → 403 staff org-gate, F3)
    public const string RaterASub = "sub-e360-rater-a";       // employee, NO eval grant (403 staff / 200 self-service)
    public const string RaterBSub = "sub-e360-rater-b";       // employee, NO eval grant

    public static readonly Guid OrgAdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid RaterAId = Guid.Parse("c0000000-0000-0000-0000-0000000000a1");
    public static readonly Guid RaterBId = Guid.Parse("c0000000-0000-0000-0000-0000000000b1");
    public static readonly Guid Subject1 = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // Sam Subject (open cycle, A rates)
    public static readonly Guid Subject2 = Guid.Parse("d0000000-0000-0000-0000-000000000002"); // Sue Subject2 (open cycle, B rates)

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    private NpgsqlDataSource? _dataSource;

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        // The SAME enum-mapped data source the Program.cs DI uses, so the native Prisma enum columns read/filter
        // identically in the direct-repo tests and the booted host.
        _dataSource = Evaluation360ReadDataSource.Build(ConnectionString);

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using (var role = connection.CreateCommand())
        {
            role.CommandText =
                """
                CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
                GRANT app_tenant TO postgres;
                """;
            await role.ExecuteNonQueryAsync();
        }

        foreach (var sql in new[] { IdentitySchemaSql, Eval360SchemaSql, RlsSql, IdentitySeedSql, Eval360SeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync()
    {
        if (_dataSource is not null)
        {
            await _dataSource.DisposeAsync();
        }

        await _container.DisposeAsync();
    }

    public Evaluation360ReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<Evaluation360ReadDbContext>()
            .UseNpgsql(_dataSource!, Evaluation360ReadDataSource.MapEnums)
            .Options);

    // Identity/RBAC plane (privileged, no RLS): principal resolution + grant checks run as `postgres`. The one
    // `users` table serves BOTH this (supabase_user_id/is_platform_owner/is_active) AND the tenant eval reads
    // (first_name/last_name) + the self-service hard-filter (id).
    private const string IdentitySchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL,
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');
        """;

    // Native Prisma enum types + the three eval tables (faithful to prod). created_by_id/updated_at exist on the
    // real models (not mapped by the read entities) so the INSERTs are honest.
    private const string Eval360SchemaSql =
        """
        CREATE TYPE "ReviewCycleStatus" AS ENUM ('draft', 'open', 'closed', 'published');
        CREATE TYPE "RaterRelationship" AS ENUM ('self', 'manager', 'peer', 'direct_report');
        CREATE TYPE "RaterAssignmentStatus" AS ENUM ('pending', 'submitted');

        CREATE TABLE review_cycles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            name text NOT NULL,
            status "ReviewCycleStatus" NOT NULL DEFAULT 'draft',
            opens_at timestamp(3) NULL,
            closes_at timestamp(3) NULL,
            published_at timestamp(3) NULL,
            created_by_id uuid NOT NULL,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL
        );
        CREATE TABLE rater_assignments (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            cycle_id uuid NOT NULL REFERENCES review_cycles (id),
            subject_user_id uuid NOT NULL,
            rater_user_id uuid NOT NULL,
            relationship "RaterRelationship" NOT NULL,
            status "RaterAssignmentStatus" NOT NULL DEFAULT 'pending',
            submitted_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL
        );
        CREATE TABLE rater_responses (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            assignment_id uuid NOT NULL REFERENCES rater_assignments (id),
            competency_key text NOT NULL,
            rating integer NOT NULL,
            comment varchar(5000) NULL,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL
        );
        """;

    // Org-scoped RLS on the tenant tables + `users` (the tenant subject-name join / rater filter). All read UNDER
    // TenantScope; the privileged identity/RBAC reads run as superuser (bypass RLS) — same split as the others.
    private const string RlsSql =
        """
        GRANT SELECT ON users, review_cycles, rater_assignments, rater_responses TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;              ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;      ALTER TABLE review_cycles FORCE ROW LEVEL SECURITY;
        ALTER TABLE rater_assignments ENABLE ROW LEVEL SECURITY;  ALTER TABLE rater_assignments FORCE ROW LEVEL SECURITY;
        ALTER TABLE rater_responses ENABLE ROW LEVEL SECURITY;    ALTER TABLE rater_responses FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users             USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON review_cycles     USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON rater_assignments USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON rater_responses   USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        -- All VALID staff slugs (a non-staff slug would be dropped by the resolver → its scope never reaches the
        -- org-gate, giving a FALSE-green 403; #150 lesson). hr_admin@organization + recruiter@company pass the
        -- staff org-gate; leader@team is narrow (→ 403, Codex F3); employee has NO evaluation360 grant.
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'evaluation360', 'read');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'company');
        -- NOTE: 'employee' (RaterA/RaterB's role) intentionally has NO evaluation360 grant row.

        -- Authenticating staff users (OrgA) + the raters/subjects/manager (no auth needed) + one OrgB user.
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-e360-org-admin', 'admin@tims.test',  'Ana',   'Admin',    false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-e360-team-lead', 'lead@tims.test',   'Tara',  'Lead',     false, true),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-e360-company',   'company@tims.test','Cara',  'Company',  false, true),
          ('c0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'sub-e360-rater-a',   'a@tims.test',      'Alex',  'RaterA',   false, true),
          ('c0000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'sub-e360-rater-b',   'b@tims.test',      'Bella', 'RaterB',   false, true),
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-e360-subject-1', 's1@tims.test',     'Sam',   'Subject',  false, true),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-e360-subject-2', 's2@tims.test',     'Sue',   'Subject2', false, true),
          ('d0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'sub-e360-manager',   'mgr@tims.test',    'Meg',   'Manager',  false, true),
          ('d0000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'sub-e360-p1',        'p1@tims.test',     'Pat',   'Peer1',    false, true),
          ('d0000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'sub-e360-p2',        'p2@tims.test',     'Pia',   'Peer2',    false, true),
          ('d0000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'sub-e360-p3',        'p3@tims.test',     'Pol',   'Peer3',    false, true),
          ('d0000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'sub-e360-d1',        'd1@tims.test',     'Dan',   'Direct1',  false, true),
          ('d0000000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'sub-e360-d2',        'd2@tims.test',     'Dot',   'Direct2',  false, true),
          ('c0000000-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'sub-e360-orgb',      'orgb@tims.test',   'Otto',  'OrgB',     false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004'),
          ('e0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000003');
        """;

    // Cycles + assignments + responses. created_by_id = org-admin (OrgB cycle = the OrgB user). created_at
    // staggered so listCycles' desc order is deterministic (Open newest → Closed oldest).
    private const string Eval360SeedSql =
        """
        INSERT INTO review_cycles (id, organization_id, name, status, opens_at, closes_at, published_at, created_by_id, created_at, updated_at) VALUES
          ('7c000000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', 'Open Cycle',      'open',      '2026-06-01 00:00:00', NULL,                  NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-04 00:00:00', '2026-06-04 00:00:00'),
          ('7c000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Published Cycle A','published', '2026-01-01 00:00:00', '2026-02-01 00:00:00', '2026-02-15 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-06-03 00:00:00', '2026-06-03 00:00:00'),
          ('7c000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Published Cycle B','published', '2026-01-01 00:00:00', '2026-02-01 00:00:00', '2026-02-16 00:00:00', 'c0000000-0000-0000-0000-000000000001', '2026-06-02 00:00:00', '2026-06-02 00:00:00'),
          ('7c000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Closed Cycle',    'closed',    '2026-03-01 00:00:00', '2026-04-01 00:00:00', NULL,                  'c0000000-0000-0000-0000-000000000001', '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
          ('7c000000-0000-0000-0000-0000000000bb', '22222222-2222-2222-2222-222222222222', 'OrgB Published',  'published', '2026-01-01 00:00:00', '2026-02-01 00:00:00', '2026-02-20 00:00:00', 'c0000000-0000-0000-0000-0000000000c1', '2026-06-01 00:00:00', '2026-06-01 00:00:00');

        -- Open cycle (subject anchoring for rater-tasks + progress). A rates S1, B rates S2 (distinct subjects,
        -- so A's rater-tasks returning S1-not-S2 bites the rater_user_id filter, not RLS — A & B share OrgA).
        INSERT INTO rater_assignments (id, organization_id, cycle_id, subject_user_id, rater_user_id, relationship, status, submitted_at, created_at, updated_at) VALUES
          ('a5510000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000f', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'peer',    'pending',   NULL,                  '2026-06-04 00:00:00', '2026-06-04 00:00:00'),
          ('a5510000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000f', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000b1', 'peer',    'pending',   NULL,                  '2026-06-04 00:00:00', '2026-06-04 00:00:00'),
          ('a5510000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000f', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000010', 'manager', 'submitted', '2026-06-05 00:00:00', '2026-06-04 00:00:00', '2026-06-05 00:00:00'),
          ('a5510000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000f', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'self',    'submitted', '2026-06-05 00:00:00', '2026-06-04 00:00:00', '2026-06-05 00:00:00');

        -- Published Cycle A (subject = RaterA): self(1) + manager(1) shown attributed; peer(3) shown avg;
        -- direct_report(2) OMITTED (min-3 suppress-by-omission).
        INSERT INTO rater_assignments (id, organization_id, cycle_id, subject_user_id, rater_user_id, relationship, status, submitted_at, created_at, updated_at) VALUES
          ('a5510000-0000-0000-0000-0000000000a0', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'self',          'submitted', '2026-02-10 00:00:00', '2026-01-05 00:00:00', '2026-02-10 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000010', 'manager',       'submitted', '2026-02-10 00:00:00', '2026-01-05 00:00:00', '2026-02-10 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000011', 'peer',          'submitted', '2026-02-10 00:00:00', '2026-01-05 00:00:00', '2026-02-10 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000012', 'peer',          'submitted', '2026-02-10 00:00:00', '2026-01-05 00:00:00', '2026-02-10 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000013', 'peer',          'submitted', '2026-02-10 00:00:00', '2026-01-05 00:00:00', '2026-02-10 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000014', 'direct_report', 'submitted', '2026-02-10 00:00:00', '2026-01-05 00:00:00', '2026-02-10 00:00:00'),
          ('a5510000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000015', 'direct_report', 'submitted', '2026-02-10 00:00:00', '2026-01-05 00:00:00', '2026-02-10 00:00:00');

        -- Published Cycle B (subject = RaterB): proves A's report-cycles NEVER include B's cycle (identity anchor).
        INSERT INTO rater_assignments (id, organization_id, cycle_id, subject_user_id, rater_user_id, relationship, status, submitted_at, created_at, updated_at) VALUES
          ('a5510000-0000-0000-0000-0000000000b0', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'self', 'submitted', '2026-02-10 00:00:00', '2026-01-05 00:00:00', '2026-02-10 00:00:00');

        -- Closed Cycle (subject = RaterA): NOT published → A's myReport on it → NOT_FOUND (published-only gate),
        -- and A's report-cycles excludes it.
        INSERT INTO rater_assignments (id, organization_id, cycle_id, subject_user_id, rater_user_id, relationship, status, submitted_at, created_at, updated_at) VALUES
          ('a5510000-0000-0000-0000-0000000000c0', '11111111-1111-1111-1111-111111111111', '7c000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000010', 'manager', 'submitted', '2026-03-10 00:00:00', '2026-03-05 00:00:00', '2026-03-10 00:00:00');

        -- OrgB published cycle (subject = OrgB user): cross-org isolation.
        INSERT INTO rater_assignments (id, organization_id, cycle_id, subject_user_id, rater_user_id, relationship, status, submitted_at, created_at, updated_at) VALUES
          ('a5510000-0000-0000-0000-0000000000bb', '22222222-2222-2222-2222-222222222222', '7c000000-0000-0000-0000-0000000000bb', 'c0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000c1', 'self', 'submitted', '2026-02-18 00:00:00', '2026-01-05 00:00:00', '2026-02-18 00:00:00');

        -- Responses for the PUBLISHED-cycle assignments (the only ones findReportRows reads). Competency
        -- 'communication': self=4, manager=5, peers 3/4/5 (avg 4), direct_reports 2/2 (omitted).
        INSERT INTO rater_responses (id, organization_id, assignment_id, competency_key, rating, comment, created_at, updated_at) VALUES
          ('60000000-0000-0000-0000-0000000000a0', '11111111-1111-1111-1111-111111111111', 'a5510000-0000-0000-0000-0000000000a0', 'communication', 4, 'self note',    '2026-02-10 00:00:00', '2026-02-10 00:00:00'),
          ('60000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'a5510000-0000-0000-0000-0000000000a2', 'communication', 5, 'manager note', '2026-02-10 00:00:00', '2026-02-10 00:00:00'),
          ('60000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'a5510000-0000-0000-0000-0000000000a3', 'communication', 3, 'peer a',       '2026-02-10 00:00:00', '2026-02-10 00:00:00'),
          ('60000000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'a5510000-0000-0000-0000-0000000000a4', 'communication', 4, 'peer b',       '2026-02-10 00:00:00', '2026-02-10 00:00:00'),
          ('60000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'a5510000-0000-0000-0000-0000000000a5', 'communication', 5, 'peer c',       '2026-02-10 00:00:00', '2026-02-10 00:00:00'),
          ('60000000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', 'a5510000-0000-0000-0000-0000000000a6', 'communication', 2, 'dr a',         '2026-02-10 00:00:00', '2026-02-10 00:00:00'),
          ('60000000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111', 'a5510000-0000-0000-0000-0000000000a7', 'communication', 2, 'dr b',         '2026-02-10 00:00:00', '2026-02-10 00:00:00'),
          ('60000000-0000-0000-0000-0000000000b0', '11111111-1111-1111-1111-111111111111', 'a5510000-0000-0000-0000-0000000000b0', 'communication', 3, 'b self',       '2026-02-10 00:00:00', '2026-02-10 00:00:00'),
          ('60000000-0000-0000-0000-0000000000bb', '22222222-2222-2222-2222-222222222222', 'a5510000-0000-0000-0000-0000000000bb', 'communication', 5, 'orgb self',    '2026-02-18 00:00:00', '2026-02-18 00:00:00');
        """;
}
