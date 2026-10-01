using Npgsql;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests.CandidateConsent;

/// <summary>
/// #312/#313 Testcontainers fixture: one real Postgres with the Prisma-shaped <c>data_consents</c> (real
/// <c>(subject_user_id, consent_type)</c> unique index), <c>application_consent_evidence</c>,
/// <c>data_subject_requests</c>, <c>candidates</c>, <c>organizations</c> and <c>audit_logs</c>, the tenant tables
/// under the production RLS mechanism (NOLOGIN/NOBYPASSRLS <c>app_tenant</c>, ENABLE + FORCE RLS, fail-closed
/// <c>tenant_isolation</c>), plus the identity/RBAC plane the staff gate reads.
///
/// Principals (OrgA unless noted): Admin = candidate read+update @ organization; Narrow = candidate read+update @
/// team (fails the org-scope requirement → 403); ReadOnly = candidate read @ organization (→ 403 on withdrawal);
/// OrgBAdmin = OrgB admin (cross-org). Each test that mutates state owns its own candidate.
/// </summary>
public sealed class CandidateConsentFixture : IAsyncLifetime
{
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid AdminId = Guid.Parse("c0000000-0000-0000-0000-000000000001");

    /// <summary>OrgA, granted consent + two evidence rows (one live, one backfilled). Read-only in tests.</summary>
    public static readonly Guid Granted = Guid.Parse("d0000000-0000-0000-0000-000000000001");

    /// <summary>OrgA, granted consent — the staff-withdrawal target.</summary>
    public static readonly Guid StaffTarget = Guid.Parse("d0000000-0000-0000-0000-000000000002");

    /// <summary>OrgA, NO consent row (staff-entered) — withdrawal creates a withdrawal-only marker.</summary>
    public static readonly Guid NoConsent = Guid.Parse("d0000000-0000-0000-0000-000000000003");

    /// <summary>OrgA, already withdrawn.</summary>
    public static readonly Guid AlreadyWithdrawn = Guid.Parse("d0000000-0000-0000-0000-000000000004");

    /// <summary>OrgA, granted — the concurrent-withdrawal target.</summary>
    public static readonly Guid Concurrent = Guid.Parse("d0000000-0000-0000-0000-000000000005");

    /// <summary>OrgA, self-service: two case variants of luz@example.com (one soft-deleted).</summary>
    public static readonly Guid PortalLower = Guid.Parse("d0000000-0000-0000-0000-000000000006");
    public static readonly Guid PortalMixedDeleted = Guid.Parse("d0000000-0000-0000-0000-000000000007");

    /// <summary>OrgA, l_z@example.com — must NOT match luz@example.com (`_` is not a wildcard).</summary>
    public static readonly Guid PortalWildcardNeighbour = Guid.Parse("d0000000-0000-0000-0000-000000000008");

    /// <summary>OrgB, luz@example.com — another tenant's candidate with the same email.</summary>
    public static readonly Guid PortalOtherOrg = Guid.Parse("d0000000-0000-0000-0000-0000000000b8");

    /// <summary>OrgA, no consent row, never mutated by any test.</summary>
    public static readonly Guid Untouched = Guid.Parse("d0000000-0000-0000-0000-000000000009");

    /// <summary>OrgB candidate — cross-org staff target.</summary>
    public static readonly Guid OrgBCandidate = Guid.Parse("d0000000-0000-0000-0000-0000000000b1");

    /// <summary>OrgA candidate with two SEEDED requests (one pending, one completed) — the staff list's fixture.</summary>
    public static readonly Guid Listed = Guid.Parse("d0000000-0000-0000-0000-00000000000a");
    public static readonly Guid ListedPendingRequest = Guid.Parse("70000000-0000-0000-0000-000000000001");
    public static readonly Guid ListedCompletedRequest = Guid.Parse("70000000-0000-0000-0000-000000000002");

    /// <summary>OrgB candidate with a seeded pending request — must never appear in OrgA's list.</summary>
    public static readonly Guid OrgBListed = Guid.Parse("d0000000-0000-0000-0000-0000000000b9");
    public static readonly Guid OrgBPendingRequest = Guid.Parse("70000000-0000-0000-0000-0000000000b1");

