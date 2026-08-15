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

    // ── PR 2 users ───────────────────────────────────────────────────────────────────────────────────
    // ALL created at m0 − 7 months, which puts them OUTSIDE the six-month getUserGrowth window AND below
    // the five newest users, so every PR-1 expectation (growth counts [1,0,0,0,1,5]; the exact
    // recent-activity list) is untouched. Their job is login recency and _count totals, not creation time.
    public static readonly Guid OrgBUserFirst = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid OrgDUserFirst = Guid.Parse("d0000000-0000-0000-0000-000000000101");
    public static readonly Guid OrgGUserFirst = Guid.Parse("d0000000-0000-0000-0000-000000000201");
    public static readonly Guid OrgHUserFirst = Guid.Parse("d0000000-0000-0000-0000-000000000301");

    // ── PR 2 invoices ────────────────────────────────────────────────────────────────────────────────
    /// <summary>OrgA, pending, 3 days overdue, 1234.5 USD — the toLocaleString grouping pin.</summary>
    public static readonly Guid InvoiceOverdueAcme = Guid.Parse("e0000000-0000-0000-0000-000000000001");

    /// <summary>OrgB, pending, 10 days overdue, 2000 EUR — a NON-USD currency, and the older due date so
    /// it sorts first.</summary>
    public static readonly Guid InvoiceOverdueGlobex = Guid.Parse("e0000000-0000-0000-0000-000000000002");

    // ── PR 2 invitations ─────────────────────────────────────────────────────────────────────────────
    /// <summary>Pending, 9 days old, WITH an organization.</summary>
    public static readonly Guid InvitationStaleAcme = Guid.Parse("f1000000-0000-0000-0000-000000000001");

    /// <summary>Sent, 6 days old, org-less — the only row that puts a NULL on the wire.</summary>
    public static readonly Guid InvitationStaleOrphan = Guid.Parse("f1000000-0000-0000-0000-000000000002");

    /// <summary>The stale invitation's invitee address; it appears verbatim in the item TITLE.</summary>
    public const string StaleInvitationEmail = "stale-invite@acme.test";

    /// <summary>The org-less stale invitation's invitee address.</summary>
    public const string OrphanInvitationEmail = "orphan-invite@nowhere.test";

    /// <summary>First instant (UTC) of the month that was current when the fixture seeded.</summary>
    public DateTime MonthStartUtc { get; private set; }

    /// <summary>
    /// The instant the fixture seeded, truncated to whole milliseconds.
    ///
    /// <para>A SECOND anchor, added by PR 2 and deliberately not <see cref="MonthStartUtc"/>. The six new
    /// reads have rolling windows (7 days of trials, 5 days of stale invitations, 7/14 days of login
    /// recency), so hanging their rows off the start of the month would make every expectation depend on
    /// WHICH day of the month the suite happens to run. Off this anchor a row seeded at "now − 3 days" is
    /// three days old at request time and nothing else, whatever the date.</para>
    ///
    /// <para>The few seconds between seeding and the request only ever ADD to an elapsed span, so a
    /// <c>Math.floor</c> day count is stable and a <c>Math.ceil</c> one is too — provided no row sits
    /// exactly on a boundary. None does; every offset below is a whole number of days.</para>
    /// </summary>
    public DateTime SeedNowUtc { get; private set; }

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
        SeedNowUtc = nowUtc.AddTicks(-(nowUtc.Ticks % TimeSpan.TicksPerMillisecond));

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using (var role = connection.CreateCommand())
        {
            role.CommandText = "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;";
            await role.ExecuteNonQueryAsync();
        }

        foreach (var sql in new[] { SchemaSql, BuildSeedSql(MonthStartUtc, SeedNowUtc), BuildInsightSeedSql(MonthStartUtc, SeedNowUtc) })
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
        -- PR 2. Native enums again, and again for TRAP 3: invoices.status, platform_invitations.status
        -- and platform_invitations.type are all Postgres enums in prod. Declaring them `text` here would
        -- let EnableUnmappedTypes be deleted with the whole suite green.
        CREATE TYPE public."InvoiceStatus" AS ENUM ('draft', 'pending', 'paid', 'void');
        CREATE TYPE public."InvitationType" AS ENUM ('org_admin', 'user');
        CREATE TYPE public."InvitationStatus" AS ENUM ('pending', 'sent', 'accepted', 'expired', 'revoked');

        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            slug text NOT NULL UNIQUE,
            domain text NULL UNIQUE,
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
            last_login_at timestamp(3) without time zone NULL,
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
            trial_ends_at timestamp(3) without time zone NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        GRANT SELECT ON subscriptions TO app_tenant;
        ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON subscriptions
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        -- PR 2 tables. `amount` is double precision, as Prisma's Float maps — NOT numeric, because the
        -- value is fed to a JS-style number formatter and a decimal round-trip would change it.
        CREATE TABLE invoices (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id),
            amount double precision NOT NULL,
            currency text NOT NULL DEFAULT 'USD',
            status public."InvoiceStatus" DEFAULT 'draft'::public."InvoiceStatus" NOT NULL,
            due_date timestamp(3) without time zone NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        CREATE TABLE platform_invitations (
            id uuid PRIMARY KEY,
            email text NOT NULL,
            type public."InvitationType" NOT NULL,
            organization_id uuid NULL REFERENCES organizations (id),
            status public."InvitationStatus" DEFAULT 'pending'::public."InvitationStatus" NOT NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        CREATE TABLE feature_flags (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id),
            key text NOT NULL,
            enabled boolean NOT NULL DEFAULT false
        );
        CREATE TABLE vacancies (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id),
            title text NOT NULL,
            status text NOT NULL DEFAULT 'draft'
        );

        -- RLS ENABLED + FORCED on all four PR-2 tables, exactly as production has them
        -- (packages/db/prisma/migrations/20260604100000_enable_rls_tenant_isolation), with the same
        -- fail-closed policy: an unset app.current_org_id matches NOTHING.
        --
        -- PR 1 declared this on `subscriptions` and made the point that the cross-org read still
        -- succeeds; PR 2's four tables initially shipped WITHOUT it, which would have made that proof
        -- cover one table out of seven. It matters here more than it looks: this context is never
        -- wrapped in TenantScope, so under a NOBYPASSRLS role every one of these policies matches zero
        -- rows and the failure mode is a well-formed 200 with SILENTLY TRUNCATED data — attention-items
        -- loses its invoice and invitation legs, customer-health reports overdueInvoices: 0 for every
        -- org, upsell reports features: 0 / vacancies: 0 — not an error anyone would notice.
        GRANT SELECT ON invoices, platform_invitations, feature_flags, vacancies TO app_tenant;
        ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
        ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON invoices
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE platform_invitations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE platform_invitations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON platform_invitations
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
        ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON feature_flags
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;
        ALTER TABLE vacancies FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON vacancies
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private static string BuildSeedSql(DateTime m0, DateTime seedNow)
    {
        var m5 = m0.AddMonths(-5); // the window's inclusive lower bound

        return $"""
        INSERT INTO organizations (id, name, slug, domain, plan, is_active, created_at) VALUES
          ('{OrgA}', 'Acme Corp',         'acme-corp',         'acme.test',   'trial',        true,  '{Ts(m5)}'),
          ('{OrgB}', 'Globex Inc',        'globex-inc',        'globex.test', 'starter',      true,  '{Ts(m5.AddDays(1))}'),
          ('{OrgC}', 'Initech',           'initech',           NULL,          'starter',      true,  '{Ts(m0.AddMinutes(5))}'),
          ('{OrgD}', 'Umbrella Corp',     'umbrella-corp',     NULL,          'starter',      true,  '{Ts(m0.AddMinutes(15))}'),
          ('{OrgE}', 'Stark Industries',  'stark-industries',  NULL,          'professional', true,  '{Ts(m0.AddMinutes(25))}'),
          ('{OrgF}', 'Wayne Enterprises', 'wayne-enterprises', NULL,          'professional', false, '{Ts(m0.AddMinutes(35))}'),
          ('{OrgG}', 'Hooli',             'hooli',             NULL,          'professional', true,  '{Ts(m0.AddMinutes(44))}'),
          ('{OrgH}', 'Pied Piper',        'pied-piper',        NULL,          'enterprise',   true,  '{Ts(m0.AddMinutes(45).AddMilliseconds(123))}');

        -- PR 2 adds LAST_LOGIN_AT. It drives getCustomerHealth's login rate and staleness, and the
        -- upsell "active in last 7d" signal. UserCurrent's is deliberately NULL (a user who has never
        -- logged in still counts toward the denominator) and UserGhost's is deliberately RECENT even
        -- though the row is inactive, so an implementation that forgot the is_active filter would report
        -- a higher login rate for Globex and fail.
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active, last_login_at, deleted_at, created_at) VALUES
          ('{PlatformOwnerId}',   NULL,      '{PlatformOwnerSub}',  'owner@tims.test',    'Olivia', 'Owner',     true,  true,  NULL,                            NULL,               '{Ts(m5)}'),
          ('{OrgUserId}',         '{OrgA}',  '{OrgUserSub}',        'orguser@tims.test',  'Rick',   'Recruiter', false, true,  '{Ts(seedNow.AddDays(-1))}',     NULL,               '{Ts(m5.AddSeconds(-1))}'),
          ('{UserPreviousMonth}', '{OrgA}',  'sub-dash-previous',   'previous@acme.test', 'Priya',  'Previous',  false, true,  '{Ts(seedNow.AddDays(-2))}',     NULL,               '{Ts(m0.AddSeconds(-1))}'),
          ('{UserCurrent}',       '{OrgA}',  'sub-dash-current',    'current@acme.test',  'Carlos', 'Current',   false, true,  NULL,                            NULL,               '{Ts(m0.AddMinutes(30))}'),
          ('{UserNewest}',        '{OrgA}',  'sub-dash-newest',     'newest@acme.test',   'Nina',   'Newest',    false, true,  '{Ts(seedNow.AddDays(-20))}',    NULL,               '{Ts(m0.AddMinutes(45).AddMilliseconds(123))}'),
          ('{UserSecondOwner}',   '{OrgB}',  'sub-dash-owner2',     'owner2@tims.test',   'Pat',    'Platform',  true,  true,  '{Ts(seedNow.AddDays(-30))}',    NULL,               '{Ts(m0.AddMinutes(40))}'),
          ('{UserGhost}',         '{OrgB}',  'sub-dash-ghost',      'ghost@globex.test',  'Gus',    'Ghost',     false, false, '{Ts(seedNow)}',                 '{Ts(m0.AddMinutes(21))}', '{Ts(m0.AddMinutes(20))}'),
          ('{UserLater}',         '{OrgA}',  'sub-dash-later',      'later@acme.test',    'Lena',   'Later',     false, true,  '{Ts(seedNow.AddDays(-3))}',     NULL,               '{Ts(m0.AddMinutes(10))}');

        -- 1 trial / 3 starter / 3 professional / 1 enterprise over 8 rows: 12.5% and 37.5% are BOTH exact
        -- midpoints, and 12.5 is the one that separates JS Math.round (13) from banker's (12).
        -- getPlanDistribution ignores `status` entirely, so the PR-2 statuses below leave it unchanged.
        --
        -- PR 2 gives every row an explicit STATUS and CREATED_AT. Before that they all defaulted to
        -- 'trialing' at CURRENT_TIMESTAMP, which would have made both MRR endpoints return twelve zeroes
        -- (they filter status = 'active') — a green suite proving nothing.
        --   ACTIVE (counted by MRR): A trial@m5, B starter@m5, C starter@m0, E professional@m0,
        --                            H enterprise@m0  →  0 + 499 in the m5 bucket, 3997 more in m0.
        --   TRIALING: D (ends in 3 days → an ATTENTION item) and G (ends in 30 days → outside the window).
        --   PAST_DUE: F  → the failed-payment attention item.
        INSERT INTO subscriptions (id, organization_id, plan, status, trial_ends_at, created_at) VALUES
          ('f0000000-0000-0000-0000-000000000001', '{OrgA}', 'trial',        'active',   NULL, '{Ts(m5)}'),
          ('f0000000-0000-0000-0000-000000000002', '{OrgB}', 'starter',      'active',   NULL, '{Ts(m5.AddDays(1))}'),
          ('f0000000-0000-0000-0000-000000000003', '{OrgC}', 'starter',      'active',   NULL, '{Ts(m0.AddMinutes(5))}'),
          ('f0000000-0000-0000-0000-000000000004', '{OrgD}', 'starter',      'trialing', '{Ts(seedNow.AddDays(3))}', '{Ts(m0.AddMinutes(15))}'),
          ('f0000000-0000-0000-0000-000000000005', '{OrgE}', 'professional', 'active',   NULL, '{Ts(m0.AddMinutes(25))}'),
          ('f0000000-0000-0000-0000-000000000006', '{OrgF}', 'professional', 'past_due', NULL, '{Ts(m0.AddMinutes(35))}'),
          ('f0000000-0000-0000-0000-000000000007', '{OrgG}', 'professional', 'trialing', '{Ts(seedNow.AddDays(30))}', '{Ts(m0.AddMinutes(44))}'),
          ('f0000000-0000-0000-0000-000000000008', '{OrgH}', 'enterprise',   'active',   NULL, '{Ts(m0.AddMinutes(45).AddMilliseconds(123))}');
        """;
    }

    /// <summary>
    /// The PR-2 rows: extra users, invoices, invitations, feature flags and vacancies for the six FX-free
    /// insight reads.
    ///
    /// <para><b>Every added user is created at <c>m0 − 7 months</c>, and that is not arbitrary.</b> It puts
    /// them outside <c>getUserGrowth</c>'s six-month window AND below the five newest users, so PR 1's
    /// exact expectations — growth counts <c>[1, 0, 0, 0, 1, 5]</c> and the ten-item recent-activity list
    /// — are untouched by any of them. What these users contribute is login recency and <c>_count</c>
    /// totals, neither of which depends on creation time.</para>
    ///
    /// <para>Shaped so the three customer-health bands are ALL populated, which the PR-1 seed could not
    /// do: with no users at all, every organization scores 999 days since last login and lands
    /// <c>critical</c>, and the band ordering would be asserted against a single band.
    /// <list type="bullet">
    /// <item>Umbrella (D) — 2 users, both logged in yesterday, but its trial ends in 3 days →
    /// <c>at_risk</c> through the TRIAL rule alone (login rate is a perfect 100).</item>
    /// <item>Hooli (G) — 4 users, 1 recent → a 25% login rate → <c>at_risk</c> through the LOGIN rule,
    /// while its trial (30 days out) is deliberately NOT the trigger.</item>
    /// <item>Pied Piper (H) — 2 users, both recent, no overdue invoice, no trial → the only
    /// <c>healthy</c> row.</item>
    /// </list>
    /// Two different routes into the same band matter: an implementation that dropped either clause of
    /// the <c>at_risk</c> disjunction would still pass if only one were seeded.</para>
    ///
    /// <para>Globex (B) is the upsell target, deliberately scoring the maximum 100: 10 users total
    /// (≥ 8), 5 feature flags (≥ 5), 6 users active in the last week (≥ ceil(8 × 0.7) = 6) and 3
    /// vacancies (≥ 3). Acme (A) scores 60 on the trial→starter rule, so the response carries one
    /// <c>high</c> and one <c>medium</c> and proves the mrrIncrease-descending sort with two different
    /// increases (500 before 499).</para>
    /// </summary>
    private static string BuildInsightSeedSql(DateTime m0, DateTime seedNow)
    {
        // Old enough to be irrelevant to both PR-1 endpoints; see the summary.
        var old = m0.AddMonths(-7);
        var recent = Ts(seedNow.AddDays(-1));
        var stale = Ts(seedNow.AddDays(-60));

        var globexUsers = string.Join(",\n          ", Enumerable.Range(1, 8).Select(i =>
        {
            var id = new Guid($"d0000000-0000-0000-0000-00000000000{i}");
            // B1..B6 logged in yesterday (6 = exactly the starter rule's active threshold); B7/B8 are
            // long-dormant, so the count sits ON the boundary rather than comfortably past it.
            var lastLogin = i <= 6 ? recent : stale;
            return $"('{id}', '{OrgB}', 'sub-dash-globex-{i}', 'bern{i}@globex.test', 'Bern{i}', 'Globex', false, true, '{lastLogin}', NULL, '{Ts(old.AddMinutes(i))}')";
        }));

        var umbrellaUsers = string.Join(",\n          ", Enumerable.Range(1, 2).Select(i =>
        {
            var id = new Guid($"d0000000-0000-0000-0000-00000000010{i}");
            return $"('{id}', '{OrgD}', 'sub-dash-umbrella-{i}', 'ursula{i}@umbrella.test', 'Ursula{i}', 'Umbrella', false, true, '{recent}', NULL, '{Ts(old.AddMinutes(20 + i))}')";
        }));

        var hooliUsers = string.Join(",\n          ", Enumerable.Range(1, 4).Select(i =>
        {
            var id = new Guid($"d0000000-0000-0000-0000-00000000020{i}");
            // Exactly ONE of four is recent → 25%, just under the 30% at_risk threshold.
            var lastLogin = i == 1 ? Ts(seedNow.AddDays(-2)) : stale;
            return $"('{id}', '{OrgG}', 'sub-dash-hooli-{i}', 'hector{i}@hooli.test', 'Hector{i}', 'Hooli', false, true, '{lastLogin}', NULL, '{Ts(old.AddMinutes(40 + i))}')";
        }));

        var piperUsers = string.Join(",\n          ", Enumerable.Range(1, 2).Select(i =>
        {
            var id = new Guid($"d0000000-0000-0000-0000-00000000030{i}");
            return $"('{id}', '{OrgH}', 'sub-dash-piper-{i}', 'pablo{i}@piedpiper.test', 'Pablo{i}', 'Piper', false, true, '{recent}', NULL, '{Ts(old.AddMinutes(60 + i))}')";
        }));

        var featureFlags = string.Join(",\n          ", Enumerable.Range(1, 5).Select(i =>
            $"('{new Guid($"a1000000-0000-0000-0000-00000000000{i}")}', '{OrgB}', 'flag-{i}', {(i % 2 == 0 ? "true" : "false")})"));

        // `_count.featureFlags` and `_count.vacancies` count EVERY row — the disabled flags and the
        // 'closed' vacancy below are included, which is why they are seeded that way.
        var vacancies = string.Join(",\n          ", Enumerable.Range(1, 3).Select(i =>
            $"('{new Guid($"a2000000-0000-0000-0000-00000000000{i}")}', '{OrgB}', 'Role {i}', '{(i == 3 ? "closed" : "open")}')"));

        return $"""
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_platform_owner, is_active, last_login_at, deleted_at, created_at) VALUES
          {globexUsers},
          {umbrellaUsers},
          {hooliUsers},
          {piperUsers};

        -- Two overdue (pending, past due date) plus two decoys that must NOT appear: a pending invoice
        -- still in date, and a PAID one that is long past due. Globex's is both older and non-USD, so it
        -- sorts first and proves the currency is read from the row rather than assumed.
        INSERT INTO invoices (id, organization_id, amount, currency, status, due_date) VALUES
          ('{InvoiceOverdueAcme}',                   '{OrgA}', 1234.5, 'USD', 'pending', '{Ts(seedNow.AddDays(-3))}'),
          ('{InvoiceOverdueGlobex}',                 '{OrgB}', 2000,   'EUR', 'pending', '{Ts(seedNow.AddDays(-10))}'),
          ('e0000000-0000-0000-0000-000000000003',   '{OrgA}', 500,    'USD', 'pending', '{Ts(seedNow.AddDays(5))}'),
          ('e0000000-0000-0000-0000-000000000004',   '{OrgA}', 750,    'USD', 'paid',    '{Ts(seedNow.AddDays(-20))}');

        -- Two stale (pending/sent, older than 5 days) plus two decoys: one sent yesterday, one accepted.
        -- The org-less row is the ONLY source of a null on the attention-items wire.
        INSERT INTO platform_invitations (id, email, type, organization_id, status, created_at) VALUES
          ('{InvitationStaleAcme}',                '{StaleInvitationEmail}',  'user',      '{OrgA}', 'pending',  '{Ts(seedNow.AddDays(-9))}'),
          ('{InvitationStaleOrphan}',              '{OrphanInvitationEmail}', 'org_admin', NULL,     'sent',     '{Ts(seedNow.AddDays(-6))}'),
          ('f1000000-0000-0000-0000-000000000003', 'fresh-invite@acme.test',  'user',      '{OrgA}', 'pending',  '{Ts(seedNow.AddDays(-1))}'),
          ('f1000000-0000-0000-0000-000000000004', 'done-invite@acme.test',   'user',      '{OrgA}', 'accepted', '{Ts(seedNow.AddDays(-20))}');

        INSERT INTO feature_flags (id, organization_id, key, enabled) VALUES
          {featureFlags};

        INSERT INTO vacancies (id, organization_id, title, status) VALUES
          {vacancies};
        """;
    }
}

// One [CollectionDefinition] per collection name — shared by every test class in this slice so the
// container is started once.
[CollectionDefinition("PlatformDashboardRead")]
public sealed class PlatformDashboardReadCollection : ICollectionFixture<PlatformDashboardReadFixture>;
