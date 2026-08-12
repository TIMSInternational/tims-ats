using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.PlatformInvitations;

namespace Tims.IntegrationTests.PlatformInvitations;

/// <summary>
/// Phase-5 slice 22 (issue #75) Testcontainers fixture: one real Postgres carrying the Prisma-owned
/// <c>platform_invitations</c> table plus the identity plane and <c>audit_logs</c>.
///
/// <para><b>The two enum columns are declared as NATIVE Postgres enum types, exactly as prod has them</b>
/// (<c>packages/db/baseline/prod-public-schema.sql</c>: <c>type public."InvitationType" NOT NULL</c>,
/// <c>status public."InvitationStatus" ... NOT NULL</c>). That is the whole point of using a real Postgres
/// here rather than an in-memory provider: TRAP 3 says EFCore.PG cannot materialise an unmapped enum into a
/// CLR <c>string</c>, and the failure appears ONLY against a real server, on the first materialised row.
/// Declaring these as <c>text</c> would make every test below pass while
/// <see cref="PlatformInvitationsDataSource"/> was deleted — which is precisely the hollow-guard shape this
/// repo keeps getting burned by.</para>
///
/// <para><b>All five timestamps are <c>timestamp(3) without time zone</c>, also as prod has them</c></b>, so
/// Npgsql yields <see cref="DateTimeKind.Unspecified"/> and the NodeIso converters on the read models are
/// exercised for real (TRAP 6). A fixture using <c>timestamptz</c> would silently mask the missing-<c>Z</c>
/// defect that cost #211/#216 five of its nine divergences.</para>
///
/// <para><b>RLS is enabled + FORCED on <c>platform_invitations</c>, and the cross-org read still succeeds.</b>
/// That is not a gap in the fixture, it is the documented property of this surface: the connection is the
/// privileged login role (superuser in the container, BYPASSRLS in prod), the context is never wrapped in
/// <c>TenantScope</c>, and <c>PlatformOwnerGate</c> is the entire authorization boundary. Mirrors
/// <c>AuditReadFixture</c>'s identical disposition.</para>
/// </summary>
public sealed class PlatformInvitationsReadFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_platform_invitations_read";

    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public const string PlatformOwnerSub = "sub-inv-platform-owner";
    public const string OrgUserSub = "sub-inv-org-user";

    /// <summary>
    /// A platform owner who ALSO has an <c>organization_id</c>. Rarer than the org-less shape but real
    /// (<c>trpc.ts</c>'s tenant middleware has a dedicated branch for "platform owners WITH an org row of
    /// their own"), and it is the ONLY caller shape for which the export's audit write actually happens —
    /// so without this principal the write branch of <c>logPlatformExport</c>'s resolve-or-skip is
    /// unreachable and therefore untested.
    /// </summary>
    public const string PlatformOwnerWithOrgSub = "sub-inv-platform-owner-with-org";

    /// <summary>The org-less platform owner — the caller shape that makes the export write NO audit row.</summary>
    public static readonly Guid PlatformOwnerId = Guid.Parse("c0000000-0000-0000-0000-000000000001");

    public static readonly Guid PlatformOwnerWithOrgId = Guid.Parse("c0000000-0000-0000-0000-000000000003");

    /// <summary>The ordinary OrgA staff user. Also the <c>invited_by_id</c> on every seeded invitation, so
    /// the nested <c>invitedBy</c> join has a real row to resolve.</summary>
    public static readonly Guid OrgUserId = Guid.Parse("c0000000-0000-0000-0000-000000000002");

    /// <summary>OrgA, <c>org_admin</c>/<c>sent</c>, org present. Counts toward the `pending` KPI.</summary>
    public static readonly Guid InvitationSentOrgA = Guid.Parse("e0000000-0000-0000-0000-000000000001");

    /// <summary>OrgA, <c>user</c>/<c>accepted</c>, <c>accepted_at</c> set.</summary>
    public static readonly Guid InvitationAcceptedOrgA = Guid.Parse("e0000000-0000-0000-0000-000000000002");

    /// <summary>OrgB, <c>user</c>/<c>pending</c> — the cross-org row. Also counts toward `pending`.</summary>
    public static readonly Guid InvitationPendingOrgB = Guid.Parse("e0000000-0000-0000-0000-000000000003");

    /// <summary>
    /// <c>organization_id IS NULL</c> — a platform invitation that precedes the org it will create. Backs
    /// the assertion that the nested <c>organization</c> is <c>null</c> rather than absent or a stub.
    /// </summary>
    public static readonly Guid InvitationOrgless = Guid.Parse("e0000000-0000-0000-0000-000000000004");

    /// <summary>
    /// <c>revoked</c>, with a hostile <c>organization_name</c> and an EMPTY-STRING <c>role_slug</c>. Backs
    /// the CSV assertions: quote-doubling, the embedded comma, the <c>|| '-'</c> falsy fallback, and the
    /// DELIBERATELY ABSENT formula-injection neutralisation. Also the only row in no KPI bucket.
    /// </summary>
    public static readonly Guid InvitationRevoked = Guid.Parse("e0000000-0000-0000-0000-000000000005");

    /// <summary>The hostile org name, kept as a constant so the test asserts against the same literal the
    /// fixture seeds. A leading <c>=</c> is reachable in production: <c>organizationName</c> is validated by
    /// <c>z.string().min(2).max(100)</c> with no character restriction.</summary>
    public const string HostileOrganizationName = "=1+1\", Inc";

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
            role.CommandText = "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;";
            await role.ExecuteNonQueryAsync();
        }

        foreach (var sql in new[] { IdentitySchemaSql, IdentitySeedSql, InvitationsSchemaSql, InvitationsSeedSql })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    /// <summary>
    /// A context built the way PRODUCTION builds it — through
    /// <see cref="PlatformInvitationsDataSource"/>, so <c>EnableUnmappedTypes</c> is in play. A test that
    /// used a bare <c>UseNpgsql(ConnectionString)</c> would throw on the first row and read as a test bug.
    /// </summary>
    public PlatformInvitationsReadDbContext NewReadContext() =>
        new(new DbContextOptionsBuilder<PlatformInvitationsReadDbContext>()
            .UseNpgsql(PlatformInvitationsDataSource.Build(ConnectionString))
            .Options);

    /// <summary>A context on a PLAIN connection string, with no <c>EnableUnmappedTypes</c> — used by the
    /// regression test that proves the data source is load-bearing rather than decorative.</summary>
    public PlatformInvitationsReadDbContext NewReadContextWithoutUnmappedTypes() =>
        new(new DbContextOptionsBuilder<PlatformInvitationsReadDbContext>()
            .UseNpgsql(ConnectionString)
            .Options);

    /// <summary>
    /// Total <c>platform_export</c> audit rows. Callers assert on the DELTA across a request, never on an
    /// absolute value: this container is shared by every test in the collection and xUnit does not order
    /// tests within a class, so an absolute assertion here would make the two export-audit tests depend on
    /// which of them ran first.
    /// </summary>
    public async Task<int> CountAuditRowsAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM audit_logs WHERE action = 'platform_export';";
        return Convert.ToInt32(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The <c>platform_export</c> rows attributable to one actor, as
    /// <c>(organization_id, entity, metadata)</c> — keyed on the actor so the assertion is independent of
    /// anything other tests in this collection wrote.
    /// </summary>
    public async Task<List<(Guid OrganizationId, string Entity, string? Metadata)>> GetExportAuditRowsForActorAsync(Guid actorId)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT organization_id, entity, metadata::text FROM audit_logs WHERE action = 'platform_export' AND actor_id = @actor;";
        command.Parameters.AddWithValue("actor", actorId);

        var rows = new List<(Guid, string, string?)>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2)));
        }

        return rows;
    }

    private const string IdentitySchemaSql =
        """
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id),
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NULL,
            last_name text NULL,
            avatar text NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );
        -- Schema-only, exactly as AuditReadFixture keeps them: PlatformOwnerGate checks PrincipalType and
        -- never a grant, but IdentityRepository unconditionally Includes UserRoles→Role on every staff
        -- lookup, so without these two tables the resolve 500s on "relation does not exist" BEFORE the gate
        -- is ever reached — and a 500 would read as a gate failure (TRAP 4).
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
        """;

    private const string IdentitySeedSql =
        """
        INSERT INTO organizations (id, name, is_active) VALUES
          ('11111111-1111-1111-1111-111111111111', 'Acme Corp', true),
          ('22222222-2222-2222-2222-222222222222', 'Globex Inc', true);

        -- One real ORG-LESS platform owner (organization_id NULL — the shape seed.ts creates, and the shape
        -- that makes logPlatformExport's resolve-or-skip SKIP) + one ordinary org-scoped staff user with no
        -- grants, since PlatformOwnerGate never consults a grant.
        -- ...plus a platform owner who DOES have an org row, which is the only shape that reaches the audit
        -- write branch of the export's resolve-or-skip.
        INSERT INTO users (id, organization_id, supabase_user_id, email, first_name, last_name, avatar, is_platform_owner, is_active) VALUES
          ('c0000000-0000-0000-0000-000000000001', NULL, 'sub-inv-platform-owner', 'owner@tims.test', 'Olivia', 'Owner', NULL, true, true),
          ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'sub-inv-org-user', 'orguser@tims.test', 'Rick', 'Recruiter', NULL, false, true),
          ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'sub-inv-platform-owner-with-org', 'owner-with-org@tims.test', 'Omar', 'Ownerson', NULL, true, true);
        """;

    // The NATIVE enum types and the timestamp(3) columns are the two things that must match prod exactly —
    // see the class docblock for why each one is load-bearing rather than incidental.
    private const string InvitationsSchemaSql =
        """
        CREATE TYPE public."InvitationType" AS ENUM ('org_admin', 'user');
        CREATE TYPE public."InvitationStatus" AS ENUM ('pending', 'sent', 'accepted', 'expired', 'revoked');

        CREATE TABLE platform_invitations (
            id uuid PRIMARY KEY,
            email text NOT NULL,
            type public."InvitationType" NOT NULL,
            organization_id uuid NULL REFERENCES organizations (id),
            organization_name text NULL,
            organization_slug text NULL,
            organization_plan text NULL,
            role_slug text NULL,
            token text NOT NULL UNIQUE,
            status public."InvitationStatus" DEFAULT 'pending'::public."InvitationStatus" NOT NULL,
            invited_by_id uuid NOT NULL REFERENCES users (id),
            sent_at timestamp(3) without time zone NULL,
            accepted_at timestamp(3) without time zone NULL,
            expires_at timestamp(3) without time zone NOT NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at timestamp(3) without time zone NOT NULL
        );
        GRANT SELECT ON platform_invitations TO app_tenant;
        ALTER TABLE platform_invitations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE platform_invitations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON platform_invitations
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // FIVE rows, and the KPI arithmetic below is deliberately non-trivial:
    //   total 5, pending 2 (one `pending` + one `sent`), accepted 1, expired 1 — and one `revoked` row that
    //   falls into NO bucket, so 2 + 1 + 1 != 5. A fixture where the buckets summed to the total could not
    //   tell a correct port from one that counted `revoked` somewhere.
    // created_at is distinct per row so `ORDER BY created_at DESC` has ONE correct answer (no ties), since
    // the port deliberately adds no tiebreaker.
    private const string InvitationsSeedSql =
        """
        INSERT INTO platform_invitations
          (id, email, type, organization_id, organization_name, organization_slug, organization_plan, role_slug, token, status, invited_by_id, sent_at, accepted_at, expires_at, created_at, updated_at)
        VALUES
          ('e0000000-0000-0000-0000-000000000001', 'sent@acme.test', 'org_admin', '11111111-1111-1111-1111-111111111111', 'Acme Corp', 'acme', 'trial', NULL, 'token-sent-orga', 'sent', 'c0000000-0000-0000-0000-000000000002', '2026-07-01T08:30:00.123', NULL, '2026-08-20T00:00:00.000', '2026-07-01T08:00:00.000', '2026-07-01T08:00:00.000'),
          ('e0000000-0000-0000-0000-000000000002', 'accepted@acme.test', 'user', '11111111-1111-1111-1111-111111111111', 'Acme Corp', 'acme', NULL, 'hr_admin', 'token-accepted-orga', 'accepted', 'c0000000-0000-0000-0000-000000000002', '2026-07-02T08:30:00.000', '2026-07-03T09:45:00.500', '2026-08-21T00:00:00.000', '2026-07-02T08:00:00.000', '2026-07-02T08:00:00.000'),
          ('e0000000-0000-0000-0000-000000000003', 'pending@globex.test', 'user', '22222222-2222-2222-2222-222222222222', 'Globex Inc', 'globex', NULL, 'hrbp', 'token-pending-orgb', 'pending', 'c0000000-0000-0000-0000-000000000002', NULL, NULL, '2026-08-22T00:00:00.000', '2026-07-03T08:00:00.000', '2026-07-03T08:00:00.000'),
          ('e0000000-0000-0000-0000-000000000004', 'orgless@new.test', 'org_admin', NULL, 'Newco Pending', 'newco', 'starter', NULL, 'token-orgless', 'expired', 'c0000000-0000-0000-0000-000000000002', '2026-07-04T08:30:00.000', NULL, '2026-07-11T00:00:00.000', '2026-07-04T08:00:00.000', '2026-07-04T08:00:00.000'),
          ('e0000000-0000-0000-0000-000000000005', 'revoked@acme.test', 'user', '11111111-1111-1111-1111-111111111111', '=1+1", Inc', 'acme', NULL, '', 'token-revoked', 'revoked', 'c0000000-0000-0000-0000-000000000002', NULL, NULL, '2026-08-01T00:00:00.000', '2026-07-05T08:00:00.000', '2026-07-05T08:00:00.000');
        """;
}

// One [CollectionDefinition] per collection name — shared by every test class in this slice so the
// container is started once.
[CollectionDefinition("PlatformInvitationsRead")]
public sealed class PlatformInvitationsReadCollection : ICollectionFixture<PlatformInvitationsReadFixture>;
