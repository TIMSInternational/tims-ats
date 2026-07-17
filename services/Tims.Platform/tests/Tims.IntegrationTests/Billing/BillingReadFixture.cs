using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Billing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 3 Testcontainers fixture: one real Postgres carrying the Prisma-OWNED <c>invoices</c> ⋈
/// <c>subscriptions</c> tables (with the NATIVE Prisma enum types <c>InvoiceStatus</c>/<c>OrgPlan</c>/
/// <c>SubscriptionStatus</c>, faithful to prod) under the SAME RLS mechanism as <see cref="RlsFixture"/> —
/// NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE ROW LEVEL SECURITY, fail-closed
/// <c>tenant_isolation</c> policy — PLUS the identity/RBAC plane (privileged, no RLS) that the FIRST
/// staff-JWT product surface resolves through.
///
/// Billing seed — OrgA: four invoices (i1..i4; i3/i4 share <c>created_at</c> 2026-03-01 to exercise the id
/// tiebreak) + one subscription (SubA) linked to i1 (proves getInvoice's nested subscription); OrgB: one
/// invoice (cross-org isolation). Identity/RBAC seed: OrgA's <c>billing_reader</c> role grants
/// billing:read@organization (200 user); an <c>employee</c> role has no grant (403 user).
/// </summary>
public sealed class BillingReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_billing_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // OrgA invoices. i3/i4 share created_at 2026-03-01 → tiebreak on id asc (i3 < i4).
    public static readonly Guid InvoiceI1 = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    public static readonly Guid InvoiceI2 = Guid.Parse("d0000000-0000-0000-0000-000000000002");
    public static readonly Guid InvoiceI3 = Guid.Parse("d0000000-0000-0000-0000-000000000003");
    public static readonly Guid InvoiceI4 = Guid.Parse("d0000000-0000-0000-0000-000000000004");
    public static readonly Guid InvoiceB1 = Guid.Parse("d0000000-0000-0000-0000-0000000000b1");
    public static readonly Guid SubscriptionA = Guid.Parse("50000000-0000-0000-0000-00000000000a");

    // OrgB gets a CANCELLED enterprise subscription (Slice 3b): entitledPlan → trial limits, NOT unlimited.
    public static readonly Guid SubscriptionB = Guid.Parse("50000000-0000-0000-0000-00000000000b");

    // OrgC has NO subscription but DOES have assessment assignments spanning far-apart dates — proves the
    // getUsage all-time count branch (no period gate) with real rows, not just an empty org.
    public static readonly Guid OrgC = Guid.Parse("33333333-3333-3333-3333-333333333333");
    public const int OrgCAssessments = 2; // both counted all-time (no subscription → no period gate)

    // getUsage expected counts (Slice 3b). OrgA (SubA active professional, period 2026-06-01..07-01):
    //   employees = 2 active org users (billing-reader + no-grant; the +1 inactive is excluded);
    //   vacancies = 2 (published + draft; closed/cancelled/soft-deleted excluded);
    //   assessments = 2 assignments assignedAt >= 2026-06-01 (the 2026-05-01 one is before the period).
    public const int OrgAEmployees = 2;
    public const int OrgAVacancies = 2;
    public const int OrgAAssessments = 2;

    // OrgB (SubB cancelled enterprise, same period): employees = 1 active user; vacancies = 1 published;
    // assessments = 3 in-period assignments (a DISTINCT count from OrgA's 2 — so a cross-org bleed changes
    // the value, not just the total). Limits fall back to trial (5/3/20) because status = cancelled.
    public const int OrgBEmployees = 1;
    public const int OrgBVacancies = 1;
    public const int OrgBAssessments = 3;

    // Staff-JWT boot-matrix identity: the granted user's sub, the no-grant user's sub.
    public const string BillingUserSub = "sub-billing-reader";
    public const string NoGrantUserSub = "sub-no-billing-grant";

    private static readonly Guid BillingUserId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    private static readonly Guid NoGrantUserId = Guid.Parse("c0000000-0000-0000-0000-000000000002");

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
        // Same unmapped-types data source the Program.cs DI uses, so the native Prisma enum columns read
        // into C# strings identically in the direct-repo tests and the booted host.
        _dataSource = BillingReadDataSource.Build(ConnectionString);

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

        foreach (var sql in new[] { IdentitySchemaSql, IdentitySeedSql, BillingSchemaSql, BillingSeedSql, UsageSchemaSql, UsageSeedSql })
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

    public BillingReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<BillingReadDbContext>().UseNpgsql(_dataSource!).Options);

    // Identity/RBAC schema (privileged path, no RLS): the exact columns the EF identity entities map.
    private const string IdentitySchemaSql =
        """
        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            slug text NOT NULL,
            name text NOT NULL
        );
        CREATE TABLE user_roles (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users (id),
            role_id uuid NOT NULL REFERENCES roles (id)
        );
        CREATE TABLE permissions (
            id uuid PRIMARY KEY,
            module text NOT NULL,
            action text NOT NULL
        );
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY,
            role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id),
            scope text NOT NULL DEFAULT 'own'
        );
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee');

        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'billing', 'read');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization');

        INSERT INTO users (id, organization_id, supabase_user_id, email, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-billing-reader', 'billing@tims.test', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-no-billing-grant', 'nobilling@tims.test', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002');
        """;

    // Billing schema: native Prisma enum types + RLS (app_tenant + org GUC), faithful to prod.
    private const string BillingSchemaSql =
        """
        CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'pending', 'paid', 'void');
        CREATE TYPE "OrgPlan" AS ENUM ('trial', 'starter', 'professional', 'enterprise');
        CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

        CREATE TABLE subscriptions (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            stripe_customer_id text NULL,
            stripe_subscription_id text NULL,
            plan "OrgPlan" NOT NULL DEFAULT 'trial',
            status "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
            current_period_start timestamp(3) NULL,
            current_period_end timestamp(3) NULL,
            trial_ends_at timestamp(3) NULL,
            cancelled_at timestamp(3) NULL,
            last_stripe_event_at timestamp(3) NULL,
            created_at timestamp(3) NOT NULL,
            updated_at timestamp(3) NOT NULL
        );
        CREATE TABLE invoices (
            id uuid PRIMARY KEY,
            invoice_number integer NOT NULL,
            organization_id uuid NOT NULL,
            subscription_id uuid NULL,
            stripe_invoice_id text NULL,
            amount double precision NOT NULL,
            subtotal double precision NULL,
            tax_rate double precision NULL,
            currency text NOT NULL DEFAULT 'USD',
            status "InvoiceStatus" NOT NULL DEFAULT 'draft',
            description text NULL,
            invoice_date timestamp(3) NOT NULL,
            due_date timestamp(3) NULL,
            po_number text NULL,
            notes text NULL,
            memo text NULL,
            email_to text NULL,
            email_cc text NULL,
            paid_at timestamp(3) NULL,
            invoice_url text NULL,
            period_start timestamp(3) NULL,
            period_end timestamp(3) NULL,
            created_at timestamp(3) NOT NULL
        );

        GRANT SELECT ON subscriptions, invoices TO app_tenant;

        ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
        ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
        ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON subscriptions
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON invoices
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // OrgA: SubA (active professional) + i1..i4 (i1 references SubA). OrgB: one invoice (cross-org).
    private const string BillingSeedSql =
        """
        INSERT INTO subscriptions
          (id, organization_id, stripe_customer_id, stripe_subscription_id, plan, status,
           current_period_start, current_period_end, trial_ends_at, cancelled_at, last_stripe_event_at, created_at, updated_at) VALUES
          ('50000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'cus_A', 'sub_A', 'professional', 'active',
           '2026-06-01 00:00:00', '2026-07-01 00:00:00', '2026-05-15 00:00:00', NULL, '2026-06-02 12:30:45.123', '2026-05-01 09:00:00', '2026-06-02 12:30:45.123');

        INSERT INTO invoices
          (id, invoice_number, organization_id, subscription_id, stripe_invoice_id, amount, subtotal, tax_rate, currency, status,
           description, invoice_date, due_date, po_number, notes, memo, email_to, email_cc, paid_at, invoice_url, period_start, period_end, created_at) VALUES
          ('d0000000-0000-0000-0000-000000000001', 1001, '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-00000000000a', 'in_A1', 1234.56, 1234.5, 0.5, 'USD', 'paid',
           'June 2026', '2026-06-01 00:00:00', '2026-06-15 00:00:00', 'PO-1', 'thanks', 'memo', 'billing@acme.test', 'cc@acme.test', '2026-06-10 14:22:33.456', 'https://inv.test/A1', '2026-06-01 00:00:00', '2026-07-01 00:00:00', '2026-01-01 00:00:00'),
          ('d0000000-0000-0000-0000-000000000002', 1002, '11111111-1111-1111-1111-111111111111', NULL, NULL, 100, NULL, NULL, 'USD', 'pending',
           NULL, '2026-07-01 00:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-02-01 00:00:00'),
          ('d0000000-0000-0000-0000-000000000003', 1003, '11111111-1111-1111-1111-111111111111', NULL, NULL, 50, NULL, NULL, 'USD', 'draft',
           NULL, '2026-07-05 00:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-01 00:00:00'),
          ('d0000000-0000-0000-0000-000000000004', 1004, '11111111-1111-1111-1111-111111111111', NULL, NULL, 0, 0, 0, 'EUR', 'void',
           NULL, '2026-07-06 00:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-01 00:00:00'),
          ('d0000000-0000-0000-0000-0000000000b1', 2001, '22222222-2222-2222-2222-222222222222', NULL, NULL, 999.99, NULL, NULL, 'USD', 'paid',
           NULL, '2026-06-01 00:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-04-01 00:00:00');
        """;

    // getUsage count sources (Slice 3b): vacancies + assessment_assignments (plain-String status), PLUS RLS
    // on the pre-existing `users` table so the app_tenant-scoped employee count respects tenant isolation.
    // The privileged identity/RBAC reads run on the superuser `postgres` connection (bypass RLS, unaffected);
    // the counts run UNDER TenantScope (SET LOCAL ROLE app_tenant → NOBYPASSRLS → the policy filters by org).
    private const string UsageSchemaSql =
        """
        GRANT SELECT ON users TO app_tenant;
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        ALTER TABLE users FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON users
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        CREATE TABLE vacancies (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            status text NOT NULL DEFAULT 'draft',
            deleted_at timestamp(3) NULL
        );
        CREATE TABLE assessment_assignments (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            assigned_at timestamp(3) NOT NULL
        );

        GRANT SELECT ON vacancies, assessment_assignments TO app_tenant;

        ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;
        ALTER TABLE vacancies FORCE ROW LEVEL SECURITY;
        ALTER TABLE assessment_assignments ENABLE ROW LEVEL SECURITY;
        ALTER TABLE assessment_assignments FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON vacancies
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON assessment_assignments
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // OrgA (11111111): +1 inactive user (is_active filter); 2 counted vacancies (published+draft) plus
    // closed/cancelled/soft-deleted (excluded); 2 in-period + 1 pre-period assignment.
    // OrgB (22222222): a CANCELLED enterprise subscription (→ trial limits) + 1 active user, 1 published
    // vacancy, 2 in-period assignments (proves cross-org isolation + the cancelled-sub → trial fallback live).
    private const string UsageSeedSql =
        """
        INSERT INTO users (id, organization_id, supabase_user_id, email, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-inactive', 'inactive@tims.test', false, false),
          ('c0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'sub-orgb-user', 'orgb@tims.test', false, true);

        INSERT INTO subscriptions
          (id, organization_id, stripe_customer_id, stripe_subscription_id, plan, status,
           current_period_start, current_period_end, trial_ends_at, cancelled_at, last_stripe_event_at, created_at, updated_at) VALUES
          ('50000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', NULL, NULL, 'enterprise', 'cancelled',
           '2026-06-01 00:00:00', '2026-07-01 00:00:00', NULL, '2026-06-15 00:00:00', NULL, '2026-05-01 09:00:00', '2026-06-15 00:00:00');

        INSERT INTO vacancies (id, organization_id, status, deleted_at) VALUES
          ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'published', NULL),
          ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'draft', NULL),
          ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'closed', NULL),
          ('f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'cancelled', NULL),
          ('f0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'published', '2026-06-20 00:00:00'),
          ('f0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'published', NULL);

        INSERT INTO assessment_assignments (id, organization_id, assigned_at) VALUES
          ('aa000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-06-15 00:00:00'),
          ('aa000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '2026-06-20 00:00:00'),
          ('aa000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '2026-05-01 00:00:00'),
          ('aa000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', '2026-06-15 00:00:00'),
          ('aa000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', '2026-06-16 00:00:00'),
          ('aa000000-0000-0000-0000-0000000000b3', '22222222-2222-2222-2222-222222222222', '2026-06-17 00:00:00'),
          ('aa000000-0000-0000-0000-0000000000c1', '33333333-3333-3333-3333-333333333333', '2020-01-01 00:00:00'),
          ('aa000000-0000-0000-0000-0000000000c2', '33333333-3333-3333-3333-333333333333', '2026-06-15 00:00:00');
        """;
}
