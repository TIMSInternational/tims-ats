using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Testcontainers fixture for <see cref="PlatformOrganizationsReadRepository.ListAsync"/> AND
/// <see cref="PlatformOrganizationsReadRepository.GetByIdAsync"/> — issue <b>#211</b>.
///
/// <para><b>Why a new fixture rather than reusing slice 20's.</b> These two methods read ELEVEN tables
/// and <c>PlatformOrganizationsWriteFixture</c> creates only <c>organizations</c> and <c>users</c>.
/// Widening a fixture that 30-odd green write tests already depend on, in order to add read coverage,
/// risks changing what those tests exercise; a self-contained fixture cannot.</para>
///
/// <para><b>The detail half was added 2026-08-11, after the list half shipped without it.</b> #211's
/// single biggest edit was the <c>getOrganization</c> payload — 27 non-null scalars restored across six
/// nested records, plus ~30 new <c>HasColumnName</c> mappings for companies / business_units / teams /
/// feature_flags / billing_profiles / subscriptions. NOTHING executed any of it: no test in either
/// project called <c>GetByIdAsync</c>, and
/// <c>PlatformOrganizationsReadModelsSerializationTests.BuildDetail()</c> hand-constructs the record, so
/// it supplies the very values under test. Two failure modes were therefore invisible — a positional
/// argument swap in the projection (e.g. <c>b.OrganizationId</c> / <c>b.CompanyId</c>) ships a wrong wire
/// payload silently, and a typo'd <c>HasColumnName</c> throws on first use in production. The parity
/// harness cannot backstop either: both flags are dark, so <c>verify organization</c> fails closed.</para>
///
/// <para><b>The seed is the test.</b> Two properties of <c>ListAsync</c> were provably unguarded before
/// this file — deleting the <c>users</c> empty-array branch and deleting the invoice <c>OrderBy</c> each
/// left the entire 998-unit / 1241-integration suite green. Both are projection decisions taken INSIDE
/// the repository, so no serialization unit test can reach them: those construct the read model directly
/// and therefore supply the very values in question. The seed below is arranged so each decision has an
/// observable, wrong answer available to it.</para>
///
/// <para><b>Native enum columns are load-bearing here too</b> — <c>organizations.plan</c>,
/// <c>subscriptions.plan</c>/<c>status</c> and <c>invoices.status</c> are all real Postgres enums read
/// into C# strings, which is why the context is built on
/// <see cref="PlatformOrganizationsDataSource"/> and not a plain connection string (see
/// PlatformOrganizationsReadDbContextTests for the defect that proved it).</para>
/// </summary>
public sealed class PlatformOrganizationsReadListFixture : IAsyncLifetime
{
    /// <summary>Two users, BOTH with a null <c>last_login_at</c> — the empty-array case.</summary>
    public static readonly Guid OrgNoLogin = Guid.Parse("11111111-1111-4111-8111-111111111111");

    /// <summary>Two users with logins; the repository must surface only the MOST RECENT.</summary>
    public static readonly Guid OrgWithLogin = Guid.Parse("22222222-2222-4222-8222-222222222222");

    /// <summary>Three pending invoices plus one paid one — the ordering case.</summary>
    public static readonly Guid OrgInvoices = Guid.Parse("33333333-3333-4333-8333-333333333333");

    /// <summary>The most recent login on <see cref="OrgWithLogin"/>. Whole milliseconds: Postgres
    /// <c>timestamp(3)</c> would round anything finer and the equality assertion would be flaky.</summary>
    public static readonly DateTime NewerLogin = new(2026, 8, 11, 9, 30, 0, DateTimeKind.Unspecified);

    public static readonly DateTime OlderLogin = new(2026, 8, 1, 9, 30, 0, DateTimeKind.Unspecified);

