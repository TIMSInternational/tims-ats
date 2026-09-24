using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Application.Proctoring;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

/// <summary>Real Postgres/RLS proof for the .NET 10 candidate proctoring write path.</summary>
public sealed class CandidateProctoringRepositoryTests : IAsyncLifetime
{
    private static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid CandidateA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid CandidateB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid AssignmentA = Guid.Parse("cccccccc-cccc-cccc-cccc-ccccccccccca");
    private static readonly Guid AssignmentOff = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccb");
    private static readonly Guid AssignmentNoEntitlement = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid AssignmentLostComplete = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccd");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres")
        .WithDatabase("tims_proctoring_candidate").Build();
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
    public async Task Candidate_flow_is_tenant_bound_idempotent_and_recovers_lost_completion()
    {
        await using var db = NewContext();
        var repository = new CandidateProctoringRepository(db);
        var useCase = new CandidateProctoringUseCase(repository);

        Assert.Equal(OrgA, await useCase.ResolveOrganizationBySlugAsync("org-a", default));
        Assert.Null(await useCase.ResolveOrganizationBySlugAsync("missing", default));

        var wrongCandidate = await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.StartAsync(OrgA, CandidateB, AssignmentA, true, true, true, true,
                null, null, default));
        Assert.Equal("assignment_not_found", wrongCandidate.Code);
        var wrongTenant = await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.StartAsync(OrgB, CandidateB, AssignmentA, true, true, true, true,
                null, null, default));
        Assert.Equal("assignment_not_found", wrongTenant.Code);

        var policyOff = await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.StartAsync(OrgA, CandidateA, AssignmentOff, true, true, true, true,
                null, null, default));
        Assert.Equal("proctoring_not_required", policyOff.Code);

        var first = await useCase.StartAsync(OrgA, CandidateA, AssignmentA,
            true, true, true, true, "127.0.0.1", "test-runner", default);
        var resumed = await useCase.StartAsync(OrgA, CandidateA, AssignmentA,
            true, true, true, true, "127.0.0.2", "retry", default);
        Assert.Equal(first.SessionId, resumed.SessionId);
        Assert.Equal(first.StartedAt, resumed.StartedAt);
        Assert.Equal("in_progress", await ScalarAsync<string>(
            "SELECT status FROM assessment_assignments WHERE id = @id", AssignmentA));
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM assessment_consents WHERE assignment_id = @id", AssignmentA));
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_sessions WHERE assignment_id = @id", AssignmentA));

        var signalId = Guid.NewGuid();
        var signal = await useCase.ReportEventAsync(OrgA, CandidateA, AssignmentA,
            signalId, "camera_stopped", DateTimeOffset.UtcNow, default);
        var retry = await useCase.ReportEventAsync(OrgA, CandidateA, AssignmentA,
            signalId, "camera_stopped", DateTimeOffset.UtcNow, default);
        Assert.True(signal.Accepted);
        Assert.False(retry.Accepted);
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_events WHERE client_event_id = @id", signalId));
        Assert.Equal("medium", await ScalarAsync<string>(
            "SELECT severity FROM proctoring_events WHERE client_event_id = @id", signalId));

        await ExecuteAsync("UPDATE proctoring_sessions SET last_heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '3 minutes' WHERE id = @id", first.SessionId);
        var heartbeat = await useCase.HeartbeatAsync(OrgA, CandidateA, AssignmentA, default);
        Assert.True(heartbeat.Active);
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_events WHERE type = 'heartbeat_gap' AND session_id = @id", first.SessionId));
        Assert.Equal(2, await ScalarAsync<int>(
            "SELECT flag_count FROM proctoring_sessions WHERE id = @id", first.SessionId));

        var notSubmitted = await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.CompleteAsync(OrgA, CandidateA, AssignmentA, default));
        Assert.Equal("assignment_not_completed", notSubmitted.Code);
        await ExecuteAsync("UPDATE assessment_assignments SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = @id", AssignmentA);
        var completed = await useCase.CompleteAsync(OrgA, CandidateA, AssignmentA, default);
        var repeated = await useCase.CompleteAsync(OrgA, CandidateA, AssignmentA, default);
        Assert.Equal(first.SessionId, completed.SessionId);
        Assert.Equal(completed.EndedAt, repeated.EndedAt);
        Assert.Equal("completed", completed.Status);

        var lost = await useCase.StartAsync(OrgA, CandidateA, AssignmentLostComplete,
            true, true, true, true, null, null, default);
        await ExecuteAsync("UPDATE proctoring_sessions SET last_heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '3 minutes' WHERE id = @id", lost.SessionId);
        // Malformed legacy completion without completed_at must use a stable
        // timestamp, not the wall clock when a reviewer happens to repair it.
        await ExecuteAsync("UPDATE assessment_assignments SET status = 'completed' WHERE id = @id", AssignmentLostComplete);
        Assert.Equal(0, await repository.ReconcileCompletedForAssignmentsAsync(
            OrgA, [AssignmentA], default));
        Assert.Equal(DBNull.Value, await ScalarAsync<object>(
            "SELECT ended_at FROM proctoring_sessions WHERE id = @id", lost.SessionId));
        Assert.Equal(1, await repository.ReconcileCompletedForAssignmentsAsync(
            OrgA, [AssignmentLostComplete], default));
        Assert.Equal(lost.StartedAt, await ScalarAsync<DateTime>(
            "SELECT ended_at FROM proctoring_sessions WHERE id = @id", lost.SessionId));
        Assert.Equal(1L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_events WHERE type = 'heartbeat_gap' AND session_id = @id", lost.SessionId));
        Assert.Equal(0, await repository.ReconcileCompletedForAssignmentsAsync(
            OrgA, [AssignmentLostComplete], default));

        await ExecuteAsync("UPDATE org_entitlements SET enabled = false WHERE organization_id = @id", OrgA);
        var noEntitlement = await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.StartAsync(OrgA, CandidateA, AssignmentNoEntitlement,
                true, true, true, true, null, null, default));
        Assert.Equal("entitlement_missing:proctoring", noEntitlement.Code);
    }

    [Fact]
    public async Task Accommodation_winning_before_conditional_start_cannot_create_a_session()
    {
        // Pause precisely at consent INSERT, after StartAsync read the assignment
        // but before its conditional status UPDATE. This makes the race deterministic.
        await ExecuteAsync("""
            CREATE FUNCTION wait_on_consent() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              PERFORM pg_advisory_lock(714242);
              PERFORM pg_advisory_unlock(714242);
              RETURN NEW;
            END $$;
            CREATE TRIGGER pause_consent BEFORE INSERT ON assessment_consents
              FOR EACH ROW EXECUTE FUNCTION wait_on_consent();
            """);
        await using var blocker = new NpgsqlConnection(_connectionString);
        await blocker.OpenAsync();
        await using (var lockCommand = new NpgsqlCommand("SELECT pg_advisory_lock(714242)", blocker))
            await lockCommand.ExecuteNonQueryAsync();

        await using var startDb = NewContext();
        var startTask = new CandidateProctoringUseCase(
            new CandidateProctoringRepository(startDb)).StartAsync(
                OrgA, CandidateA, AssignmentA, true, true, true, true,
                null, null, CancellationToken.None);
        try
        {
            var waiting = false;
            for (var attempt = 0; attempt < 100 && !waiting; attempt++)
            {
                waiting = await AdvisoryWaiterPresentAsync();
                if (!waiting) await Task.Delay(25);
            }
            Assert.True(waiting, "Candidate start did not reach the paused consent INSERT");

            await ExecuteAsync("""
                UPDATE assessment_assignments SET proctoring_required = false
                WHERE id = @id AND status = 'assigned' AND proctoring_required = true
                """, AssignmentA);
        }
        finally
        {
            await using var unlockCommand = new NpgsqlCommand("SELECT pg_advisory_unlock(714242)", blocker);
            await unlockCommand.ExecuteNonQueryAsync();
        }

        var error = await Assert.ThrowsAsync<ProctoringException>(() => startTask);
        Assert.Equal(ProctoringError.Conflict, error.Error);
        Assert.Equal("assignment_start_race", error.Code);
        Assert.Equal("assigned", await ScalarAsync<string>(
            "SELECT status FROM assessment_assignments WHERE id = @id", AssignmentA));
        Assert.Equal(0L, await ScalarAsync<long>(
            "SELECT count(*) FROM assessment_consents WHERE assignment_id = @id", AssignmentA));
        Assert.Equal(0L, await ScalarAsync<long>(
            "SELECT count(*) FROM proctoring_sessions WHERE assignment_id = @id", AssignmentA));
    }

    private ProctoringDbContext NewContext() => new(new DbContextOptionsBuilder<ProctoringDbContext>()
        .UseNpgsql(_connectionString).Options);

    private async Task ExecuteAsync(string sql, Guid? id = null)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        if (id is { } value) command.Parameters.AddWithValue("id", value);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<T> ScalarAsync<T>(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("id", id);
        return (T)(await command.ExecuteScalarAsync() ?? throw new InvalidOperationException("Missing scalar"));
    }

    private async Task<bool> AdvisoryWaiterPresentAsync()
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted)",
            connection);
        return (bool)(await command.ExecuteScalarAsync() ?? false);
    }

    private const string SchemaSql = """
        CREATE TABLE organizations (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE,
            is_active boolean NOT NULL, deleted_at timestamp(3));
        CREATE TABLE candidates (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            email text NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
            is_active boolean NOT NULL, deleted_at timestamp(3));
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            team_id uuid, business_unit_id uuid, assigned_to uuid, created_by uuid NOT NULL,
            deleted_at timestamp(3));
        CREATE TABLE assessment_types (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            name text NOT NULL, config jsonb, updated_at timestamp(3) NOT NULL);
        CREATE TABLE assessment_assignments (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            candidate_id uuid NOT NULL, vacancy_id uuid NOT NULL, assessment_type_id uuid NOT NULL,
            proctoring_required boolean NOT NULL DEFAULT false, status text NOT NULL,
            started_at timestamp(3), completed_at timestamp(3), expires_at timestamp(3),
            updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE assessment_consents (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            assignment_id uuid NOT NULL UNIQUE, candidate_id uuid NOT NULL, consent_type text NOT NULL,
            text_version text NOT NULL, agreed_at timestamp(3) NOT NULL, ip_address text,
            user_agent text, created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL);
        CREATE TABLE proctoring_sessions (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            assignment_id uuid NOT NULL UNIQUE, started_at timestamp(3) NOT NULL, ended_at timestamp(3),
            consented_at timestamp(3), consent_version text, last_heartbeat_at timestamp(3),
            flag_count integer NOT NULL DEFAULT 0, severity text, review_status text NOT NULL DEFAULT 'unreviewed',
            review_notes text, reviewed_at timestamp(3), reviewed_by_id uuid,
            created_at timestamp(3) NOT NULL, updated_at timestamp(3) NOT NULL,
            UNIQUE (id, organization_id));
        CREATE TABLE proctoring_events (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            session_id uuid NOT NULL, client_event_id uuid NOT NULL, type text NOT NULL,
            source text NOT NULL, severity text NOT NULL, client_at timestamp(3),
            occurred_at timestamp(3) NOT NULL,
            UNIQUE (session_id, client_event_id),
            FOREIGN KEY (session_id, organization_id) REFERENCES proctoring_sessions(id, organization_id),
            CHECK (type IN ('tab_hidden','focus_lost','camera_stopped','screen_share_stopped',
                'face_missing','multiple_faces','model_unavailable','heartbeat_gap')));
        CREATE TABLE org_entitlements (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            module_code text NOT NULL, enabled boolean NOT NULL);
        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_tenant;
        REVOKE UPDATE, DELETE ON proctoring_events FROM app_tenant;
        DO $$ DECLARE t text; BEGIN
          FOREACH t IN ARRAY ARRAY['candidates','vacancies','assessment_types','assessment_assignments',
              'assessment_consents','proctoring_sessions','proctoring_events','org_entitlements'] LOOP
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
            EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = '
                || 'NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid) WITH CHECK '
                || '(organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)', t);
          END LOOP;
        END $$;
        """;

    private const string SeedSql = """
        INSERT INTO organizations (id, slug, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111','org-a',true),
          ('22222222-2222-2222-2222-222222222222','org-b',true);
        INSERT INTO candidates (id, organization_id, email, first_name, last_name, is_active) VALUES
          ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','a@test.local','A','Tester',true),
          ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','b@test.local','B','Tester',true);
        INSERT INTO vacancies (id, organization_id, created_by) VALUES
          ('dddddddd-dddd-dddd-dddd-dddddddddddd','11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
        INSERT INTO assessment_types (id, organization_id, name, config, updated_at) VALUES
          ('ffffffff-ffff-ffff-ffff-ffffffffffff','11111111-1111-1111-1111-111111111111','Test','{}',CURRENT_TIMESTAMP);
        INSERT INTO assessment_assignments (id, organization_id, candidate_id, vacancy_id,
            assessment_type_id, proctoring_required, status) VALUES
          ('cccccccc-cccc-cccc-cccc-ccccccccccca','11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddddd',
            'ffffffff-ffff-ffff-ffff-ffffffffffff',true,'assigned'),
          ('cccccccc-cccc-cccc-cccc-cccccccccccb','11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddddd',
            'ffffffff-ffff-ffff-ffff-ffffffffffff',false,'assigned'),
          ('cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddddd',
            'ffffffff-ffff-ffff-ffff-ffffffffffff',true,'assigned'),
          ('cccccccc-cccc-cccc-cccc-cccccccccccd','11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddddd',
            'ffffffff-ffff-ffff-ffff-ffffffffffff',true,'assigned');
        INSERT INTO org_entitlements (id, organization_id, module_code, enabled) VALUES
          ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','proctoring',true);
        """;
}
