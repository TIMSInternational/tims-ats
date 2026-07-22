using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Access;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.5b Testcontainers fixture: a real Postgres with the SAME RLS mechanism as
/// <see cref="RlsFixture"/> (NOLOGIN/NOBYPASSRLS <c>app_tenant</c> role, ENABLE + FORCE ROW LEVEL
/// SECURITY + fail-closed <c>tenant_isolation</c> policy on every org-scoped anchor/probe table),
/// seeded with the anchor + IDOR scenario.
///
/// Scenario (Org A): leader U1 leads team T1 (members U2, U3) in unit BU1; team T2 (leader U9,
/// also in BU1) has member U4; U5 is a direct BU1 member; U1 is evaluator on interviews I1 and I4.
/// Vacancies/candidates/applications/okrs/interviews carry in-scope, out-of-scope, and soft-deleted
/// rows for a team-scoped U1. Org B holds a parallel vacancy to prove cross-org isolation.
///
/// UUIDs are fixed compile-time constants (never user input), so the seed interpolates them into the
/// DDL/DML the same way <c>TenantScope</c> interpolates the fixed "app_tenant" identifier — every
/// runtime/tenant value on the real query path is still a bound parameter.
/// </summary>
public sealed class AnchorProbeFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_wp25b";

    // Orgs
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // Users (Org A)
    public static readonly Guid U1 = Guid.Parse("a0000000-0000-0000-0000-000000000001"); // leader
    public static readonly Guid U2 = Guid.Parse("a0000000-0000-0000-0000-000000000002"); // T1 member
    public static readonly Guid U3 = Guid.Parse("a0000000-0000-0000-0000-000000000003"); // T1 member
    public static readonly Guid U4 = Guid.Parse("a0000000-0000-0000-0000-000000000004"); // T2 member
    public static readonly Guid U5 = Guid.Parse("a0000000-0000-0000-0000-000000000005"); // direct BU1 member
    public static readonly Guid U9 = Guid.Parse("a0000000-0000-0000-0000-000000000009"); // other leader/assignee

    // Business units (Org A)
    public static readonly Guid Bu1 = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // active
    public static readonly Guid BuInactive = Guid.Parse("d0000000-0000-0000-0000-000000000009"); // inactive

    // Teams (Org A)
    public static readonly Guid T1 = Guid.Parse("c0000000-0000-0000-0000-000000000001"); // led by U1, active
    public static readonly Guid T2 = Guid.Parse("c0000000-0000-0000-0000-000000000002"); // led by U9, active
    public static readonly Guid TInactive = Guid.Parse("c0000000-0000-0000-0000-000000000003"); // led by U1, inactive

    // Vacancies
    public static readonly Guid V1 = Guid.Parse("e0000000-0000-0000-0000-000000000001"); // team_id=T1 → in team scope
    public static readonly Guid V2 = Guid.Parse("e0000000-0000-0000-0000-000000000002"); // team_id=T2 → out of scope
    public static readonly Guid V3 = Guid.Parse("e0000000-0000-0000-0000-000000000003"); // assigned_to=U1 → in scope
    public static readonly Guid VDel = Guid.Parse("e0000000-0000-0000-0000-00000000000d"); // team_id=T1, soft-deleted
    public static readonly Guid Vb = Guid.Parse("e0000000-0000-0000-0000-0000000000b0"); // Org B (cross-org)

    // Candidates
    public static readonly Guid C1 = Guid.Parse("f0000000-0000-0000-0000-000000000001"); // application → V1 (in)
    public static readonly Guid C2 = Guid.Parse("f0000000-0000-0000-0000-000000000002"); // application → V2 (out)
    public static readonly Guid CDel = Guid.Parse("f0000000-0000-0000-0000-00000000000d"); // application → V1, soft-deleted

    // Applications
    public static readonly Guid A1 = Guid.Parse("10000000-0000-0000-0000-000000000001"); // C1 → V1 (in)
    public static readonly Guid A2 = Guid.Parse("10000000-0000-0000-0000-000000000002"); // C2 → V2 (out)

    // Offers (viaVacancy, like applications): OA1 → V1 (in team scope), OA2 → V2 (out of scope).
    public static readonly Guid OA1 = Guid.Parse("10000000-0000-0000-0000-0000000000a1");
    public static readonly Guid OA2 = Guid.Parse("10000000-0000-0000-0000-0000000000a2");
    public static readonly Guid A3 = Guid.Parse("10000000-0000-0000-0000-00000000000d"); // CDel → V1

    // Interviews
    public static readonly Guid I1 = Guid.Parse("20000000-0000-0000-0000-000000000001"); // vacancy V1, U1 evaluator (in)
    public static readonly Guid I3 = Guid.Parse("20000000-0000-0000-0000-000000000003"); // vacancy V2, no U1 evaluator (out)
    public static readonly Guid I4 = Guid.Parse("20000000-0000-0000-0000-000000000004"); // vacancy V2, U1 evaluator (in via panel)

    // OKRs
    public static readonly Guid O1 = Guid.Parse("30000000-0000-0000-0000-000000000001"); // user U2 (team member → in)
    public static readonly Guid O2 = Guid.Parse("30000000-0000-0000-0000-000000000002"); // user U4 (not team member → out)
    public static readonly Guid O3 = Guid.Parse("30000000-0000-0000-0000-000000000003"); // user U1 (self → in)

    // Self-service rows (Part C)
    public static readonly Guid SelfRow = Guid.Parse("40000000-0000-0000-0000-000000000001"); // subject U1
    public static readonly Guid OtherRow = Guid.Parse("40000000-0000-0000-0000-000000000002"); // subject U2

    // Critical roles (Phase-5 Slice 8): the assertScoped('criticalRole') probe root anchors on
    // current_holder_id. For team-scoped U1 (teamMembers {U1,U2,U3}): CR1 holder=U2 (in), CR2 holder=U4 (out),
    // CRNull holder=NULL (out — Prisma `in` never matches NULL, fail-narrow), CRb org B (cross-org).
    public static readonly Guid CR1 = Guid.Parse("50000000-0000-0000-0000-000000000001"); // holder U2 → in team scope
    public static readonly Guid CR2 = Guid.Parse("50000000-0000-0000-0000-000000000002"); // holder U4 → out of scope
    public static readonly Guid CRNull = Guid.Parse("50000000-0000-0000-0000-00000000000d"); // holder NULL → out (fail-narrow)
    public static readonly Guid CRb = Guid.Parse("50000000-0000-0000-0000-0000000000b0"); // Org B (cross-org)

    private static readonly string[] OrgScopedTables =
    [
        "teams", "business_units", "user_business_units", "interviews", "users",
        "vacancies", "candidates", "applications", "offers", "okrs", "self_service_rows", "critical_roles",
    ];

    private static readonly string[] AllTables =
    [
        "teams", "user_teams", "user_business_units", "business_units", "interview_evaluators",
        "interviews", "users", "vacancies", "candidates", "applications", "offers", "okrs", "self_service_rows",
        "critical_roles",
    ];

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

        await using (var ddl = connection.CreateCommand())
        {
            ddl.CommandText = SchemaDdl();
            await ddl.ExecuteNonQueryAsync();
        }

        await using (var seed = connection.CreateCommand())
        {
            seed.CommandText = SeedDml();
            await seed.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public static DbContextOptions<AnchorDbContext> BuildOptions(string connectionString) =>
        new DbContextOptionsBuilder<AnchorDbContext>().UseNpgsql(connectionString).Options;

    private static string SchemaDdl()
    {
        var rls = string.Empty;
        foreach (var table in OrgScopedTables)
        {
            rls +=
                $"""
                ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON {table}
                    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
                    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

                """;
        }

        var grants = string.Empty;
        foreach (var table in AllTables)
        {
            grants += $"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO app_tenant;\n";
        }

        // Junction tables (user_teams, interview_evaluators) have no organization_id column: their
        // org safety comes from being queried only by org-scoped parent ids (teams / interviews),
        // so they carry no RLS policy — matching the anchor queries' defense-in-depth model.
        return $"""
            CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
            GRANT app_tenant TO postgres;

            CREATE TABLE teams (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL,
                business_unit_id uuid NULL, leader_id uuid NULL, is_active boolean NOT NULL);
            CREATE TABLE user_teams (
                id uuid PRIMARY KEY, user_id uuid NOT NULL, team_id uuid NOT NULL);
            CREATE TABLE user_business_units (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, business_unit_id uuid NOT NULL);
            CREATE TABLE business_units (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, is_active boolean NOT NULL);
            CREATE TABLE interview_evaluators (
                id uuid PRIMARY KEY, interview_id uuid NOT NULL, user_id uuid NOT NULL);
            CREATE TABLE interviews (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, vacancy_id uuid NOT NULL);
            CREATE TABLE users (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, business_unit_id uuid NULL);
            CREATE TABLE vacancies (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, team_id uuid NULL,
                business_unit_id uuid NULL, assigned_to uuid NULL, created_by uuid NULL, deleted_at timestamptz NULL);
            CREATE TABLE candidates (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, deleted_at timestamptz NULL);
            CREATE TABLE applications (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL, vacancy_id uuid NOT NULL);
            CREATE TABLE offers (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, vacancy_id uuid NOT NULL);
            CREATE TABLE okrs (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
                team_id uuid NULL, created_by_id uuid NULL);
            CREATE TABLE self_service_rows (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, subject_user_id uuid NOT NULL);
            CREATE TABLE critical_roles (
                id uuid PRIMARY KEY, organization_id uuid NOT NULL, current_holder_id uuid NULL);

            {grants}
            {rls}
            """;
    }

    private static string SeedDml() => $"""
        INSERT INTO business_units (id, organization_id, is_active) VALUES
            ('{Bu1}', '{OrgA}', true),
            ('{BuInactive}', '{OrgA}', false);

        INSERT INTO teams (id, organization_id, business_unit_id, leader_id, is_active) VALUES
            ('{T1}', '{OrgA}', '{Bu1}', '{U1}', true),
            ('{T2}', '{OrgA}', '{Bu1}', '{U9}', true),
            ('{TInactive}', '{OrgA}', '{Bu1}', '{U1}', false);

        INSERT INTO users (id, organization_id, business_unit_id) VALUES
            ('{U1}', '{OrgA}', NULL),
            ('{U2}', '{OrgA}', NULL),
            ('{U3}', '{OrgA}', NULL),
            ('{U4}', '{OrgA}', NULL),
            ('{U5}', '{OrgA}', '{Bu1}'),
            ('{U9}', '{OrgA}', NULL);

        INSERT INTO user_teams (id, user_id, team_id) VALUES
            ('{Guid.Parse("b1000000-0000-0000-0000-000000000002")}', '{U2}', '{T1}'),
            ('{Guid.Parse("b1000000-0000-0000-0000-000000000003")}', '{U3}', '{T1}'),
            ('{Guid.Parse("b1000000-0000-0000-0000-000000000004")}', '{U4}', '{T2}');

        INSERT INTO user_business_units (id, organization_id, user_id, business_unit_id) VALUES
            ('{Guid.Parse("b2000000-0000-0000-0000-000000000001")}', '{OrgA}', '{U1}', '{Bu1}'),
            ('{Guid.Parse("b2000000-0000-0000-0000-000000000009")}', '{OrgA}', '{U1}', '{BuInactive}');

        INSERT INTO vacancies (id, organization_id, team_id, business_unit_id, assigned_to, created_by, deleted_at) VALUES
            ('{V1}', '{OrgA}', '{T1}', '{Bu1}', '{U9}', '{U9}', NULL),
            ('{V2}', '{OrgA}', '{T2}', '{Bu1}', '{U9}', '{U9}', NULL),
            ('{V3}', '{OrgA}', '{T2}', '{Bu1}', '{U1}', '{U9}', NULL),
            ('{VDel}', '{OrgA}', '{T1}', '{Bu1}', '{U1}', '{U9}', NOW()),
            ('{Vb}', '{OrgB}', NULL, NULL, NULL, NULL, NULL);

        INSERT INTO candidates (id, organization_id, deleted_at) VALUES
            ('{C1}', '{OrgA}', NULL),
            ('{C2}', '{OrgA}', NULL),
            ('{CDel}', '{OrgA}', NOW());

        INSERT INTO applications (id, organization_id, candidate_id, vacancy_id) VALUES
            ('{A1}', '{OrgA}', '{C1}', '{V1}'),
            ('{A2}', '{OrgA}', '{C2}', '{V2}'),
            ('{A3}', '{OrgA}', '{CDel}', '{V1}');

        INSERT INTO offers (id, organization_id, vacancy_id) VALUES
            ('{OA1}', '{OrgA}', '{V1}'),
            ('{OA2}', '{OrgA}', '{V2}');

        INSERT INTO interviews (id, organization_id, vacancy_id) VALUES
            ('{I1}', '{OrgA}', '{V1}'),
            ('{I3}', '{OrgA}', '{V2}'),
            ('{I4}', '{OrgA}', '{V2}');

        INSERT INTO interview_evaluators (id, interview_id, user_id) VALUES
            ('{Guid.Parse("21000000-0000-0000-0000-000000000001")}', '{I1}', '{U1}'),
            ('{Guid.Parse("21000000-0000-0000-0000-000000000004")}', '{I4}', '{U1}');

        INSERT INTO okrs (id, organization_id, user_id, team_id, created_by_id) VALUES
            ('{O1}', '{OrgA}', '{U2}', '{T1}', '{U1}'),
            ('{O2}', '{OrgA}', '{U4}', '{T2}', '{U9}'),
            ('{O3}', '{OrgA}', '{U1}', '{T1}', '{U1}');

        INSERT INTO self_service_rows (id, organization_id, subject_user_id) VALUES
            ('{SelfRow}', '{OrgA}', '{U1}'),
            ('{OtherRow}', '{OrgA}', '{U2}');

        INSERT INTO critical_roles (id, organization_id, current_holder_id) VALUES
            ('{CR1}', '{OrgA}', '{U2}'),
            ('{CR2}', '{OrgA}', '{U4}'),
            ('{CRNull}', '{OrgA}', NULL),
            ('{CRb}', '{OrgB}', NULL);
        """;
}