    // THE THREE PENDING INVOICE IDS. Ordinal-string ascending — what the repository does, and what
    // Postgres `ORDER BY uuid` does — is Low, Mid, High, which is NOT the order SeedSql inserts them in.
    // That difference is what makes removing the OrderBy observable.
    //
    // These ids were originally picked to also separate ordinal ordering from `OrderBy(Guid.Parse(...))`,
    // on the belief that .NET compares the leading 4 bytes as a signed int. MEASURED 2026-08-11 on
    // net10.0: it does not (Guid.CompareTo casts _a to uint), and the two orderings agree — on this
    // triple and on 1,000,000 random pairs, zero disagreements, which also matched bytewise big-endian
    // order exactly. The ids are kept because they still span the range, but no test here claims a
    // distinction between those two implementations, because there is none to claim.
    public static readonly Guid InvoiceLow = Guid.Parse("00000000-0000-4000-8000-000000000001");
    public static readonly Guid InvoiceMid = Guid.Parse("7fffffff-ffff-4fff-8fff-ffffffffffff");
    public static readonly Guid InvoiceHigh = Guid.Parse("ffffffff-ffff-4fff-8fff-ffffffffffff");

    // ── the DETAIL org (GetByIdAsync) ────────────────────────────────────────────────────────────
    // A SEPARATE org from the three above, so the list tests' counts and orderings are untouched by it.

    /// <summary>The org <see cref="PlatformOrganizationsReadRepository.GetByIdAsync"/> is exercised
    /// against: one company → one business unit → one team, plus a subscription, a feature flag, a
    /// billing profile, two users, one vacancy, one invoice, and three invitations of which only two are
    /// open.</summary>
    public static readonly Guid OrgDetail = Guid.Parse("44444444-4444-4444-8444-444444444444");

    public static readonly Guid DetailCompany = Guid.Parse("c0000000-0000-4000-8000-000000000001");
    public static readonly Guid DetailUnit = Guid.Parse("b0000000-0000-4000-8000-000000000001");
    public static readonly Guid DetailTeam = Guid.Parse("70000000-0000-4000-8000-000000000001");
    public static readonly Guid DetailTeamLeader = Guid.Parse("a4444444-4444-4444-8444-444444444441");
    public static readonly Guid DetailOtherUser = Guid.Parse("a4444444-4444-4444-8444-444444444442");
    public static readonly Guid DetailSubscription = Guid.Parse("50000000-0000-4000-8000-000000000001");
    public static readonly Guid DetailFeatureFlag = Guid.Parse("f0000000-0000-4000-8000-000000000001");
    public static readonly Guid DetailBillingProfile = Guid.Parse("d0000000-0000-4000-8000-000000000001");

