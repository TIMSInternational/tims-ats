using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Notification;

namespace Tims.IntegrationTests.Notification;

/// <summary>
/// Phase-5 Slice 25 (#98) Testcontainers fixture: one real Postgres carrying <c>notifications</c> +
/// <c>notification_preferences</c> with their production constraints — the <c>user_id</c> UNIQUE that makes the
/// preferences upsert trip a real ON CONFLICT, the <c>timestamp(3)</c> precision that makes the ISO
/// serialization observable, and the <c>user_id → users(id) ON DELETE CASCADE</c> foreign keys that
/// <c>notification.prisma</c>:17/:37 declare. (The FKs were MISSING from the first version of this fixture,
/// which meant <c>create</c>/<c>bulkCreate</c> were being tested against a laxer schema than production: a
/// well-formed but non-existent target uuid inserted happily here and would have raised 23503 in prod.)
/// Plus the identity/RBAC plane and the SAME RLS mechanism as the other slice fixtures
/// (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE, fail-closed <c>tenant_isolation</c>).
///
/// <para><b>The RLS policies are copied from PRODUCTION, not invented</b> (measured 2026-08-19): on
/// <c>notifications</c> it is <c>organization_id = app.current_org_id</c> — an ORG predicate on a table whose
/// rows are addressed by <c>user_id</c> — and on <c>notification_preferences</c> it is an EXISTS through
/// <c>users</c>. Getting that exactly right is the whole point of this fixture: it is what makes the
/// cross-org divergence observable in a test instead of in production.</para>
///
/// <para>Principals (OrgA): <c>Admin</c> = hr_admin holding <c>notification:create</c> @ organization —
/// the ONLY grant this domain has. <c>Member</c> = the real <c>employee</c> slug with NO notification grant
/// whatsoever, and it must still get 200 from all nine self-service procedures; that is the positive control
/// that catches a self-service route wired to the grant gate by mistake, and it rides a real slug because an
/// invented one is silently dropped by <c>RoleSlugs.FilterStaffRoleSlugs</c>. <c>NoGrant</c> rides the
/// filtered-out <c>norole</c> slug (empty roles → the grant deny). <c>Owner</c> is a PLATFORM OWNER with
/// <c>organization_id NULL</c> — the org-less principal whose <c>TenantContext.OrganizationId</c> is the empty
/// string. OrgB is a distinct org whose admin exists so cross-org reads have a real counterparty.</para>
/// </summary>
public sealed class NotificationFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_notification";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid AdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid MemberId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid NoGrantId = Guid.Parse("c0000000-0000-0000-0000-000000000003");
    public static readonly Guid OwnerId = Guid.Parse("c0000000-0000-0000-0000-000000000004");
    public static readonly Guid OrgBAdminId = Guid.Parse("c0000000-0000-0000-0000-0000000000b0");

    public const string AdminSub = "sub-nt-admin";
    public const string MemberSub = "sub-nt-member";
    public const string NoGrantSub = "sub-nt-none";
    public const string OwnerSub = "sub-nt-owner";
    public const string OrgBAdminSub = "sub-nt-orgb";

    // Member's own OrgA notifications, created_at strictly DESCENDING N1 > N2 > N3 so cursor order is total
    // and the paging tests cannot be accidentally satisfied by a tie.
    public static readonly Guid N1 = Guid.Parse("d0000000-0000-0000-0000-000000000001"); // unread, not archived
    public static readonly Guid N2 = Guid.Parse("d0000000-0000-0000-0000-000000000002"); // unread, not archived
    public static readonly Guid N3 = Guid.Parse("d0000000-0000-0000-0000-000000000003"); // READ, not archived
    public static readonly Guid NArchived = Guid.Parse("d0000000-0000-0000-0000-000000000004"); // read + archived
    public static readonly Guid NArchivedUnread = Guid.Parse("d0000000-0000-0000-0000-000000000005"); // UNREAD + archived

    // Admin's own notification — Member must never see it (same org, different user).
    public static readonly Guid NAdminOwn = Guid.Parse("d0000000-0000-0000-0000-00000000000a");

    // Addressed to Member but stamped with OrgB — the RLS divergence pin.
    public static readonly Guid NCrossOrg = Guid.Parse("d0000000-0000-0000-0000-0000000000c0");

    // Addressed to the org-less platform owner, stamped OrgA — what the two notify() call sites produce.
    public static readonly Guid NOwnerStampedOrgA = Guid.Parse("d0000000-0000-0000-0000-0000000000e0");

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
            role.CommandText =
                """
                CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
                GRANT app_tenant TO postgres;
                """;
            await role.ExecuteNonQueryAsync();
        }

        foreach (var sql in new[] { SchemaSql, RlsSql, IdentitySeedSql, NotificationSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public NotificationDbContext NewContext() =>
        new(new DbContextOptionsBuilder<NotificationDbContext>().UseNpgsql(ConnectionString).Options);

    /// <summary>A notification's mutable state via superuser (bypasses RLS), or null when the row is gone.</summary>
    public async Task<(bool Read, DateTime? ReadAt, bool Archived)?> GetNotificationStateAsync(Guid id)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT read, read_at, archived FROM notifications WHERE id = @i";
        command.Parameters.AddWithValue("i", id);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return (reader.GetBoolean(0), reader.IsDBNull(1) ? null : reader.GetDateTime(1), reader.GetBoolean(2));
    }

    /// <summary>Rows in notifications for a user, via superuser — used to count what a leak WOULD have exposed.</summary>
    public async Task<int> CountNotificationsForUserAsync(Guid userId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*)::int FROM notifications WHERE user_id = @u";
        command.Parameters.AddWithValue("u", userId);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    /// <summary>The preference row via superuser, or null.</summary>
    public async Task<(bool EmailEnabled, bool PushEnabled, string Categories, string Modules, string? QuietStart,
        DateTime UpdatedAt)?> GetPreferencesAsync(Guid userId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT email_enabled, push_enabled, categories::text, modules::text, quiet_hours_start, updated_at "
            + "FROM notification_preferences WHERE user_id = @u";
        command.Parameters.AddWithValue("u", userId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return (reader.GetBoolean(0), reader.GetBoolean(1), reader.GetString(2), reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetDateTime(5));
    }

    public async Task<int> CountPreferenceRowsAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*)::int FROM notification_preferences";
        return (int)(await command.ExecuteScalarAsync())!;
    }

    /// <summary>Deletes rows a mutating test created, so the shared container stays deterministic.</summary>
    public async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    // notification_preferences.updated_at is NOT NULL with NO DEFAULT here, exactly as in production — that is
    // what makes "the C# INSERT must supply updated_at" a real constraint rather than a claim in a comment.
    private const string SchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY, organization_id uuid NULL, supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL, first_name text NOT NULL, last_name text NOT NULL, avatar text NULL,
            job_title text NULL, company_id uuid NULL, business_unit_id uuid NULL, created_at timestamp(3) NOT NULL,
            is_platform_owner boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL, role_id uuid NOT NULL);
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL, permission_id uuid NOT NULL, scope text NOT NULL DEFAULT 'own');

        CREATE TABLE notifications (
            id uuid PRIMARY KEY,
            organization_id uuid NULL,
            user_id uuid NOT NULL,
            type text NOT NULL,
            title text NOT NULL,
            message text NULL,
            module text NULL,
            entity_type text NULL,
            entity_id uuid NULL,
            action_url text NULL,
            read boolean NOT NULL DEFAULT false,
            read_at timestamp(3) NULL,
            archived boolean NOT NULL DEFAULT false,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);

        CREATE TABLE notification_preferences (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL UNIQUE,
            email_enabled boolean NOT NULL DEFAULT true,
            push_enabled boolean NOT NULL DEFAULT true,
            categories jsonb NOT NULL DEFAULT '{"critical":true,"warning":true,"info":true,"success":true}'::jsonb,
            modules jsonb NOT NULL DEFAULT '{}'::jsonb,
            quiet_hours_start text NULL,
            quiet_hours_end text NULL,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL,
            CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
                ON DELETE CASCADE);
        """;

    // The two product policies are the PRODUCTION predicates, verbatim in shape: an ORG predicate on
    // notifications (whose rows are user-addressed) and an EXISTS-through-users on notification_preferences.
    private const string RlsSql =
        """
        GRANT SELECT ON users TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON notifications, notification_preferences TO app_tenant;

        ALTER TABLE users ENABLE ROW LEVEL SECURITY;                  ALTER TABLE users FORCE ROW LEVEL SECURITY;
        ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;          ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
        ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
        ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON users USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON notifications USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        CREATE POLICY tenant_isolation ON notification_preferences USING (EXISTS (
            SELECT 1 FROM users par WHERE par.id = notification_preferences.user_id
              AND par.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid))
            WITH CHECK (EXISTS (
            SELECT 1 FROM users par WHERE par.id = notification_preferences.user_id
              AND par.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', true),
          ('22222222-2222-2222-2222-222222222222', true);

        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'employee', 'Member'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'norole', 'No Grant'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'OrgB HR');

        -- notification:create is the ONLY grant this domain defines. The nine self-service procedures are
        -- protectedProcedure and consult NO grant at all, which is why Member holds none and must still be 200.
        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'notification', 'create');

        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization');

        -- Owner is a PLATFORM OWNER with organization_id NULL: TenantContext.OrganizationId is "" for it.
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, job_title, company_id, business_unit_id, created_at, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-nt-admin',  'admin@t.test',  'Ana',  'Admin',  NULL, 'HR Director', NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-nt-member', 'member@t.test', 'Mia',  'Member', NULL, 'Analyst',     NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-nt-none',   'none@t.test',   'Ned',  'None',   NULL, 'Analyst',     NULL, NULL, '2024-01-01 00:00:00', false, true),
          ('c0000000-0000-0000-0000-000000000004', NULL,                                   'sub-nt-owner',  'owner@t.test',  'Ola',  'Owner',  NULL, 'Platform',    NULL, NULL, '2024-01-01 00:00:00', true,  true),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-nt-orgb',   'orgb@t.test',   'Bob',  'OrgB',   NULL, 'HR',          NULL, NULL, '2024-01-01 00:00:00', false, true);

        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('f0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('f0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');
        """;

    // created_at values are distinct and strictly ordered so DESC is a total order: N1 newest, then N2, N3,
    // NArchivedUnread, NArchived. A tie here would let a broken ORDER BY pass by luck.
    private const string NotificationSeedSql =
        """
        INSERT INTO notifications (id, organization_id, user_id, type, title, message, module, entity_type, entity_id, action_url, read, read_at, archived, created_at) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'info',    'N1 newest', 'body one', 'pipeline', 'vacancy', 'e0000000-0000-0000-0000-000000000001', '/v/1', false, NULL, false, '2026-05-05 10:00:00.123'),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'warning', 'N2',        NULL,       NULL,       NULL,      NULL,                                   NULL,   false, NULL, false, '2026-05-04 10:00:00.000'),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'success', 'N3 read',   NULL,       NULL,       NULL,      NULL,                                   NULL,   true,  '2026-05-04 11:00:00.500', false, '2026-05-03 10:00:00.000'),
          ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'info',    'archived unread', NULL, NULL,       NULL,      NULL,                                   NULL,   false, NULL, true,  '2026-05-02 10:00:00.000'),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'info',    'archived read',   NULL, NULL,       NULL,      NULL,                                   NULL,   true,  '2026-05-02 11:00:00.000', true,  '2026-05-01 10:00:00.000'),
          ('d0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'critical', 'admin only', 'secret', NULL,      NULL,      NULL,                                   NULL,   false, NULL, false, '2026-05-06 10:00:00.000'),
          ('d0000000-0000-0000-0000-0000000000c0', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000002', 'info',    'cross-org to member', NULL, NULL,  NULL,      NULL,                                   NULL,   false, NULL, false, '2026-05-07 10:00:00.000'),
          ('d0000000-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000004', 'success', 'to the org-less owner', NULL, 'platform', NULL, NULL,                                 NULL,   false, NULL, false, '2026-05-08 10:00:00.000');

        -- Admin HAS a preference row; Member deliberately has NONE, so getPreferences' lazy create is exercised.
        INSERT INTO notification_preferences (id, user_id, email_enabled, push_enabled, categories, modules, quiet_hours_start, quiet_hours_end, created_at, updated_at) VALUES
          ('aa000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', false, true, '{"critical":true,"info":false}'::jsonb, '{"pipeline":true}'::jsonb, '22:00', '07:00', '2026-05-01 00:00:00', '2026-05-01 00:00:00');
        """;
}
