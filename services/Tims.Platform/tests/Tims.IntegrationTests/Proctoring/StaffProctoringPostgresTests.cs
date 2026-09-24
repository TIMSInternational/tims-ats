using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

/// <summary>Real PostgreSQL proof of staff pagination, tenant scope, and timestamp bindings.</summary>
public sealed class StaffProctoringPostgresTests : IAsyncLifetime
{
    private static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Actor = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid CompletedAssignment = Guid.Parse("cccccccc-cccc-cccc-cccc-ccccccccccca");
    private static readonly Guid StaleAssignment = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccb");
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres")
        .WithDatabase("tims_proctoring_staff").Build();
    private string _connectionString = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
        await ExecuteAsync("CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;");
        await ExecuteAsync(SchemaSql);
        await ExecuteAsync(SeedSql);
        await ExecuteAsync("""
            ALTER TABLE assessment_types ADD COLUMN duration integer;
            ALTER TABLE proctoring_sessions ADD COLUMN media_consented_at timestamp(3);
            ALTER TABLE proctoring_sessions ADD COLUMN media_consent_version text;
            ALTER TABLE proctoring_sessions ADD COLUMN media_stopped_at timestamp(3);
            """);
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    [Fact]
    public async Task QueueAndEvidenceCursors_HandleNullableTimestampsAndKeepTenantScope()
    {
        await using var db = NewContext();
        var auditor = new RecordingAuditor();
        var store = new StaffProctoringStore(db, new UnusedAnchors(), auditor,
            new CandidateProctoringRepository(db));
        var scope = new StaffProctoringScope(OrgA, Actor, AccessScope.Company, [], []);

        var first = await store.ListQueueAsync(scope, Actor, 1, null, null, null, default);
        Assert.Single(first.Items);
        Assert.Equal(CompletedAssignment, first.Items[0].AssignmentId);
        Assert.Equal("completed", first.Items[0].Status);
        Assert.NotNull(first.NextCursor);

        var second = await store.ListQueueAsync(scope, Actor, 1, first.NextCursor,
            null, null, default);
        Assert.Single(second.Items);
        Assert.Equal(StaleAssignment, second.Items[0].AssignmentId);
        Assert.Equal("needs_attention", second.Items[0].Status);
        Assert.Null(second.Items[0].EndedAt);
        Assert.Null(second.NextCursor);
        var empty = await store.ListQueueAsync(scope, Actor, 1, second.Items[0].SessionId,
            null, null, default);
        Assert.Empty(empty.Items);
        Assert.Equal(2, auditor.Reads);

        var evidence = await store.GetEvidenceAsync(scope, CompletedAssignment, Actor,
            1, null, null, null, default);
        Assert.Single(evidence.Events);
        Assert.NotNull(evidence.NextCursor);
        Assert.EndsWith("Z", System.Text.Json.JsonSerializer.Serialize(evidence.StartedAt).Trim('"'));
        var older = await store.GetEvidenceAsync(scope, CompletedAssignment, Actor,
            1, evidence.NextCursor, null, null, default);
        Assert.Single(older.Events);
        Assert.NotEqual(evidence.Events[0].Id, older.Events[0].Id);
        Assert.Null(older.NextCursor);
        Assert.Equal(4, auditor.Reads);

        // The org-B assignment/session is never returned by an org-A queue or by-id read.
        var hidden = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            store.GetEvidenceAsync(scope,
                Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"), Actor,
                1, null, null, null, default));
        Assert.Equal(404, hidden.StatusCode);

        var policy = await store.SetPolicyAsync(OrgA,
            Guid.Parse("99999999-9999-9999-9999-99999999999a"), true,
            Actor, null, null, default);
        Assert.True(policy.ProctoringEnabled);
        var review = await store.ReviewAsync(scope, CompletedAssignment, Actor,
            "concern", "Human review note", null, null, default);
        Assert.Equal("concern", review.Status);
        Assert.Equal(DateTimeKind.Utc, review.ReviewedAt.Kind);
        Assert.Equal(2L, await ScalarAsync<long>(
            "SELECT count(*) FROM audit_logs WHERE organization_id = @id", OrgA));

