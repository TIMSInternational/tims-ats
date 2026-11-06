using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.InterviewTranscription;

/// <summary>
/// Testcontainers fixture for the interview transcription slice: the Prisma-shaped tables it reads/writes
/// (<c>interviews</c>, <c>interview_evaluators</c>, <c>candidates</c>, <c>vacancies</c>, <c>job_profiles</c>,
/// <c>audit_logs</c>) under the production RLS mechanism (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE,
/// fail-closed <c>tenant_isolation</c>; <c>interview_evaluators</c> through its parent like production), plus the
/// identity/RBAC plane the staff gate reads.
///
/// Principals (OrgA; real staff role slugs, since the resolver drops unknown ones): Recruiter (recruiter) = interview
/// read+create @ organization; Evaluator (committee) = interview read+create @ own, assigned to <see cref="Assigned"/>;
/// Outsider (employee) = interview read @ own, assigned to nothing; NoGrant (leader) = no interview grant;
/// OrgBRecruiter = OrgB's org-wide recruiter.
/// </summary>
public sealed class InterviewTranscriptionFixture : IAsyncLifetime
{
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid RecruiterId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid EvaluatorId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid VacancyA = Guid.Parse("a2000000-0000-0000-0000-000000000001");
    public static readonly Guid CandidateA = Guid.Parse("d0000000-0000-0000-0000-000000000001");

    /// <summary>OrgA video interview with its own Daily room, assigned to the Evaluator. Read-only in tests.</summary>
    public static readonly Guid Assigned = Guid.Parse("1234abcd-0000-4000-8000-000000000001");

    /// <summary>OrgB interview — cross-tenant target.</summary>
    public static readonly Guid OrgBInterview = Guid.Parse("1234abcd-0000-4000-8000-0000000000b1");