    /// <summary>An org id that exists in no table — <c>GetByIdAsync</c> must return null, not throw.</summary>
    public static readonly Guid OrgAbsent = Guid.Parse("99999999-9999-4999-8999-999999999999");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .WithDatabase("tims_read_list")
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await ExecuteAsync(connection, SchemaSql);
        await ExecuteAsync(connection, SeedSql);
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    /// <summary>The read context on the SAME EnableUnmappedTypes data source Program.cs wires.</summary>
    public PlatformOrganizationsReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<PlatformOrganizationsReadDbContext>()
            .UseNpgsql(PlatformOrganizationsDataSource.Build(ConnectionString))
            .Options);

    public PlatformOrganizationsReadRepository NewRepository() => new(NewReadContext());

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private const string SchemaSql =
        """
        CREATE TYPE "OrgPlan" AS ENUM ('trial', 'starter', 'professional', 'enterprise');
        CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');
        CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'pending', 'paid', 'void');
        -- Declaration order copied verbatim from baseline/prod-public-schema.sql:131-137. It is
        -- load-bearing for nothing here today, but an enum seeded in the wrong order is the exact class
        -- of fixture drift that made `sortBy: 'plan'` divergence invisible for two slices.
        CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'sent', 'accepted', 'expired', 'revoked');

        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            slug text NOT NULL UNIQUE,
            domain text NULL,
            logo text NULL,
            plan "OrgPlan" NOT NULL DEFAULT 'trial',
            settings jsonb NOT NULL DEFAULT '{}',
            billing_email text NULL,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL,
            deleted_at timestamp(3) NULL
        );

        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id) ON DELETE CASCADE,
            first_name text NOT NULL DEFAULT '',
            last_name text NOT NULL DEFAULT '',
            email text NOT NULL,
            job_title text NULL,
            is_active boolean NOT NULL DEFAULT true,
            last_login_at timestamp(3) NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE subscriptions (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL UNIQUE REFERENCES organizations (id) ON DELETE CASCADE,
            stripe_customer_id text NULL,
            stripe_subscription_id text NULL,
            plan "OrgPlan" NOT NULL DEFAULT 'trial',
            status "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
            current_period_start timestamp(3) NULL,
            current_period_end timestamp(3) NULL,
            trial_ends_at timestamp(3) NULL,
            cancelled_at timestamp(3) NULL,
            last_stripe_event_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        CREATE TABLE invoices (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            status "InvoiceStatus" NOT NULL DEFAULT 'draft',
            due_date timestamp(3) NULL
        );

        CREATE TABLE vacancies (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE
        );

        -- ── the detail path's six extra tables ──────────────────────────────────────────────────
        -- Column names, types and nullability are copied from packages/db/baseline/prod-public-schema.sql,
        -- NOT from the C# entities. That direction is the whole point: a HasColumnName typo must fail
        -- here, and it cannot if the fixture is written from the mapping under test.
        CREATE TABLE companies (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            name text NOT NULL,
            country text NOT NULL,
            currency text NOT NULL DEFAULT 'USD',
            timezone text NOT NULL DEFAULT 'America/Bogota',
            language text NOT NULL DEFAULT 'es',
            legal_name text NULL,
            tax_id text NULL,
            settings jsonb NOT NULL DEFAULT '{}',
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        CREATE TABLE business_units (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
            name text NOT NULL,
            code text NULL,
            parent_id uuid NULL REFERENCES business_units (id),
            settings jsonb NOT NULL DEFAULT '{}',
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        CREATE TABLE teams (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            business_unit_id uuid NOT NULL REFERENCES business_units (id) ON DELETE CASCADE,
            name text NOT NULL,
            leader_id uuid NULL REFERENCES users (id),
            settings jsonb NOT NULL DEFAULT '{}',
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        CREATE TABLE feature_flags (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            key text NOT NULL,
            enabled boolean NOT NULL DEFAULT false,
            payload jsonb NULL,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        CREATE TABLE billing_profiles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL UNIQUE REFERENCES organizations (id) ON DELETE CASCADE,
            company_name text NULL,
            tax_id text NULL,
            address text NULL,
            city text NULL,
            state text NULL,
            country text NULL,
            zip_code text NULL,
            billing_email text NULL,
            billing_phone text NULL,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        -- Narrower than prod on PURPOSE: PlatformOrganizationInvitationEntity maps exactly these three
        -- columns, and the other thirteen carry NOT NULL constraints (token, invited_by_id, expires_at,
        -- …) that would force this fixture to invent values with no bearing on the projection. Same
        -- convention as `invoices` and `vacancies` above. A column the ENTITY maps must be here; a
        -- column only prod has need not be.
        CREATE TABLE platform_invitations (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id) ON DELETE CASCADE,
            status "InvitationStatus" NOT NULL DEFAULT 'pending'
        );
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id, name, slug, domain, logo, plan, settings, billing_email, is_active, created_at, updated_at, deleted_at) VALUES
            ('11111111-1111-4111-8111-111111111111', 'No Login Org', 'no-login', NULL, NULL, 'trial',   '{}', NULL, true, '2026-08-01 00:00:00', '2026-08-01 00:00:00', NULL),
            ('22222222-2222-4222-8222-222222222222', 'Login Org',    'login',    NULL, NULL, 'starter', '{}', NULL, true, '2026-08-02 00:00:00', '2026-08-02 00:00:00', NULL),
            ('33333333-3333-4333-8333-333333333333', 'Invoice Org',  'invoices', NULL, NULL, 'trial',   '{}', NULL, true, '2026-08-03 00:00:00', '2026-08-03 00:00:00', NULL),
            -- THE DETAIL ORG. Every nullable column is given a DISTINCT non-null value: a projection
            -- that swapped two adjacent nullable strings would be invisible if both were null, and
            -- `dropNullish` would hide it from the parity harness too.
            ('44444444-4444-4444-8444-444444444444', 'Detail Org', 'detail', 'detail.example', 'https://cdn.example/logo.png',
             'professional', '{"locale":"es","timezone":"America/Bogota"}', 'billing@detail.example',
             true, '2026-08-04 00:00:00', '2026-08-05 01:02:03.456', NULL);

        -- OrgNoLogin: users EXIST but have never logged in. That is the distinction that matters: the
        -- repository's lastLogins dictionary has no entry, and it must still emit `[]` rather than null.
        INSERT INTO users (id, organization_id, email, last_login_at) VALUES
            ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'a@no-login.test', NULL),
            ('a1111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 'b@no-login.test', NULL),
            ('a2222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', 'a@login.test',  '2026-08-01 09:30:00'),
            ('a2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'b@login.test',  '2026-08-11 09:30:00');

        -- ── the DETAIL org's rows ────────────────────────────────────────────────────────────────
        -- The two users have DIFFERENT created_at values, because GetByIdAsync orders them createdAt
        -- DESC (organizations.ts's `orderBy: { createdAt: 'desc' }`) and equal timestamps would make the
        -- ordering assertion pass by luck. `is_platform_owner` and `job_title` differ too, so a
        -- positional swap between the two bool members or between the two string members is visible.
        INSERT INTO users (id, organization_id, first_name, last_name, email, job_title, is_active, last_login_at, is_platform_owner, created_at) VALUES
            ('a4444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444444', 'Leader', 'One',  'leader@detail.example', 'Head of People', true,  '2026-08-09 08:00:00', false, '2026-08-04 00:00:00'),
            ('a4444444-4444-4444-8444-444444444442', '44444444-4444-4444-8444-444444444444', 'Second', 'Two',  'second@detail.example', NULL,             false, NULL,                  true,  '2026-08-06 00:00:00');

        -- organization_id and company_id/business_unit_id are DELIBERATELY DIFFERENT uuids on every row
        -- below. That is the whole point: swapping the two adjacent positional arguments in the
        -- PlatformOrganizationBusinessUnit / PlatformOrganizationTeam projections compiles cleanly and
        -- ships a wrong payload, and it is only detectable if the two values differ in the fixture.
        INSERT INTO companies (id, organization_id, name, country, currency, timezone, language, legal_name, tax_id, settings, is_active, created_at, updated_at) VALUES
            ('c0000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'Detail Co', 'CO', 'COP', 'America/Lima', 'en',
             'Detail Co S.A.S.', 'TAX-900', '{"co":1}', true, '2026-08-04 10:00:00', '2026-08-04 11:00:00');

        INSERT INTO business_units (id, organization_id, company_id, name, code, parent_id, settings, is_active, created_at, updated_at) VALUES
            ('b0000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000001',
             'General', 'BU-1', NULL, '{"bu":1}', true, '2026-08-04 12:00:00', '2026-08-04 13:00:00');

        INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, settings, is_active, created_at, updated_at) VALUES
            ('70000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'b0000000-0000-4000-8000-000000000001',
             'Equipo General', 'a4444444-4444-4444-8444-444444444441', '{"team":1}', true, '2026-08-04 14:00:00', '2026-08-04 15:00:00');

        -- Every nullable column non-null and DISTINCT, for the swap argument above. The five nullable
        -- dates also differ from each other so a converter applied to the wrong member is visible.
        INSERT INTO subscriptions (id, organization_id, stripe_customer_id, stripe_subscription_id, plan, status,
                                   current_period_start, current_period_end, trial_ends_at, cancelled_at, last_stripe_event_at,
                                   created_at, updated_at) VALUES
            ('50000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'cus_detail', 'sub_detail',
             'professional', 'active', '2026-07-01 00:00:00', '2026-08-01 00:00:00', '2026-06-01 00:00:00',
             '2026-05-01 00:00:00', '2026-04-01 00:00:00', '2026-03-01 00:00:00', '2026-02-01 00:00:00');

        INSERT INTO feature_flags (id, organization_id, key, enabled, payload, created_at, updated_at) VALUES
            ('f0000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'detail_flag', true,
             '{"variant":"b"}', '2026-08-04 16:00:00', '2026-08-04 17:00:00');

        INSERT INTO billing_profiles (id, organization_id, company_name, tax_id, address, city, state, country, zip_code,
                                      billing_email, billing_phone, created_at, updated_at) VALUES
            ('d0000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'Detail Billing Co', 'BTAX-1',
             '1 Detail Way', 'Bogota', 'Cundinamarca', 'CO', '110111', 'ap@detail.example', '+57-1-555-0100',
             '2026-08-04 18:00:00', '2026-08-04 19:00:00');

        -- THE FOUR `_count` RELATIONS ARE SEEDED TO FOUR DIFFERENT CARDINALITIES — users 2, vacancies 3,
        -- invoices 4, open invitations 5. Equal counts would let the four positional arguments of
        -- PlatformOrganizationDetailCounts be permuted with every assertion still green, which is the
        -- same swap hazard the distinct scalars above guard against.
        INSERT INTO vacancies (id, organization_id) VALUES
            ('e0000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444'),
            ('e0000000-0000-4000-8000-000000000011', '44444444-4444-4444-8444-444444444444'),
            ('e0000000-0000-4000-8000-000000000012', '44444444-4444-4444-8444-444444444444');

        -- All four are `draft`: the detail's invoice count is UNFILTERED by status, unlike the list's
        -- pending-only array, and seeding only non-pending rows is what proves that difference.
        INSERT INTO invoices (id, organization_id, status) VALUES
            ('e0000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'draft'),
            ('e0000000-0000-4000-8000-000000000021', '44444444-4444-4444-8444-444444444444', 'draft'),
            ('e0000000-0000-4000-8000-000000000022', '44444444-4444-4444-8444-444444444444', 'draft'),
            ('e0000000-0000-4000-8000-000000000023', '44444444-4444-4444-8444-444444444444', 'draft');

        -- SEVEN invitations, only FIVE of them open. `_count.invitations` counts pending+sent only
        -- (organizations.ts), so a projection that counted all seven — or that counted none — differs
        -- from 5 in both directions, and 5 collides with none of the other three counts.
        INSERT INTO platform_invitations (id, organization_id, status) VALUES
            ('e0000000-0000-4000-8000-000000000003', '44444444-4444-4444-8444-444444444444', 'pending'),
            ('e0000000-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', 'sent'),
            ('e0000000-0000-4000-8000-000000000005', '44444444-4444-4444-8444-444444444444', 'accepted'),
            ('e0000000-0000-4000-8000-000000000031', '44444444-4444-4444-8444-444444444444', 'pending'),
            ('e0000000-0000-4000-8000-000000000032', '44444444-4444-4444-8444-444444444444', 'pending'),
            ('e0000000-0000-4000-8000-000000000033', '44444444-4444-4444-8444-444444444444', 'sent'),
            ('e0000000-0000-4000-8000-000000000034', '44444444-4444-4444-8444-444444444444', 'revoked');

        -- SEEDED HIGH, MID, LOW — deliberately NOT the id-ascending order the repository must produce, so
        -- removing the OrderBy yields a visibly different sequence rather than an accidentally-correct one.
        INSERT INTO invoices (id, organization_id, status) VALUES
            ('ffffffff-ffff-4fff-8fff-ffffffffffff', '33333333-3333-4333-8333-333333333333', 'pending'),
            ('7fffffff-ffff-4fff-8fff-ffffffffffff', '33333333-3333-4333-8333-333333333333', 'pending'),
            ('00000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'pending'),
            -- A PAID invoice, so the `status = 'pending'` filter is not vacuous: without it this row
            -- would appear in the array and every ordering assertion below would fail loudly.
            ('0000000f-0000-4000-8000-00000000000f', '33333333-3333-4333-8333-333333333333', 'paid');
        """;
}