        var failingStore = new StaffProctoringStore(db, new UnusedAnchors(),
            new ThrowingAuditor(), new CandidateProctoringRepository(db));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            failingStore.GetEvidenceAsync(scope, CompletedAssignment, Actor,
                1, null, null, null, default));

        // More than one bounded reconciliation batch must not hide or duplicate a
        // completed assessment whose proctoring session was left active by a lost call.
        await ExecuteAsync(OrphanSeedSql);
        var seen = new HashSet<Guid>();
        Guid? cursor = null;
        var pageNumber = 0;
        do
        {
            var batch = await store.ListQueueAsync(scope, Actor, 17, cursor,
                null, null, default);
            foreach (var item in batch.Items)
            {
                Assert.True(seen.Add(item.SessionId), "Cursor returned a duplicate session.");
            }

            if (pageNumber == 0)
            {
                Assert.Equal(2L, await ScalarAsync<long>("""
                    SELECT count(*) FROM proctoring_sessions s
                    JOIN assessment_assignments a ON a.id = s.assignment_id
                    WHERE s.organization_id = @id AND a.status = 'completed'
                      AND s.ended_at IS NULL
                    """, OrgA));
            }

            cursor = batch.NextCursor;
            pageNumber++;
            Assert.True(pageNumber < 20, "Cursor did not terminate.");
        } while (cursor is not null);

        Assert.Equal(104, seen.Count); // 102 orphans + completed + stale-active.
    }

    private ProctoringDbContext NewContext() => new(new DbContextOptionsBuilder<ProctoringDbContext>()
        .UseNpgsql(_connectionString).Options);

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<T> ScalarAsync<T>(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("id", id);
        return (T)(await command.ExecuteScalarAsync()
            ?? throw new InvalidOperationException("Missing scalar"));
    }

    private sealed class UnusedAnchors : IAnchorLoaderFactory
    {
        public IAnchorLoader Create(Guid organizationId, Guid userId) =>
            throw new InvalidOperationException("Company scope must not load narrow anchors.");
    }

    private sealed class RecordingAuditor : IDataAccessAuditor
    {
        public int Reads { get; private set; }
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null,
            CancellationToken cancellationToken = default)
        {
            Assert.Equal("proctoringSession", auditEvent.Entity);
            Assert.True(failClosed);
            Reads++;
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingAuditor : IDataAccessAuditor
    {
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null,
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Simulated audit sink failure");
    }

    private const string SchemaSql = """
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            team_id uuid, business_unit_id uuid, assigned_to uuid, created_by uuid NOT NULL,
            deleted_at timestamp(3));
        CREATE TABLE candidates (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            email text NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
            is_active boolean NOT NULL, deleted_at timestamp(3));
        CREATE TABLE assessment_types (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            name text NOT NULL, config jsonb, updated_at timestamp(3) NOT NULL);
        CREATE TABLE assessment_assignments (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            candidate_id uuid NOT NULL, vacancy_id uuid NOT NULL, assessment_type_id uuid NOT NULL,
            proctoring_required boolean NOT NULL, status text NOT NULL,
            started_at timestamp(3), completed_at timestamp(3), expires_at timestamp(3));
        CREATE TABLE proctoring_sessions (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            assignment_id uuid NOT NULL UNIQUE, started_at timestamp(3) NOT NULL,
            ended_at timestamp(3), consented_at timestamp(3), consent_version text,
            last_heartbeat_at timestamp(3), flag_count integer NOT NULL, severity text,
            review_status text NOT NULL, review_notes text, reviewed_at timestamp(3),
            reviewed_by_id uuid, updated_at timestamp(3) NOT NULL);
        CREATE TABLE proctoring_events (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            session_id uuid NOT NULL, client_event_id uuid NOT NULL, type text NOT NULL,
            source text NOT NULL, severity text NOT NULL, client_at timestamp(3),
            occurred_at timestamp(3) NOT NULL, UNIQUE(session_id, client_event_id));
        CREATE TABLE proctoring_candidate_explanations (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            assignment_id uuid NOT NULL, session_id uuid NOT NULL UNIQUE,
            candidate_id uuid NOT NULL, submission_id uuid NOT NULL,
            text varchar(2000) NOT NULL, submitted_at timestamp(3) NOT NULL,
            expires_at timestamp(3) NOT NULL);
        CREATE TABLE org_entitlements (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            module_code text NOT NULL, enabled boolean NOT NULL);
        CREATE TABLE audit_logs (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            actor_id uuid, action text NOT NULL, entity text NOT NULL, entity_id text,
            metadata jsonb, ip_address text, user_agent text, created_at timestamp(3) NOT NULL);
        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_tenant;
        DO $$ DECLARE t text; BEGIN
          FOREACH t IN ARRAY ARRAY['vacancies','candidates','assessment_types',
              'assessment_assignments','proctoring_sessions','proctoring_events',
              'proctoring_candidate_explanations',
              'org_entitlements','audit_logs'] LOOP
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
            EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = '
                || 'NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid) WITH CHECK '
                || '(organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)', t);
          END LOOP;
        END $$;
        """;

    private const string SeedSql = """
        INSERT INTO vacancies VALUES
          ('dddddddd-dddd-dddd-dddd-ddddddddddda','11111111-1111-1111-1111-111111111111',
            NULL,NULL,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',NULL),
          ('dddddddd-dddd-dddd-dddd-dddddddddddb','22222222-2222-2222-2222-222222222222',
            NULL,NULL,NULL,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',NULL);
        INSERT INTO candidates VALUES
          ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
            'test-a@example.invalid','Test','A',true,NULL),
          ('ffffffff-ffff-ffff-ffff-ffffffffffff','22222222-2222-2222-2222-222222222222',
            'test-b@example.invalid','Test','B',true,NULL);
        INSERT INTO assessment_types VALUES
          ('99999999-9999-9999-9999-99999999999a','11111111-1111-1111-1111-111111111111',
            'Test','{}',CURRENT_TIMESTAMP),
          ('99999999-9999-9999-9999-99999999999b','22222222-2222-2222-2222-222222222222',
            'Test','{}',CURRENT_TIMESTAMP);
        INSERT INTO assessment_assignments VALUES
          ('cccccccc-cccc-cccc-cccc-ccccccccccca','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-ddddddddddda',
            '99999999-9999-9999-9999-99999999999a',true,'completed',
            CURRENT_TIMESTAMP-INTERVAL '1 hour',CURRENT_TIMESTAMP-INTERVAL '30 minutes',NULL),
          ('cccccccc-cccc-cccc-cccc-cccccccccccb','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-ddddddddddda',
            '99999999-9999-9999-9999-99999999999a',true,'in_progress',
            CURRENT_TIMESTAMP-INTERVAL '10 minutes',NULL,NULL),
          ('cccccccc-cccc-cccc-cccc-cccccccccccc','22222222-2222-2222-2222-222222222222',
            'ffffffff-ffff-ffff-ffff-ffffffffffff','dddddddd-dddd-dddd-dddd-dddddddddddb',
            '99999999-9999-9999-9999-99999999999b',true,'completed',
            CURRENT_TIMESTAMP-INTERVAL '1 hour',CURRENT_TIMESTAMP-INTERVAL '30 minutes',NULL);
        INSERT INTO proctoring_sessions VALUES
          ('88888888-8888-8888-8888-88888888888a','11111111-1111-1111-1111-111111111111',
            'cccccccc-cccc-cccc-cccc-ccccccccccca',CURRENT_TIMESTAMP-INTERVAL '1 hour',
            CURRENT_TIMESTAMP-INTERVAL '30 minutes',CURRENT_TIMESTAMP-INTERVAL '1 hour',
            'v1',CURRENT_TIMESTAMP-INTERVAL '30 minutes',2,'medium','unreviewed',
            NULL,NULL,NULL,CURRENT_TIMESTAMP),
          ('88888888-8888-8888-8888-88888888888b','11111111-1111-1111-1111-111111111111',
            'cccccccc-cccc-cccc-cccc-cccccccccccb',CURRENT_TIMESTAMP-INTERVAL '10 minutes',
            NULL,CURRENT_TIMESTAMP-INTERVAL '10 minutes','v1',
            CURRENT_TIMESTAMP-INTERVAL '4 minutes',0,NULL,'unreviewed',
            NULL,NULL,NULL,CURRENT_TIMESTAMP),
          ('88888888-8888-8888-8888-88888888888c','22222222-2222-2222-2222-222222222222',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',CURRENT_TIMESTAMP-INTERVAL '1 hour',
            CURRENT_TIMESTAMP-INTERVAL '30 minutes',CURRENT_TIMESTAMP-INTERVAL '1 hour',
            'v1',CURRENT_TIMESTAMP-INTERVAL '30 minutes',0,NULL,'unreviewed',
            NULL,NULL,NULL,CURRENT_TIMESTAMP);
        INSERT INTO proctoring_events VALUES
          ('77777777-7777-7777-7777-77777777777a','11111111-1111-1111-1111-111111111111',
            '88888888-8888-8888-8888-88888888888a',
            '66666666-6666-6666-6666-66666666666a','tab_hidden','client_observation',
            'low',NULL,CURRENT_TIMESTAMP-INTERVAL '40 minutes'),
          ('77777777-7777-7777-7777-77777777777b','11111111-1111-1111-1111-111111111111',
            '88888888-8888-8888-8888-88888888888a',
            '66666666-6666-6666-6666-66666666666b','focus_lost','client_observation',
            'low',NULL,CURRENT_TIMESTAMP-INTERVAL '50 minutes');
        INSERT INTO org_entitlements VALUES
          ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',
            'proctoring',true);
        """;

    private const string OrphanSeedSql = """
        INSERT INTO assessment_assignments
          (id, organization_id, candidate_id, vacancy_id, assessment_type_id,
           proctoring_required, status, started_at, completed_at, expires_at)
        SELECT md5('orphan-assignment-' || g)::uuid,
          '11111111-1111-1111-1111-111111111111'::uuid,
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
          'dddddddd-dddd-dddd-dddd-ddddddddddda'::uuid,
          '99999999-9999-9999-9999-99999999999a'::uuid,
          true, 'completed',
          CURRENT_TIMESTAMP - INTERVAL '35 minutes' + g * INTERVAL '1 second',
          CURRENT_TIMESTAMP - INTERVAL '30 minutes' + g * INTERVAL '1 second', NULL
        FROM generate_series(1, 101) AS g;
        INSERT INTO proctoring_sessions
          (id, organization_id, assignment_id, started_at, ended_at,
           consented_at, consent_version, last_heartbeat_at, flag_count,
           severity, review_status, review_notes, reviewed_at, reviewed_by_id, updated_at)
        SELECT md5('orphan-session-' || g)::uuid,
          '11111111-1111-1111-1111-111111111111'::uuid,
          md5('orphan-assignment-' || g)::uuid,
          CURRENT_TIMESTAMP - INTERVAL '35 minutes' + g * INTERVAL '1 second',
          NULL, CURRENT_TIMESTAMP - INTERVAL '35 minutes' + g * INTERVAL '1 second',
          'v1', CURRENT_TIMESTAMP - INTERVAL '35 minutes' + g * INTERVAL '1 second',
          0, NULL, 'unreviewed', NULL, NULL, NULL, CURRENT_TIMESTAMP
        FROM generate_series(1, 101) AS g;
        -- Inconsistent completed_at NULL must use session start as a stable
        -- fallback, rather than the time at which a later queue GET repairs it.
        INSERT INTO assessment_assignments
          (id, organization_id, candidate_id, vacancy_id, assessment_type_id,
           proctoring_required, status, started_at, completed_at, expires_at)
        VALUES ('33333333-3333-3333-3333-333333333333',
          '11111111-1111-1111-1111-111111111111',
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          'dddddddd-dddd-dddd-dddd-ddddddddddda',
          '99999999-9999-9999-9999-99999999999a',true,'completed',
          CURRENT_TIMESTAMP-INTERVAL '10 minutes',NULL,NULL);
        INSERT INTO proctoring_sessions
          (id, organization_id, assignment_id, started_at, ended_at,
           consented_at, consent_version, last_heartbeat_at, flag_count,
           severity, review_status, review_notes, reviewed_at, reviewed_by_id, updated_at)
        VALUES ('44444444-4444-4444-4444-444444444444',
          '11111111-1111-1111-1111-111111111111',
          '33333333-3333-3333-3333-333333333333',
          CURRENT_TIMESTAMP-INTERVAL '10 minutes',NULL,
          CURRENT_TIMESTAMP-INTERVAL '10 minutes','v1',
          CURRENT_TIMESTAMP-INTERVAL '10 minutes',0,NULL,'unreviewed',
          NULL,NULL,NULL,CURRENT_TIMESTAMP);
        """;
}
