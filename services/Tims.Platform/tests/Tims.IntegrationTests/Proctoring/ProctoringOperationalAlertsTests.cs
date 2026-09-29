using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

/// <summary>Real PostgreSQL proof for authorization, RLS, inbox timing and idempotent retries.</summary>
public sealed class ProctoringOperationalAlertsTests : IAsyncLifetime
{
    private static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid UnitA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid UnitB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid Assignment = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid Session = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly Guid SuperAdmin = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid HrAdmin = Guid.Parse("00000000-0000-0000-0000-000000000002");
    private static readonly Guid HrbpA = Guid.Parse("00000000-0000-0000-0000-000000000003");
    private static readonly Guid HrbpB = Guid.Parse("00000000-0000-0000-0000-000000000004");
    private static readonly Guid Recruiter = Guid.Parse("00000000-0000-0000-0000-000000000005");
    private static readonly Guid ForeignSuper = Guid.Parse("00000000-0000-0000-0000-000000000006");

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres")
        .WithDatabase("tims_proctoring_alerts").Build();
    private string _connectionString = string.Empty;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();
        _connectionString = _postgres.GetConnectionString();
        await ExecuteAsync(SchemaSql);
        await ExecuteAsync(File.ReadAllText(FindMigrationPath()));
        await ExecuteAsync(SeedSql);
    }

    public Task DisposeAsync() => _postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Client_track_loss_reaches_only_currently_authorized_reviewers_once()
    {
        var signalId = Guid.NewGuid();
        await InsertSignalAsync(signalId, "camera_stopped", "client_observation");
        await using var db = NewContext();
        var alerts = new ProctoringOperationalAlertsRepository(db);
        var start = DateTime.UtcNow;
        var result = await alerts.RunOrganizationAsync(OrgA, default);
        Assert.Equal(0, result.HeartbeatGaps);
        Assert.Equal(3, result.InboxNotifications);
        Assert.Equal(0, (await alerts.RunOrganizationAsync(OrgA, default)).InboxNotifications);

        var recipients = await UserIdsForSignalAsync(signalId);
        Assert.Equal([SuperAdmin, HrAdmin, HrbpA], recipients.OrderBy(id => id).ToArray());
        Assert.DoesNotContain(HrbpB, recipients);
        Assert.DoesNotContain(Recruiter, recipients);
        Assert.DoesNotContain(ForeignSuper, recipients);
        var messages = await NotificationMessagesAsync();
        Assert.All(messages, message =>
        {
            Assert.Contains("browser reported", message, StringComparison.Ordinal);
            Assert.DoesNotContain("Candidate", message, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("candidate@example.com", message, StringComparison.OrdinalIgnoreCase);
        });
        var latest = await LatestNotificationAsync();
        Assert.InRange(latest, start.AddSeconds(-1), DateTime.UtcNow.AddSeconds(1));

        // Deleting an inbox item must not turn the same event back into a new
        // delivery. The receipt survives the hard-delete notification API.
        await ExecuteAsync("DELETE FROM notifications WHERE user_id = @id", HrAdmin);
        Assert.Equal(0, (await alerts.RunOrganizationAsync(OrgA, default)).InboxNotifications);
        Assert.Equal(2L, await ScalarAsync<long>("SELECT count(*) FROM notifications"));
        Assert.Equal(3L, await ScalarAsync<long>("SELECT count(*) FROM proctoring_alert_deliveries"));

        // A new signal after role revocation must not be sent to the former HRBP.
        await ExecuteAsync("UPDATE user_roles SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE user_id = @id", HrbpA);
        var secondId = Guid.NewGuid();
        await InsertSignalAsync(secondId, "screen_share_stopped", "client_observation");
        Assert.Equal(2, (await alerts.RunOrganizationAsync(OrgA, default)).InboxNotifications);
        Assert.Equal([SuperAdmin, HrAdmin],
            (await UserIdsForSignalAsync(secondId)).OrderBy(id => id).ToArray());
    }

    [Fact]
    public async Task Missing_heartbeat_is_server_inferred_and_inbox_latency_meets_target()
    {
        var utc = DateTime.UtcNow.AddSeconds(-91);
        var priorHeartbeat = DateTime.SpecifyKind(
            utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
        await ExecuteAsync("UPDATE proctoring_sessions SET last_heartbeat_at = @at WHERE id = @id",
            ("at", priorHeartbeat), ("id", Session));
        await using var db = NewContext();
        var alerts = new ProctoringOperationalAlertsRepository(db);
        var result = await alerts.RunOrganizationAsync(OrgA, default);
        Assert.Equal(1, result.HeartbeatGaps);
        Assert.Equal(3, result.InboxNotifications);
        Assert.Equal(0, (await alerts.RunOrganizationAsync(OrgA, default)).HeartbeatGaps);
        Assert.Equal(0, (await alerts.RunOrganizationAsync(OrgA, default)).InboxNotifications);

        var inferred = await ScalarAsync<long>("SELECT count(*) FROM proctoring_events WHERE type = 'heartbeat_gap' AND source = 'server_inferred'");
        Assert.Equal(1, inferred);
        var key = await ScalarAsync<Guid>("SELECT client_event_id FROM proctoring_events WHERE type = 'heartbeat_gap'");
        Assert.Equal(ProctoringOperationalAlertsRepository.HeartbeatGapId(Session, priorHeartbeat), key);

        var inboxAt = await EarliestNotificationAsync();
        var elapsed = inboxAt - priorHeartbeat;
        Assert.InRange(elapsed, TimeSpan.FromSeconds(90),
            ProctoringOperationalAlertsService.HeartbeatToInboxTarget);
        Assert.Equal(TimeSpan.FromSeconds(30), ProctoringOperationalAlertsService.PollInterval);
    }

    [Fact]
    public async Task Tenant_role_cannot_read_another_organizations_operational_inbox()
    {
        await InsertSignalAsync(Guid.NewGuid(), "camera_stopped", "client_observation");
        await using (var db = NewContext())
            await new ProctoringOperationalAlertsRepository(db).RunOrganizationAsync(OrgA, default);

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var role = new NpgsqlCommand("SET LOCAL ROLE app_tenant", connection, transaction))
            await role.ExecuteNonQueryAsync();
        await using (var org = new NpgsqlCommand("SELECT set_config('app.current_org_id', @id, true)", connection, transaction))
        {
            org.Parameters.AddWithValue("id", OrgB.ToString());
            await org.ExecuteScalarAsync();
        }
        await using var query = new NpgsqlCommand("SELECT count(*) FROM notifications WHERE organization_id = @id", connection, transaction);
        query.Parameters.AddWithValue("id", OrgA);
        Assert.Equal(0L, (long)(await query.ExecuteScalarAsync() ?? -1L));
    }

    [Fact]
    public async Task Expired_receipts_are_removed_only_after_event_replay_window()
    {
        var signalId = Guid.NewGuid();
        await InsertSignalAsync(signalId, "camera_stopped", "client_observation");
        await using var db = NewContext();
        var alerts = new ProctoringOperationalAlertsRepository(db);
        Assert.Equal(3, (await alerts.RunOrganizationAsync(OrgA, default)).InboxNotifications);
        await ExecuteAsync("UPDATE proctoring_events SET occurred_at = CURRENT_TIMESTAMP - INTERVAL '9 days' WHERE id = @id", signalId);
        await ExecuteAsync("UPDATE proctoring_alert_deliveries SET delivered_at = CURRENT_TIMESTAMP - INTERVAL '9 days'");
        Assert.Contains(OrgA, await alerts.ListActiveOrganizationIdsAsync(default));
        Assert.Equal(0, (await alerts.RunOrganizationAsync(OrgA, default)).InboxNotifications);
        Assert.Equal(0L, await ScalarAsync<long>("SELECT count(*) FROM proctoring_alert_deliveries"));
        Assert.Equal(0, (await alerts.RunOrganizationAsync(OrgA, default)).InboxNotifications);
    }

    [Fact]
    public async Task Oldest_stale_sessions_do_not_starve_later_batches_and_new_gap_can_follow_a_heartbeat()
    {
        await ExecuteAsync("""
            WITH assignments AS (
              INSERT INTO assessment_assignments
                (id, organization_id, vacancy_id, candidate_id, status)
              SELECT gen_random_uuid(),
                '11111111-1111-1111-1111-111111111111'::uuid,
                '30000000-0000-0000-0000-000000000001'::uuid,
                '40000000-0000-0000-0000-000000000001'::uuid,
                'in_progress'
              FROM generate_series(1, 30)
              RETURNING id
            )
            INSERT INTO proctoring_sessions
              (id, organization_id, assignment_id, started_at,
               consented_at, last_heartbeat_at)
            SELECT gen_random_uuid(),
              '11111111-1111-1111-1111-111111111111'::uuid,
              id, CURRENT_TIMESTAMP - INTERVAL '4 minutes',
              CURRENT_TIMESTAMP - INTERVAL '4 minutes',
              CURRENT_TIMESTAMP - INTERVAL '91 seconds'
            FROM assignments
            """);
        await using var db = NewContext();
        var alerts = new ProctoringOperationalAlertsRepository(db);
        Assert.Equal(25, (await alerts.RunOrganizationAsync(OrgA, default)).HeartbeatGaps);
        Assert.Equal(5, (await alerts.RunOrganizationAsync(OrgA, default)).HeartbeatGaps);
        Assert.Equal(0, (await alerts.RunOrganizationAsync(OrgA, default)).HeartbeatGaps);
        Assert.Equal(30L, await ScalarAsync<long>("SELECT count(*) FROM proctoring_events WHERE type = 'heartbeat_gap'"));

        // Model a recovered session that later loses connectivity again. Its
        // previous inferred event predates the new last_heartbeat_at value.
        var oneSession = await ScalarAsync<Guid>("SELECT session_id FROM proctoring_events WHERE type = 'heartbeat_gap' ORDER BY session_id LIMIT 1");
        await ExecuteAsync("UPDATE proctoring_events SET occurred_at = CURRENT_TIMESTAMP - INTERVAL '5 minutes' WHERE session_id = @id", oneSession);
        await ExecuteAsync("UPDATE proctoring_sessions SET last_heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '90.5 seconds' WHERE id = @id", oneSession);
        Assert.Equal(1, (await alerts.RunOrganizationAsync(OrgA, default)).HeartbeatGaps);
        Assert.Equal(31L, await ScalarAsync<long>("SELECT count(*) FROM proctoring_events WHERE type = 'heartbeat_gap'"));
    }

    private ProctoringDbContext NewContext() => new(new DbContextOptionsBuilder<ProctoringDbContext>()
        .UseNpgsql(_connectionString).Options);

    private async Task InsertSignalAsync(Guid id, string type, string source)
    {
        await ExecuteAsync("""
            INSERT INTO proctoring_events
              (id, organization_id, session_id, client_event_id, type, source, severity, occurred_at)
            VALUES (@id, @org, @session, @id, @type, @source, 'medium', CURRENT_TIMESTAMP)
            """, ("id", id), ("org", OrgA), ("session", Session),
            ("type", type), ("source", source));
    }

    private async Task<Guid[]> UserIdsForSignalAsync(Guid eventId)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            SELECT user_id FROM notifications
             WHERE id = md5('proctoring-alert:v1:' || @event_id::text || ':' || user_id::text)::uuid
             ORDER BY user_id
            """, connection);
        command.Parameters.AddWithValue("event_id", eventId);
        var ids = new List<Guid>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) ids.Add(reader.GetGuid(0));
        return [.. ids];
    }

    private async Task<string[]> NotificationMessagesAsync()
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT message FROM notifications ORDER BY id", connection);
        var messages = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) messages.Add(reader.GetString(0));
        return [.. messages];
    }

    private Task<DateTime> LatestNotificationAsync() =>
        ScalarAsync<DateTime>("SELECT max(created_at) FROM notifications");
    private Task<DateTime> EarliestNotificationAsync() =>
        ScalarAsync<DateTime>("SELECT min(created_at) FROM notifications");

    private async Task<T> ScalarAsync<T>(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (T)(await command.ExecuteScalarAsync() ?? throw new InvalidOperationException("No value"));
    }

    private Task ExecuteAsync(string sql, Guid id) => ExecuteAsync(sql, ("id", (object)id));

    private static string FindMigrationPath()
    {
        const string relative = "packages/db/prisma/migrations/20260924110000_proctoring_alert_delivery/migration.sql";
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory);
             directory is not null; directory = directory.Parent)
        {
            var path = Path.Combine(directory.FullName, relative);
            if (File.Exists(path)) return path;
        }
        throw new FileNotFoundException("Proctoring alert delivery migration was not found", relative);
    }

    private async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
            command.Parameters.AddWithValue(name, value);
        await command.ExecuteNonQueryAsync();
    }

    private const string SchemaSql = """
        CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
        GRANT app_tenant TO postgres;
        GRANT USAGE ON SCHEMA public TO app_tenant;
        CREATE TABLE business_units (id uuid PRIMARY KEY, organization_id uuid NOT NULL, is_active boolean NOT NULL);
        CREATE TABLE users (id uuid PRIMARY KEY, organization_id uuid NOT NULL, is_active boolean NOT NULL,
            deleted_at timestamp, locale text NOT NULL DEFAULT 'en');
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL,
            is_active boolean NOT NULL);
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (role_id uuid NOT NULL REFERENCES roles(id), permission_id uuid NOT NULL REFERENCES permissions(id),
            scope text NOT NULL);
        CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES users(id), role_id uuid NOT NULL REFERENCES roles(id),
            expires_at timestamp, company_scope uuid, unit_scope uuid);
        CREATE TABLE user_business_units (organization_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
            business_unit_id uuid NOT NULL REFERENCES business_units(id));
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, company_id uuid,
            business_unit_id uuid, deleted_at timestamp);
        CREATE TABLE assessment_assignments (id uuid PRIMARY KEY, organization_id uuid NOT NULL, vacancy_id uuid NOT NULL,
            candidate_id uuid NOT NULL, status text NOT NULL);
        CREATE TABLE proctoring_sessions (id uuid PRIMARY KEY, organization_id uuid NOT NULL, assignment_id uuid NOT NULL,
            started_at timestamp NOT NULL, ended_at timestamp, consented_at timestamp, last_heartbeat_at timestamp,
            flag_count int NOT NULL DEFAULT 0, severity text, updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE proctoring_events (id uuid PRIMARY KEY, organization_id uuid NOT NULL, session_id uuid NOT NULL,
            client_event_id uuid NOT NULL, type text NOT NULL, source text NOT NULL, severity text NOT NULL,
            client_at timestamp, occurred_at timestamp NOT NULL,
            UNIQUE (session_id, client_event_id));
        CREATE TABLE notifications (id uuid PRIMARY KEY, organization_id uuid, user_id uuid NOT NULL REFERENCES users(id),
            type text NOT NULL, title text NOT NULL, message text, module text, entity_type text,
            entity_id uuid, action_url text, read boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP);
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        ALTER TABLE users FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON users USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;
        ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON business_units USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
        ALTER TABLE roles FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON roles USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
        ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON user_roles USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
            AND r.organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid));
        ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON role_permissions USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
            AND r.organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid));
        ALTER TABLE user_business_units ENABLE ROW LEVEL SECURITY;
        ALTER TABLE user_business_units FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON user_business_units USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;
        ALTER TABLE vacancies FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON vacancies USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE assessment_assignments ENABLE ROW LEVEL SECURITY;
        ALTER TABLE assessment_assignments FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON assessment_assignments USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE proctoring_sessions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE proctoring_sessions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON proctoring_sessions USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE proctoring_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE proctoring_events FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON proctoring_events USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
        ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant ON notifications USING (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string SeedSql = """
        INSERT INTO business_units VALUES
          ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', true),
          ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', true);
        INSERT INTO users (id, organization_id, is_active) VALUES
          ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true),
          ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', true),
          ('00000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', true),
          ('00000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', true),
          ('00000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', true),
          ('00000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', true);
        INSERT INTO roles VALUES
          ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'super_admin', true),
          ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'hr_admin', true),
          ('10000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'hrbp', true),
          ('10000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'recruiter', true),
          ('10000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'super_admin', true);
        INSERT INTO permissions VALUES ('20000000-0000-0000-0000-000000000001', 'assessment', 'read');
        INSERT INTO role_permissions VALUES
          ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'organization'),
          ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'organization'),
          ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'unit'),
          ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'organization'),
          ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'organization');
        INSERT INTO user_roles (user_id, role_id) VALUES
          ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
          ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'),
          ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003'),
          ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003'),
          ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004'),
          ('00000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000005');
        INSERT INTO user_business_units VALUES
          ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
          ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000004', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
        INSERT INTO vacancies VALUES ('30000000-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL);
        INSERT INTO assessment_assignments VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          '11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000001',
          '40000000-0000-0000-0000-000000000001', 'in_progress');
        INSERT INTO proctoring_sessions (id, organization_id, assignment_id, started_at, consented_at, last_heartbeat_at)
        VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111',
          'cccccccc-cccc-cccc-cccc-cccccccccccc', CURRENT_TIMESTAMP - INTERVAL '2 minutes',
          CURRENT_TIMESTAMP - INTERVAL '2 minutes', CURRENT_TIMESTAMP);
        """;
}
