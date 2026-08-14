using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.PlatformDashboard;

namespace Tims.IntegrationTests.PlatformDashboard;

/// <summary>
/// Phase-5 slice 23 (issue #81, PR 1 of 3) Testcontainers fixture: one real Postgres carrying the three
/// Prisma-owned tables the FX-free dashboard reads touch (<c>subscriptions</c>, <c>organizations</c>,
/// <c>users</c>) plus the identity plane.
///
/// <para><b>The <c>plan</c> columns are declared as the NATIVE <c>public."OrgPlan"</c> enum, exactly as
/// prod has them</b> (<c>packages/db/baseline/prod-public-schema.sql:169</c>). TRAP 3: EFCore.PG cannot
/// materialise an unmapped enum into a CLR <c>string</c>, and the failure appears ONLY against a real
/// server, on the first materialised row. Declaring these as <c>text</c> would make every test pass while
/// <see cref="PlatformDashboardDataSource"/> was deleted.</para>
///
/// <para><b>Timestamps are <c>timestamp(3) without time zone</c>, as prod has them</b>, so Npgsql yields
/// <see cref="DateTimeKind.Unspecified"/> and the NodeIso converter on <c>RecentActivityItem</c> is
/// exercised for real (TRAP 6).</para>
///
/// <para><b>The seed is TIME-RELATIVE, unlike every prior read-slice fixture, because
/// <c>getUserGrowth</c>'s window derives from the wall clock at request time.</b> All timestamps hang off
/// <see cref="MonthStartUtc"/> (the first instant of the month current AT SEED TIME). A test whose
/// expectation depends on the current month must guard against the once-in-a-blue-moon run that straddles
/// a month boundary between seed and request — see the growth test's early return.</para>
///
/// <para><b>What the seed is shaped to prove</b> (each of these kills a specific mutation):
/// <list type="bullet">
/// <item>8 subscriptions split 1/3/3/1 — <c>1/8 = 12.5%</c>, which JS <c>Math.round</c> takes to 13 and
/// .NET banker's default takes to 12. The wire asserts 13.</item>
/// <item>An organization and a user created at the SAME instant (millisecond-equal) — the recent-activity
/// stable sort must keep the org first.</item>
/// <item>Users at <c>MonthStartUtc − 1s</c>, at exactly <c>MonthStartUtc.AddMonths(−5)</c> (the inclusive
/// window bound) and 1s BEFORE it (outside) — pinning the raw SQL's WHERE and the month grouping at both
/// boundaries.</item>
/// <item>A user created 30 minutes AFTER the month boundary — under a non-UTC session timezone, a
/// session-TZ-dependent <c>date_trunc</c> would file it under the previous month; the naive-column form
/// cannot.</item>
/// <item>An INACTIVE org and an INACTIVE, SOFT-DELETED user inside the newest five — the TS queries have
/// no <c>where</c> at all, and reproducing that is parity (the raw <c>db</c> client carries no soft-delete
/// extension; only <c>tenantDb</c> is extended).</item>
/// <item>A SIXTH-newest org and user — excluded, proving the per-source <c>take: 5</c>.</item>
/// </list></para>
///
/// <para>RLS is enabled + FORCED on <c>subscriptions</c>, and the cross-org read still succeeds — the
/// documented property of this surface: the connection is the privileged login role (superuser here,
/// BYPASSRLS in prod), the context is never wrapped in <c>TenantScope</c>, and <c>PlatformOwnerGate</c> is
/// the entire authorization boundary.</para>
/// </summary>
public sealed class PlatformDashboardReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_platform_dashboard_read";

    public const string PlatformOwnerSub = "sub-dash-platform-owner";
    public const string OrgUserSub = "sub-dash-org-user";

    // ── organizations ────────────────────────────────────────────────────────────────────────────────
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111"); // Acme, old
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222"); // Globex, old
    public static readonly Guid OrgC = Guid.Parse("33333333-3333-3333-3333-333333333333"); // 6th newest — excluded
    public static readonly Guid OrgD = Guid.Parse("44444444-4444-4444-4444-444444444444");
    public static readonly Guid OrgE = Guid.Parse("55555555-5555-5555-5555-555555555555");
    public static readonly Guid OrgF = Guid.Parse("66666666-6666-6666-6666-666666666666"); // INACTIVE, still listed
    public static readonly Guid OrgG = Guid.Parse("77777777-7777-7777-7777-777777777777");
    public static readonly Guid OrgH = Guid.Parse("88888888-8888-8888-8888-888888888888"); // ties with UserNewest

    // ── users ────────────────────────────────────────────────────────────────────────────────────────
    /// <summary>Org-less platform owner, created at EXACTLY the window's inclusive lower bound.</summary>
    public static readonly Guid PlatformOwnerId = Guid.Parse("c0000000-0000-0000-0000-000000000001");

    /// <summary>Ordinary OrgA user, created 1s BEFORE the window — in no growth bucket.</summary>
    public static readonly Guid OrgUserId = Guid.Parse("c0000000-0000-0000-0000-000000000002");

    /// <summary>Created at <c>MonthStartUtc − 1s</c> — previous-month bucket, and 6th-newest user.</summary>
    public static readonly Guid UserPreviousMonth = Guid.Parse("c0000000-0000-0000-0000-000000000003");

    /// <summary>Created 30 minutes AFTER the month boundary — the session-timezone pin.</summary>
    public static readonly Guid UserCurrent = Guid.Parse("c0000000-0000-0000-0000-000000000004");

    /// <summary>Millisecond-equal with <see cref="OrgH"/> — the stable-sort tie, and the non-zero-ms
    /// NodeIso pin.</summary>
    public static readonly Guid UserNewest = Guid.Parse("c0000000-0000-0000-0000-000000000005");

    /// <summary><c>is_platform_owner = true</c> — must surface as type <c>platform_owner</c>.</summary>
    public static readonly Guid UserSecondOwner = Guid.Parse("c0000000-0000-0000-0000-000000000006");

    /// <summary>INACTIVE and SOFT-DELETED, inside the newest five — must still be listed.</summary>
    public static readonly Guid UserGhost = Guid.Parse("c0000000-0000-0000-0000-000000000007");

    public static readonly Guid UserLater = Guid.Parse("c0000000-0000-0000-0000-000000000008");

    /// <summary>First instant (UTC) of the month that was current when the fixture seeded.</summary>
    public DateTime MonthStartUtc { get; private set; }

    public string ConnectionString { get; private set; } = string.Empty;

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        var nowUtc = DateTime.UtcNow;
        MonthStartUtc = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using (var role = connection.CreateCommand())
        {
            role.CommandText = "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;";
            await role.ExecuteNonQueryAsync();
        }

        foreach (var sql in new[] { SchemaSql, BuildSeedSql(MonthStartUtc) })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    /// <summary>A context built the way PRODUCTION builds it — through
    /// <see cref="PlatformDashboardDataSource"/>, so <c>EnableUnmappedTypes</c> is in play.</summary>
    public PlatformDashboardReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<PlatformDashboardReadDbContext>()
            .UseNpgsql(PlatformDashboardDataSource.Build(ConnectionString))
            .Options);

    /// <summary>A context on a PLAIN connection string — used by the regression test that proves the data
    /// source is load-bearing rather than decorative.</summary>
    public PlatformDashboardReadDbContext NewReadContextWithoutUnmappedTypes() =>
        new(new DbContextOptionsBuilder<PlatformDashboardReadDbContext>()
            .UseNpgsql(ConnectionString)
            .Options);

    /// <summary><c>timestamp(3)</c> literal — naive, millisecond precision, no zone suffix.</summary>
    private static string Ts(DateTime value) =>
        value.ToString("yyyy-MM-dd'T'HH:mm:ss.fff", CultureInfo.InvariantCulture);

    // Native enums FIRST (organizations.plan references "OrgPlan"), then the identity plane the resolver
    // needs (roles/user_roles schema-only — IdentityRepository unconditionally Includes them, so without
    // these tables the resolve 500s BEFORE the gate is reached, TRAP 4), then the domain tables.
    // audit_logs exists because SecurityDenialAuditMiddleware records denials fail-soft on the 403 paths.
    private const string SchemaSql =
        """
        CREATE TYPE public."OrgPlan" AS ENUM ('trial', 'starter', 'professional', 'enterprise');
        CREATE TYPE public."SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            plan public."OrgPlan" DEFAULT 'trial'::public."OrgPlan" NOT NULL,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            avatar text NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true,
            deleted_at timestamp(3) without time zone NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            slug text NOT NULL
        );
        CREATE TABLE user_roles (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users (id),
            role_id uuid NOT NULL REFERENCES roles (id)
        );
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

        -- organization_id is UNIQUE as prod has it (one subscription per org — the reason the seed needs
        -- eight orgs to carry eight subscriptions). `status` is unmapped by the context but kept
        -- prod-faithful; its DEFAULT satisfies the inserts.
        CREATE TABLE subscriptions (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL UNIQUE REFERENCES organizations (id),
            plan public."OrgPlan" DEFAULT 'trial'::public."OrgPlan" NOT NULL,
            status public."SubscriptionStatus" DEFAULT 'trialing'::public."SubscriptionStatus" NOT NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        GRANT SELECT ON subscriptions TO app_tenant;
        ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON subscriptions
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private static string BuildSeedSql(DateTime m0)
    {
        var m5 = m0.AddMonths(-5); // the window's inclusive lower bound

        return $"""
        INSERT INTO organizations (id, name, plan, is_active, created_at) VALUES
          ('{OrgA}', 'Acme Corp',         'trial',        true,  '{Ts(m5)}'),
          ('{OrgB}', 'Globex Inc',        'starter',      true,  '{Ts(m5.AddDays(1))}'),
          ('{OrgC}', 'Initech',           'starter',      true,  '{Ts(m0.AddMinutes(5))}'),
          ('{OrgD}', 'Umbrella Corp',     'starter',      true,  '{Ts(m0.AddMinutes(15))}'),
          ('{OrgE}', 'Stark Industries',  'professional', true,  '{Ts(m0.AddMinutes(25))}'),
          ('{OrgF}', 'Wayne Enterprises', 'professional', false, '{Ts(m0.AddMinutes(35))}'),
          ('{OrgG}', 'Hooli',             'professional', true,  '{Ts(m0.AddMinutes(44))}'),
          ('{OrgH}', 'Pied Piper',        'enterprise',   true,  '{Ts(m0.AddMinutes(45).AddMilliseconds(123))}');

        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active, deleted_at, created_at) VALUES
          ('{PlatformOwnerId}',   NULL,      '{PlatformOwnerSub}',  'owner@tims.test',    'Olivia', 'Owner',     true,  true,  NULL,               '{Ts(m5)}'),
          ('{OrgUserId}',         '{OrgA}',  '{OrgUserSub}',        'orguser@tims.test',  'Rick',   'Recruiter', false, true,  NULL,               '{Ts(m5.AddSeconds(-1))}'),
          ('{UserPreviousMonth}', '{OrgA}',  'sub-dash-previous',   'previous@acme.test', 'Priya',  'Previous',  false, true,  NULL,               '{Ts(m0.AddSeconds(-1))}'),
          ('{UserCurrent}',       '{OrgA}',  'sub-dash-current',    'current@acme.test',  'Carlos', 'Current',   false, true,  NULL,               '{Ts(m0.AddMinutes(30))}'),
          ('{UserNewest}',        '{OrgA}',  'sub-dash-newest',     'newest@acme.test',   'Nina',   'Newest',    false, true,  NULL,               '{Ts(m0.AddMinutes(45).AddMilliseconds(123))}'),
          ('{UserSecondOwner}',   '{OrgB}',  'sub-dash-owner2',     'owner2@tims.test',   'Pat',    'Platform',  true,  true,  NULL,               '{Ts(m0.AddMinutes(40))}'),
          ('{UserGhost}',         '{OrgB}',  'sub-dash-ghost',      'ghost@globex.test',  'Gus',    'Ghost',     false, false, '{Ts(m0.AddMinutes(21))}', '{Ts(m0.AddMinutes(20))}'),
          ('{UserLater}',         '{OrgA}',  'sub-dash-later',      'later@acme.test',    'Lena',   'Later',     false, true,  NULL,               '{Ts(m0.AddMinutes(10))}');

        -- 1 trial / 3 starter / 3 professional / 1 enterprise over 8 rows: 12.5% and 37.5% are BOTH exact
        -- midpoints, and 12.5 is the one that separates JS Math.round (13) from banker's (12).
        INSERT INTO subscriptions (id, organization_id, plan) VALUES
          ('f0000000-0000-0000-0000-000000000001', '{OrgA}', 'trial'),
          ('f0000000-0000-0000-0000-000000000002', '{OrgB}', 'starter'),
          ('f0000000-0000-0000-0000-000000000003', '{OrgC}', 'starter'),
          ('f0000000-0000-0000-0000-000000000004', '{OrgD}', 'starter'),
          ('f0000000-0000-0000-0000-000000000005', '{OrgE}', 'professional'),
          ('f0000000-0000-0000-0000-000000000006', '{OrgF}', 'professional'),
          ('f0000000-0000-0000-0000-000000000007', '{OrgG}', 'professional'),
          ('f0000000-0000-0000-0000-000000000008', '{OrgH}', 'enterprise');
        """;
    }
}

// One [CollectionDefinition] per collection name — shared by every test class in this slice so the
// container is started once.
[CollectionDefinition("PlatformDashboardRead")]
public sealed class PlatformDashboardReadCollection : ICollectionFixture<PlatformDashboardReadFixture>;