    public const string RecruiterSub = "sub-it-recruiter";
    public const string EvaluatorSub = "sub-it-evaluator";
    public const string OutsiderSub = "sub-it-outsider";
    public const string NoGrantSub = "sub-it-nogrant";
    public const string OrgBRecruiterSub = "sub-it-orgb";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres").WithDatabase("tims_interview_transcription").Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        await ExecuteAsync("CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;");
        await ExecuteAsync(SchemaSql);
        await ExecuteAsync(SeedSql);
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<T?> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        var result = await command.ExecuteScalarAsync();
        return result is null or DBNull ? default : (T)result;
    }

    /// <summary>A fresh OrgA (or given org) video interview with its own room, so a mutating test owns its row.</summary>
    public async Task<Guid> AddInterviewAsync(Guid? organizationId = null, string status = "scheduled",
        string? meetingUrl = "own")
    {
        var org = organizationId ?? OrgA;
        var id = Guid.NewGuid();
        var candidate = Guid.NewGuid();
        var vacancy = Guid.NewGuid();
        await ExecuteAsync("""
            INSERT INTO candidates(id,organization_id,email,first_name,last_name) VALUES(@c,@org,@email,'Ana','Pérez');
            INSERT INTO vacancies(id,organization_id,title) VALUES(@v,@org,'Analista de datos');
            INSERT INTO job_profiles(id,organization_id,vacancy_id,competencies)
              VALUES(gen_random_uuid(),@org,@v,'[{"name":"Comunicación","level":4},{"name":"SQL"},{"name":"  "},{"name":"SQL"}]');
            INSERT INTO interviews(id,organization_id,candidate_id,vacancy_id,type,status,meeting_url,created_by_id)
              VALUES(@id,@org,@c,@v,'video',@status,@url,@creator);
            INSERT INTO interview_evaluators(id,interview_id,user_id) VALUES(gen_random_uuid(),@id,@evaluator);
            """, ("c", candidate), ("org", org), ("email", $"{candidate:N}@example.com"), ("v", vacancy), ("id", id),
            ("status", status), ("url", meetingUrl == "own" ? $"https://tims.daily.co/tims-{id:N}" : (object?)meetingUrl ?? DBNull.Value),
            ("creator", RecruiterId), ("evaluator", EvaluatorId));
        return id;
    }

    public Task<long> CountAuditAsync(Guid interviewId, string action) => ScalarAsync<long>(
        "SELECT count(*) FROM audit_logs WHERE entity='interview' AND entity_id=@e AND action=@a",
        ("e", interviewId.ToString()), ("a", action));

    private const string Tenant = "NULLIF(current_setting('app.current_org_id', true), '')::uuid";

    private static string SchemaSql => TableSql + string.Concat(
        new[] { "candidates", "vacancies", "job_profiles", "interviews", "audit_logs", "roles" }.Select(t =>
            $"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY; ALTER TABLE {t} FORCE ROW LEVEL SECURITY; " +
            $"CREATE POLICY tenant_isolation ON {t} USING (organization_id = {Tenant}) WITH CHECK (organization_id = {Tenant});\n")) +
        $"""
        ALTER TABLE interview_evaluators ENABLE ROW LEVEL SECURITY; ALTER TABLE interview_evaluators FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON interview_evaluators USING (EXISTS (SELECT 1 FROM interviews par
          WHERE par.id = interview_evaluators.interview_id AND par.organization_id = {Tenant}));
        ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON users USING (organization_id = {Tenant});
        """;

    private const string TableSql = """
        CREATE TABLE organizations (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY, organization_id uuid NULL, supabase_user_id text NOT NULL UNIQUE, email text NOT NULL,
            first_name text NOT NULL, last_name text NOT NULL, is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true, deleted_at timestamp(3) NULL);
        CREATE TABLE roles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');
        CREATE TABLE candidates (id uuid PRIMARY KEY, organization_id uuid NOT NULL, email text NOT NULL,
            first_name text NOT NULL, last_name text NOT NULL, deleted_at timestamp(3) NULL);
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL, title text NOT NULL, team_id uuid NULL,
            business_unit_id uuid NULL, assigned_to uuid NULL, created_by uuid NULL, deleted_at timestamp(3) NULL);
        CREATE TABLE job_profiles (id uuid PRIMARY KEY, organization_id uuid NOT NULL, vacancy_id uuid NOT NULL UNIQUE,
            competencies jsonb NOT NULL DEFAULT '{}');
        CREATE TABLE interviews (id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL,
            vacancy_id uuid NOT NULL, type text NOT NULL, status text NOT NULL DEFAULT 'scheduled', meeting_url text NULL,
            recording_url text NULL, transcript_url text NULL, created_by_id uuid NOT NULL,
            updated_at timestamp(3) NOT NULL DEFAULT now());
        CREATE TABLE interview_evaluators (id uuid PRIMARY KEY, interview_id uuid NOT NULL REFERENCES interviews (id),
            user_id uuid NOT NULL);
        CREATE TABLE audit_logs (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations (id), user_id uuid NULL,
            actor_id uuid NULL, action text NOT NULL, entity text NOT NULL, entity_id text NULL, changes jsonb NULL,
            metadata jsonb NULL, ip_address text NULL, user_agent text NULL,
            created_at timestamp(3) NOT NULL DEFAULT now());
        GRANT SELECT ON users, roles, user_roles, candidates, vacancies, job_profiles, interview_evaluators TO app_tenant;
        GRANT SELECT, UPDATE ON interviews TO app_tenant;
        GRANT SELECT, INSERT ON audit_logs TO app_tenant;
        """;

    private const string SeedSql = """
        INSERT INTO organizations (id, slug) VALUES
          ('11111111-1111-1111-1111-111111111111', 'acme'), ('22222222-2222-2222-2222-222222222222', 'globex');
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'committee', 'Committee (evaluator)'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'employee', 'Employee (outsider)'),
          ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader (no interview grant)'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'recruiter', 'OrgB Recruiter');
        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'interview', 'read'),
          ('b0000000-0000-0000-0000-000000000002', 'interview', 'create'),
          ('b0000000-0000-0000-0000-000000000003', 'candidate', 'read');
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'own'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'own'),
          ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'own'),
          ('90000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'organization'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization');
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-it-recruiter', 'rec@tims.test', 'Laura', 'Mora'),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-it-evaluator', 'eva@tims.test', 'Diego', 'Solís'),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-it-outsider', 'out@tims.test', 'Otto', 'Fuera'),
          ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'sub-it-nogrant', 'no@tims.test', 'Nora', 'Sin'),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-it-orgb', 'orgb@tims.test', 'Bob', 'OrgB');
        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004'),
          ('e0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1');
        INSERT INTO candidates (id, organization_id, email, first_name, last_name) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ana@example.com', 'Ana', 'Pérez'),
          ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'b@example.com', 'Bea', 'B');
        INSERT INTO vacancies (id, organization_id, title) VALUES
          ('a2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Analista'),
          ('a2000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'OrgB');
        INSERT INTO interviews (id, organization_id, candidate_id, vacancy_id, type, status, meeting_url, created_by_id) VALUES
          ('1234abcd-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001',
           'a2000000-0000-0000-0000-000000000001', 'video', 'scheduled', 'https://tims.daily.co/tims-1234abcd000040008000000000000001',
           'c0000000-0000-0000-0000-000000000001'),
          ('1234abcd-0000-4000-8000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b1',
           'a2000000-0000-0000-0000-0000000000b1', 'video', 'scheduled', NULL, 'c0000000-0000-0000-0000-0000000000b0');
        INSERT INTO interview_evaluators (id, interview_id, user_id) VALUES
          ('f0000000-0000-0000-0000-000000000001', '1234abcd-0000-4000-8000-000000000001', 'c0000000-0000-0000-0000-000000000002');
        """;
}

[CollectionDefinition("InterviewTranscription")]
public sealed class InterviewTranscriptionCollection : ICollectionFixture<InterviewTranscriptionFixture>;