    /// <summary>OrgA: active user holding BOTH hr_admin and super_admin (alerted once per request).</summary>
    public static readonly Guid HrAdminId = Guid.Parse("c0000000-0000-0000-0000-000000000010");
    public const string HrAdminEmail = "hr@tims.test";

    public static readonly Guid GrantedApplication = Guid.Parse("a1000000-0000-0000-0000-000000000001");
    public static readonly Guid BackfilledApplication = Guid.Parse("a1000000-0000-0000-0000-000000000002");

    public const string AdminSub = "sub-cc-admin";
    public const string NarrowSub = "sub-cc-narrow";
    public const string ReadOnlySub = "sub-cc-read";
    public const string OrgBAdminSub = "sub-cc-orgb";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .WithDatabase("tims_candidate_consent")
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        foreach (var sql in new[] { "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;", SchemaSql, SeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    public async Task<T?> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        var result = await command.ExecuteScalarAsync();
        return result is null or DBNull ? default : (T)result;
    }

    public async Task<long> CountAsync(string sql, params (string Name, object Value)[] parameters) =>
        await ScalarAsync<long>(sql, parameters);

    public Task<long> CountAuditAsync(Guid candidateId) => CountAsync(
        "SELECT COUNT(*) FROM audit_logs WHERE entity = 'candidate' AND entity_id = @e AND action = 'candidate_consent_withdrawn'",
        ("e", candidateId.ToString()));

    public Task<long> CountDeletionRequestsAsync(Guid candidateId) => CountAsync(
        "SELECT COUNT(*) FROM data_subject_requests WHERE candidate_id = @c AND request_type = 'deletion'",
        ("c", candidateId));

    /// <summary>Admin alerts written for the data subject requests of <paramref name="candidateId"/>.</summary>
    public Task<long> CountAlertsAsync(Guid candidateId) => CountAsync(
        "SELECT COUNT(*) FROM notifications n WHERE n.entity_id IN (SELECT id FROM data_subject_requests WHERE candidate_id = @c)",
        ("c", candidateId));

    public Task<long> CountWithdrawnAsync(Guid candidateId) => CountAsync(
        "SELECT COUNT(*) FROM data_consents WHERE subject_user_id = @c AND consent_type = 'recruitment_data_processing' AND withdrawn_at IS NOT NULL",
        ("c", candidateId));

    private const string Tenant = "NULLIF(current_setting('app.current_org_id', true), '')::uuid";

    private static string[] TenantTables =>
        ["candidates", "data_consents", "application_consent_evidence", "data_subject_requests", "audit_logs", "notifications", "roles"];

    private static string SchemaSql => TableSql + string.Concat(TenantTables.Select(t =>
        $"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY; ALTER TABLE {t} FORCE ROW LEVEL SECURITY; " +
        $"CREATE POLICY tenant_isolation ON {t} USING (organization_id = {Tenant}) WITH CHECK (organization_id = {Tenant});\n"));

    private static readonly string TableSql =
        $"""
        CREATE TABLE organizations (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY, organization_id uuid NULL, supabase_user_id text NOT NULL UNIQUE, email text NOT NULL,
            first_name text NOT NULL, last_name text NOT NULL, is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true, deleted_at timestamp(3) NULL);
        CREATE TABLE roles (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users (id), role_id uuid NOT NULL REFERENCES roles (id));
        CREATE TABLE permissions (id uuid PRIMARY KEY, module text NOT NULL, action text NOT NULL);
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles (id),
            permission_id uuid NOT NULL REFERENCES permissions (id), scope text NOT NULL DEFAULT 'own');

        CREATE TABLE candidates (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, email text NOT NULL, first_name text NOT NULL,
            last_name text NOT NULL, deleted_at timestamp(3) NULL);
        CREATE UNIQUE INDEX candidates_organization_id_email_key ON candidates (organization_id, email);

        CREATE TABLE data_consents (
            id uuid NOT NULL PRIMARY KEY, organization_id uuid NOT NULL, subject_user_id uuid NOT NULL,
            consent_type text NOT NULL, text_version text NOT NULL,
            agreed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            withdrawn_at timestamp(3) without time zone,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at timestamp(3) without time zone NOT NULL,
            withdrawal_channel character varying(30), withdrawal_reason character varying(500), withdrawn_by_user_id uuid);
        CREATE UNIQUE INDEX data_consents_subject_user_id_consent_type_key ON data_consents (subject_user_id, consent_type);

        CREATE TABLE application_consent_evidence (
            id uuid NOT NULL PRIMARY KEY, organization_id uuid NOT NULL, application_id uuid NOT NULL,
            candidate_id uuid NOT NULL, consent_type character varying(64) NOT NULL,
            text_version character varying(64) NOT NULL, text_sha256 character varying(64), locale character varying(5),
            agreed_at timestamp(3) without time zone NOT NULL, ip_hash character varying(64),
            user_agent character varying(512), captcha_verified boolean, is_backfilled boolean DEFAULT false NOT NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at timestamp(3) without time zone NOT NULL);
        CREATE UNIQUE INDEX application_consent_evidence_application_id_consent_type_key
            ON application_consent_evidence (application_id, consent_type);

        CREATE TABLE data_subject_requests (
            id uuid NOT NULL PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL,
            request_type character varying(30) NOT NULL, status character varying(20) DEFAULT 'pending' NOT NULL,
            source character varying(30) NOT NULL, reason character varying(500), requested_by_user_id uuid,
            resolved_at timestamp(3) without time zone, resolved_by_user_id uuid,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at timestamp(3) without time zone NOT NULL);

        CREATE TABLE notifications (
            id uuid NOT NULL PRIMARY KEY, organization_id uuid, user_id uuid NOT NULL, type text NOT NULL,
            title text NOT NULL, message text, module text, entity_type text, entity_id uuid, action_url text,
            read boolean DEFAULT false NOT NULL, read_at timestamp(3) without time zone,
            archived boolean DEFAULT false NOT NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL);

        CREATE TABLE audit_logs (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations (id), user_id uuid NULL,
            actor_id uuid NULL, action text NOT NULL, entity text NOT NULL, entity_id text NULL, changes jsonb NULL,
            metadata jsonb NULL, ip_address text NULL, user_agent text NULL,
            created_at timestamp(3) NOT NULL DEFAULT now());

        GRANT SELECT ON users, roles, user_roles TO app_tenant;
        GRANT SELECT, INSERT ON notifications TO app_tenant;
        GRANT SELECT ON candidates TO app_tenant;
        GRANT SELECT, INSERT, UPDATE, DELETE ON data_consents, application_consent_evidence, data_subject_requests TO app_tenant;
        GRANT SELECT, INSERT ON audit_logs TO app_tenant;
        ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON users USING (organization_id = {Tenant});
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id, slug) VALUES
          ('11111111-1111-1111-1111-111111111111', 'acme'), ('22222222-2222-2222-2222-222222222222', 'globex');
        INSERT INTO organizations (id, slug, is_active) VALUES ('33333333-3333-3333-3333-333333333333', 'dormida', false);
        INSERT INTO roles (id, organization_id, slug, name) VALUES
          ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'recruiter', 'Recruiter'),
          ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'leader', 'Leader'),
          ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'viewer', 'Viewer'),
          ('a0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'recruiter', 'OrgB Recruiter'),
          ('a0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'hr_admin', 'HR Admin'),
          ('a0000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'super_admin', 'Super Admin'),
          ('a0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'hr_admin', 'OrgB HR Admin');
        INSERT INTO permissions (id, module, action) VALUES
          ('b0000000-0000-0000-0000-000000000001', 'candidate', 'read'),
          ('b0000000-0000-0000-0000-000000000002', 'candidate', 'update');
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'organization'),
          ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'team'),
          ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'team'),
          ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'organization'),
          ('90000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'organization');
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name) VALUES
          ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'sub-cc-admin',  'admin@tims.test',  'Ana', 'Admin'),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-cc-narrow', 'narrow@tims.test', 'Leo', 'Narrow'),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-cc-read',   'read@tims.test',   'Rea', 'Reader'),
          ('c0000000-0000-0000-0000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'sub-cc-orgb',   'orgb@tims.test',   'Bob', 'OrgB'),
          ('c0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'sub-cc-hr',     'hr@tims.test',     'Hana', 'HR'),
          ('c0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'sub-cc-orgb-hr','orgbhr@tims.test', 'Olga', 'HR');
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'sub-cc-off',    'off@tims.test',    'Otto', 'Off', false);
        INSERT INTO user_roles (id, user_id, role_id) VALUES
          ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
          ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002'),
          ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
          ('e0000000-0000-0000-0000-0000000000b0', 'c0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-0000000000b1'),
          ('e0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010'),
          ('e0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000011'),
          ('e0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000010'),
          ('e0000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b2');

        INSERT INTO candidates (id, organization_id, email, first_name, last_name, deleted_at) VALUES
          ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ana@example.com', 'Ana', 'G', NULL),
          ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'staff@example.com', 'Sol', 'T', NULL),
          ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'manual@example.com', 'Max', 'M', NULL),
          ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'gone@example.com', 'Ida', 'W', NULL),
          ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'race@example.com', 'Rui', 'C', NULL),
          ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'luz@example.com', 'Luz', 'P', NULL),
          ('d0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', ' Luz@Example.COM', 'Luz', 'P', '2026-06-01 00:00:00'),
          ('d0000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'l_z@example.com', 'Lia', 'Z', NULL),
          ('d0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'quiet@example.com', 'Quim', 'Q', NULL),
          ('d0000000-0000-0000-0000-0000000000b8', '22222222-2222-2222-2222-222222222222', 'luz@example.com', 'Luz', 'B', NULL),
          ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'orgb@example.com', 'Oto', 'B', NULL),
          ('d0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'listed@example.com', 'Lina', 'Lista', NULL),
          ('d0000000-0000-0000-0000-0000000000b9', '22222222-2222-2222-2222-222222222222', 'orgblisted@example.com', 'Bea', 'B', NULL);

        INSERT INTO data_subject_requests (id, organization_id, candidate_id, request_type, status, source, created_at, updated_at) VALUES
          ('70000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-00000000000a', 'deletion', 'pending', 'candidate_portal', '2026-10-01 15:30:00', '2026-10-01 15:30:00'),
          ('70000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-00000000000a', 'deletion', 'completed', 'staff', '2026-09-01 10:00:00', '2026-09-02 10:00:00'),
          ('70000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b9', 'deletion', 'pending', 'staff', '2026-09-20 10:00:00', '2026-09-20 10:00:00');

        INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, text_version, agreed_at, withdrawn_at, updated_at) VALUES
          ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'recruitment_data_processing', 'portal-apply-2026-09-29', '2026-09-30 10:00:00', NULL, '2026-09-30 10:00:00'),
          ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 'recruitment_data_processing', 'portal-apply-2026-09-29', '2026-09-30 10:00:00', NULL, '2026-09-30 10:00:00'),
          ('f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004', 'recruitment_data_processing', 'portal-apply-2026-09-29', '2026-09-01 10:00:00', '2026-09-15 10:00:00', '2026-09-15 10:00:00'),
          ('f0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'recruitment_data_processing', 'portal-apply-2026-09-29', '2026-09-30 10:00:00', NULL, '2026-09-30 10:00:00'),
          ('f0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'recruitment_data_processing', 'portal-apply-2026-09-29', '2026-09-30 10:00:00', NULL, '2026-09-30 10:00:00'),
          ('f0000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000008', 'recruitment_data_processing', 'portal-apply-2026-09-29', '2026-09-30 10:00:00', NULL, '2026-09-30 10:00:00'),
          ('f0000000-0000-0000-0000-0000000000b8', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-0000000000b8', 'recruitment_data_processing', 'portal-apply-2026-09-29', '2026-09-30 10:00:00', NULL, '2026-09-30 10:00:00');

        INSERT INTO application_consent_evidence (id, organization_id, application_id, candidate_id, consent_type, text_version, text_sha256, locale, agreed_at, ip_hash, user_agent, captcha_verified, is_backfilled, updated_at) VALUES
          ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'recruitment_data_processing', 'portal-apply-2026-09-29', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'es', '2026-09-30 10:00:00', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Mozilla/5.0', true, false, '2026-09-30 10:00:00'),
          ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'recruitment_data_processing', 'portal-apply-2026-09-29', NULL, NULL, '2026-09-01 10:00:00', NULL, NULL, NULL, true, '2026-09-30 10:00:00');
        """;
}
