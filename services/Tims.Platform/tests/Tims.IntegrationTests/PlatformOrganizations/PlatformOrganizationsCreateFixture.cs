using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 21 (issue #76) Testcontainers fixture for the platform organization CREATE surface — the
/// seven-table provisioning transaction of <c>createOrganization</c>.
///
/// <para><b>THREE databases on one server, and the second and third are the point.</b>
/// <see cref="ConnectionString"/> has the full shape. <see cref="MissingAuditTableConnectionString"/> is
/// identical EXCEPT that <c>audit_logs</c> does not exist, so the audit INSERT fails deterministically
/// ("relation does not exist") with no error injection, no mocks and no flaky failpoint — which is what
/// makes the FAIL-CLOSED claim provable rather than asserted.
/// <see cref="MissingNotificationsTableConnectionString"/> drops <c>notifications</c> instead, which is what
/// makes the OPPOSITE claim provable: a notify failure propagates as a 500 while everything the transaction
/// wrote stays committed. Without that third database, the recorded divergence from TS on the notify path
/// would be a comment rather than a test.</para>
///
/// <para><b>A SEPARATE fixture from slice 20's, not an extension of it.</b> Slice 20's is tuned in two ways
/// this slice would break: its <c>roles</c> table is deliberately a three-column stub (it exists only so
/// <c>IdentityRepository</c>'s unconditional <c>Include</c> resolves), and its seed carries exactly two
/// platform owners with an explicit warning that a third silently weakens the fan-out count assertion.
/// Slice 21 INSERTS into <c>roles</c>, so it needs the real nine-column table.</para>
///
/// <para><b>RLS is real, with the production predicates, for all seven written tables.</b> <c>app_tenant</c>
/// is NOLOGIN/NOBYPASSRLS; <c>organizations</c> scopes by its OWN id and the other six by
/// <c>organization_id</c>, on both USING and WITH CHECK. That is what lets these tests prove the thing this
/// port could most plausibly have got wrong: that a platform-owner CREATION can run under
/// <see cref="Tims.Infrastructure.TenantScope"/> opened on an organization that does not exist yet. Slice
/// 20's fixture only ever proved it for an UPDATE. <c>plan_modules</c>/<c>modules</c>/<c>plans</c> carry NO
/// RLS, matching production (they are global catalogues), which is why the catalogue read works from inside
/// the new org's scope. <b>It does NOT extend to the notification fan-out</b> — see the comment on
/// <c>NotificationsSql</c> for why that path's BYPASSRLS dependency is a real, recorded coverage gap.</para>
///
/// <para><b>Column defaults are reproduced exactly, including their ABSENCE.</b> Every one of the seven
/// tables has <c>id uuid</c> and <c>updated_at timestamp(3) NOT NULL</c> with NO DB default, because
/// Prisma's <c>@default(uuid())</c>/<c>@updatedAt</c> are client-side. Handing them defaults here would make
/// the fixture pass a port that omits them — the exact constraint the port has to satisfy.</para>
/// </summary>
public sealed class PlatformOrganizationsCreateFixture : IAsyncLifetime
{
    private const string LoginRole = "postgres";
    private const string Password = "postgres";
    private const string Database = "tims_slice21";
    private const string MissingAuditTableDatabase = "tims_slice21_no_audit";
    private const string MissingNotificationsTableDatabase = "tims_slice21_no_notifications";

    /// <summary>The organization the acting platform owner belongs to. Never the create target.</summary>
    public static readonly Guid HomeOrg = Guid.Parse("11111111-1111-1111-1111-111111111111");

    /// <summary>A second pre-existing organization, holding the other owner and the non-owner.</summary>
    public static readonly Guid OtherOrg = Guid.Parse("22222222-2222-2222-2222-222222222222");

    /// <summary>The acting platform owner (in <see cref="HomeOrg"/>). Also one of the two notify targets.</summary>
    public static readonly Guid Actor = Guid.Parse("a1000000-0000-0000-0000-0000000000aa");

    /// <summary>A SECOND platform owner, in a DIFFERENT organization — the fan-out must reach them too.</summary>
    public static readonly Guid OwnerTwo = Guid.Parse("a1000000-0000-0000-0000-0000000000bb");

    /// <summary>A non-owner in <see cref="OtherOrg"/> — must never receive a platform notification.</summary>
    public static readonly Guid NonOwner = Guid.Parse("a1000000-0000-0000-0000-0000000000cc");

    /// <summary>JWT <c>sub</c> of <see cref="Actor"/> — a real platform owner.</summary>
    public const string PlatformOwnerSub = "sub-slice21-platform-owner";

    /// <summary>JWT <c>sub</c> of <see cref="NonOwner"/> — resolvable staff, but not a platform owner.</summary>
    public const string OrgUserSub = "sub-slice21-org-user";

    /// <summary>
    /// The <c>ats-base</c> module codes this fixture seeds into <c>plan_modules</c>, mirroring
    /// <c>ATS_BASE_MODULES</c> in <c>packages/db/prisma/seed-entitlements.ts:22-25</c>. Seven core modules;
    /// the four <c>addon</c>-kind modules are seeded into <c>modules</c> but NOT into the plan, so a port
    /// that grants one would be caught. <b>N = 7 is a SEED fact, not a code fact</b> — production may hold a
    /// different count, and nothing in the port may hardcode it.
    /// </summary>
    public static readonly string[] AtsBaseModules =
        ["vacancies", "candidate_portal", "ai_screening", "compliance_matrix", "assessments", "interviews", "validations"];

    /// <summary>
    /// The per-module <c>plan_modules."limit"</c> this fixture seeds — <c>ai_screening</c> capped at 5000,
    /// every other <c>ats-base</c> module NULL.
    ///
    /// <para><b>The non-NULL entry is the whole point.</b> <c>org-provisioning.ts:53,63</c> selects
    /// <c>limit</c> and copies it onto the granted entitlement, and the codebase really does configure
    /// per-module caps (<c>seed-entitlements.ts:91</c> caps <c>ai_screening</c>). If every seeded row were
    /// NULL, replacing <c>Limit = planModule.Limit</c> with <c>Limit = null</c> in
    /// <c>OrgProvisioningWriter</c> would be INDISTINGUISHABLE — a metering/billing divergence with a fully
    /// green suite. One capped module makes that mutation fail.</para>
    /// </summary>
    public static readonly IReadOnlyDictionary<string, int?> AtsBaseModuleLimits =
        new Dictionary<string, int?>(StringComparer.Ordinal)
        {
            ["vacancies"] = null,
            ["candidate_portal"] = null,
            ["ai_screening"] = 5000,
            ["compliance_matrix"] = null,
            ["assessments"] = null,
            ["interviews"] = null,
            ["validations"] = null,
        };

    /// <summary>The <c>addon</c>-kind modules, seeded into the catalogue but never into <c>ats-base</c>.</summary>
    public static readonly string[] AddonModules =
        ["ai_voice_interview", "video_interviews", "proctoring", "custom_reports"];

    /// <summary>
    /// A SECOND plan in the catalogue, holding exactly one module that <c>ats-base</c> does not.
    ///
    /// <para><b>It exists so the <c>plan_code = 'ats-base'</c> filter is falsifiable.</b> With only one plan
    /// seeded, deleting <c>.Where(pm =&gt; pm.PlanCode == BasePlanCode)</c> from
    /// <c>OrgProvisioningWriter.ProvisionEntitlementsAsync</c> returns the identical seven rows and every
    /// test stays green — while in production it would grant every plan's modules to every new org, which is
    /// precisely what the <c>plans</c>/<c>plan_modules</c> catalogue exists to prevent. The complementary
    /// mutation (changing the BasePlanCode VALUE) was already caught, which is what makes this gap easy to
    /// mistake for covered.</para>
    /// </summary>
    public const string OtherPlanCode = "growth";

    /// <summary>The one module reachable ONLY via <see cref="OtherPlanCode"/>. Must never be granted.</summary>
    public const string OtherPlanOnlyModule = "custom_reports";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername(LoginRole)
        .WithPassword(Password)
        .WithDatabase(Database)
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    /// <summary>Same schema minus <c>audit_logs</c> — every audit INSERT fails here, deterministically.</summary>
    public string MissingAuditTableConnectionString { get; private set; } = string.Empty;

    /// <summary>Same schema minus <c>notifications</c> — every fan-out fails here, deterministically.</summary>
    public string MissingNotificationsTableConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        MissingAuditTableConnectionString =
            new NpgsqlConnectionStringBuilder(ConnectionString) { Database = MissingAuditTableDatabase }.ConnectionString;
        MissingNotificationsTableConnectionString =
            new NpgsqlConnectionStringBuilder(ConnectionString) { Database = MissingNotificationsTableDatabase }.ConnectionString;

        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();

            // Role membership is cluster-global, so app_tenant is visible in ALL THREE databases.
            await ExecuteAsync(connection, "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;");
            await ApplyFullSchemaAsync(connection);
            await ExecuteAsync(connection, AuditLogsSql);
            await ExecuteAsync(connection, NotificationsSql);
            await ExecuteAsync(connection, SeedSql);

            // CREATE DATABASE cannot run inside a transaction block — a plain autocommit command is fine.
            await ExecuteAsync(connection, $"CREATE DATABASE {MissingAuditTableDatabase}");
            await ExecuteAsync(connection, $"CREATE DATABASE {MissingNotificationsTableDatabase}");
        }

        await using (var missingAudit = new NpgsqlConnection(MissingAuditTableConnectionString))
        {
            await missingAudit.OpenAsync();
            // Everything EXCEPT audit_logs. All seven write tables must exist and be grantable, otherwise
            // the create would fail for the wrong reason and the mutation proof would pass vacuously.
            await ApplyFullSchemaAsync(missingAudit);
            await ExecuteAsync(missingAudit, NotificationsSql);
            await ExecuteAsync(missingAudit, SeedSql);
        }

        await using (var missingNotifications = new NpgsqlConnection(MissingNotificationsTableConnectionString))
        {
            await missingNotifications.OpenAsync();
            // Everything EXCEPT notifications — the create transaction itself must fully succeed here, which
            // is precisely what R11 asserts survives the fan-out failure.
            await ApplyFullSchemaAsync(missingNotifications);
            await ExecuteAsync(missingNotifications, AuditLogsSql);
            await ExecuteAsync(missingNotifications, SeedSql);
        }
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    /// <summary>
    /// A create context on the SAME EnableUnmappedTypes data source Program.cs wires — not a plain
    /// connection string. Load-bearing, not incidental: <c>organizations.plan</c> is a native Postgres enum
    /// and EFCore.PG cannot materialise it into a C# string without it, so a fixture that used a plain
    /// connection string would pass only if the port stopped reading the created row back.
    /// </summary>
    public PlatformOrganizationsCreateDbContext NewContext(string connectionString) =>
        new(new DbContextOptionsBuilder<PlatformOrganizationsCreateDbContext>()
            .UseNpgsql(PlatformOrganizationsDataSource.Build(connectionString))
            .Options);

    // ── superuser read-backs (bypassing RLS) ─────────────────────────────────────────────────────

    public async Task<OrgSnapshot?> ReadOrganizationAsync(Guid id, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT name, slug, plan::text, settings::text, billing_email, is_active, domain, logo,
                   created_at, updated_at, deleted_at
            FROM organizations WHERE id = @id
            """;
        command.Parameters.AddWithValue("id", id);

        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new OrgSnapshot(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetBoolean(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.IsDBNull(7) ? null : reader.GetString(7),
            reader.GetDateTime(8),
            reader.GetDateTime(9),
            reader.IsDBNull(10) ? null : reader.GetDateTime(10));
    }

    public async Task<IReadOnlyList<CompanyRow>> ReadCompaniesAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT id, organization_id, name, country, currency, timezone, language, is_active, updated_at
            FROM companies WHERE organization_id = @org ORDER BY name
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<CompanyRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new CompanyRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), reader.GetString(5), reader.GetString(6), reader.GetBoolean(7),
                reader.GetDateTime(8)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<BusinessUnitRow>> ReadBusinessUnitsAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT id, organization_id, company_id, name, is_active, updated_at
            FROM business_units WHERE organization_id = @org ORDER BY name
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<BusinessUnitRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new BusinessUnitRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
                reader.GetBoolean(4), reader.GetDateTime(5)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<TeamRow>> ReadTeamsAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT id, organization_id, business_unit_id, name, is_active, updated_at
            FROM teams WHERE organization_id = @org ORDER BY name
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<TeamRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new TeamRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
                reader.GetBoolean(4), reader.GetDateTime(5)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<RoleRow>> ReadRolesAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT name, slug, description, is_system, is_active, updated_at
            FROM roles WHERE organization_id = @org ORDER BY slug
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<RoleRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new RoleRow(
                reader.GetString(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetBoolean(3), reader.GetBoolean(4), reader.GetDateTime(5)));
        }

        return rows;
    }

    public async Task<SubscriptionRow?> ReadSubscriptionAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT plan::text, status::text, trial_ends_at, stripe_customer_id, stripe_subscription_id,
                   current_period_start, current_period_end, updated_at
            FROM subscriptions WHERE organization_id = @org
            """;
        command.Parameters.AddWithValue("org", organizationId);

        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new SubscriptionRow(
            reader.GetString(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetDateTime(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetDateTime(5),
            reader.IsDBNull(6) ? null : reader.GetDateTime(6),
            reader.GetDateTime(7));
    }

    public async Task<IReadOnlyList<EntitlementRow>> ReadEntitlementsAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        // "limit" is a reserved word in Postgres and MUST stay quoted.
        command.CommandText =
            """
            SELECT module_code, enabled, source, "limit", unit_price, activated_at, updated_at
            FROM org_entitlements WHERE organization_id = @org ORDER BY module_code
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<EntitlementRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new EntitlementRow(
                reader.GetString(0),
                reader.GetBoolean(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetDouble(4),
                reader.GetDateTime(5),
                reader.GetDateTime(6)));
        }

        return rows;
    }

    /// <summary>Every audit row for an organization, superuser-read, newest last.</summary>
    public async Task<IReadOnlyList<AuditRow>> ReadAuditRowsAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        // jsonb_typeof is asserted, not just the text: the TS writes a jsonb STRING scalar (Prisma `Json?`
        // handed a JSON.stringify result), and a port that wrote an OBJECT would round-trip to a
        // similar-looking value with re-ordered, re-spaced keys.
        command.CommandText =
            """
            SELECT action, entity, entity_id, actor_id, jsonb_typeof(changes), changes #>> '{}'
            FROM audit_logs WHERE organization_id = @org ORDER BY created_at, action
            """;
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<AuditRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new AuditRow(
                reader.GetString(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetGuid(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<NotificationRow>> ReadNotificationsAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT user_id, type, title, module, action_url FROM notifications WHERE organization_id = @org ORDER BY user_id";
        command.Parameters.AddWithValue("org", organizationId);

        var rows = new List<NotificationRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new NotificationRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4)));
        }

        return rows;
    }

    /// <summary>
    /// Row counts for all SEVEN tables the creation transaction writes, in one snapshot. The fail-closed
    /// mutation proof compares this against all-zero: asserting only that <c>organizations</c> is empty
    /// would stay green on a partial commit, which is exactly the failure the guard exists to prevent.
    /// </summary>
    public async Task<ProvisionedCounts> CountAllProvisionedRowsAsync(Guid organizationId, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT (SELECT count(*) FROM organizations WHERE id = @org),
                   (SELECT count(*) FROM companies WHERE organization_id = @org),
                   (SELECT count(*) FROM business_units WHERE organization_id = @org),
                   (SELECT count(*) FROM teams WHERE organization_id = @org),
                   (SELECT count(*) FROM roles WHERE organization_id = @org),
                   (SELECT count(*) FROM subscriptions WHERE organization_id = @org),
                   (SELECT count(*) FROM org_entitlements WHERE organization_id = @org)
            """;
        command.Parameters.AddWithValue("org", organizationId);

        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        return new ProvisionedCounts(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3),
            reader.GetInt64(4), reader.GetInt64(5), reader.GetInt64(6));
    }

    /// <summary>
    /// The same seven counts, GLOBAL rather than per-organization.
    ///
    /// <para>Required wherever the organization id is never observed by the test — the duplicate-slug path
    /// and the fail-closed path both generate an id inside the repository and then discard it. A per-org
    /// count would be trivially zero there and the assertion would be vacuous; a global before/after
    /// comparison is what actually proves nothing was left behind.</para>
    /// </summary>
    public async Task<ProvisionedCounts> CountAllRowsAsync(string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT (SELECT count(*) FROM organizations),
                   (SELECT count(*) FROM companies),
                   (SELECT count(*) FROM business_units),
                   (SELECT count(*) FROM teams),
                   (SELECT count(*) FROM roles),
                   (SELECT count(*) FROM subscriptions),
                   (SELECT count(*) FROM org_entitlements)
            """;

        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        return new ProvisionedCounts(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3),
            reader.GetInt64(4), reader.GetInt64(5), reader.GetInt64(6));
    }

    /// <summary>
    /// <c>audit_logs</c> rows carrying a given <c>action</c>, across every organization.
    ///
    /// <para>Filtered by action rather than counting the whole table on purpose: a 401/403 through the real
    /// HTTP pipeline legitimately lands an <c>authz_denied</c> row from
    /// <c>SecurityDenialAuditMiddleware</c>, so a bare total would make "the gate wrote nothing" assertions
    /// fail for a reason that is the middleware working correctly.</para>
    /// </summary>
    public async Task<long> CountAuditRowsAsync(string action, string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM audit_logs WHERE action = @action";
        command.Parameters.AddWithValue("action", action);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    /// <summary><c>role_permissions</c> rows, globally. The create path must never write one.</summary>
    public async Task<long> CountRolePermissionsAsync(string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM role_permissions";
        return (long)(await command.ExecuteScalarAsync())!;
    }

    /// <summary>Removes every <c>plan_modules</c> row, so the entitlement grant sees an empty catalogue.</summary>
    public async Task ClearPlanModulesAsync(string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await ExecuteAsync(connection, "DELETE FROM plan_modules");
    }

    /// <summary>
    /// Drops <c>plan_modules_plan_code_module_code_key</c> and inserts a SECOND <c>ats-base</c> row for a
    /// module that already has one, so the entitlement grant tries to write two <c>org_entitlements</c> rows
    /// with the same <c>(organization_id, module_code)</c>.
    ///
    /// <para><b>The only way to reach a NON-slug unique violation from inside the create transaction.</b>
    /// <c>IsSlugConflict</c> matches <c>organizations_slug_key</c> BY NAME and every other unique violation
    /// is required to propagate; without this the discriminating half of that guard has no test, and
    /// simplifying it to a bare <c>SqlState: UniqueViolation</c> check would keep the whole suite green
    /// while reporting "slug_taken" to an operator whose slug is fine.</para>
    /// </summary>
    public async Task IntroduceDuplicateAtsBaseModuleAsync(string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await ExecuteAsync(
            connection,
            """
            ALTER TABLE plan_modules DROP CONSTRAINT IF EXISTS plan_modules_plan_code_module_code_key;
            INSERT INTO plan_modules (id, plan_code, module_code, "limit")
            VALUES (gen_random_uuid(), 'ats-base', 'vacancies', NULL);
            """);
    }

    /// <summary>
    /// Restores the catalogue to its seeded state from ANY of the mutations above — cleared, duplicated, or
    /// both. Deliberately unconditional (delete → re-add the constraint → re-seed) rather than an inverse of
    /// whichever helper ran, so a test that mutates twice, or fails between the two, still leaves a clean
    /// catalogue for the rest of the serialized collection.
    /// </summary>
    public async Task RestorePlanModulesAsync(string? connectionString = null)
    {
        await using var connection = await OpenAsync(connectionString);
        await ExecuteAsync(
            connection,
            """
            DELETE FROM plan_modules;
            ALTER TABLE plan_modules DROP CONSTRAINT IF EXISTS plan_modules_plan_code_module_code_key;
            ALTER TABLE plan_modules ADD CONSTRAINT plan_modules_plan_code_module_code_key
                UNIQUE (plan_code, module_code);
            """);
        await ExecuteAsync(connection, PlanModulesSeedSql);
    }

    private async Task<NpgsqlConnection> OpenAsync(string? connectionString)
    {
        var connection = new NpgsqlConnection(connectionString ?? ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    private static async Task ApplyFullSchemaAsync(NpgsqlConnection connection)
    {
        await ExecuteAsync(connection, BaseSchemaSql);
        await ExecuteAsync(connection, ProvisioningSchemaSql);
        await ExecuteAsync(connection, GrantsAndRlsSql);
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    // `organizations` mirrors the Prisma model, including the native OrgPlan enum and the settings jsonb
    // default. SubscriptionStatus is NEW to this domain's fixtures — no slice-19/20 fixture creates it,
    // and the create path is the first thing in this service to write that column.
    private const string BaseSchemaSql =
        """
        CREATE TYPE "OrgPlan" AS ENUM ('trial', 'starter', 'professional', 'enterprise');
        CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            slug text NOT NULL,
            domain text NULL,
            logo text NULL,
            plan "OrgPlan" NOT NULL DEFAULT 'trial',
            settings jsonb NOT NULL DEFAULT '{}',
            billing_email text NULL,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL,
            deleted_at timestamp(3) NULL,
            -- The constraint NAME is load-bearing: PlatformOrganizationsCreateRepository.IsSlugConflict
            -- matches on ConstraintName, so a differently-named constraint would make the 409 test pass
            -- vacuously or fail for the wrong reason. These are the production names.
            CONSTRAINT organizations_slug_key UNIQUE (slug),
            CONSTRAINT organizations_domain_key UNIQUE (domain)
        );

        -- Mirrors the identity columns PrincipalResolver reads, so the endpoint tests can drive the REAL
        -- HTTP pipeline. organization_id is NULLABLE because a platform owner may be org-less in prod.
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NULL REFERENCES organizations (id) ON DELETE CASCADE,
            supabase_user_id text NOT NULL UNIQUE,
            email text NOT NULL,
            first_name text NULL,
            last_name text NULL,
            avatar text NULL,
            is_platform_owner boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true
        );

        -- FULL WIDTH, unlike slice 20's three-column stub: this slice INSERTS into it, so every NOT NULL
        -- column without a default is a constraint the port has to satisfy. `updated_at` in particular has
        -- NO DB default (Prisma's @updatedAt is client-side).
        CREATE TABLE roles (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            name text NOT NULL,
            slug text NOT NULL,
            description text NULL,
            is_system boolean NOT NULL DEFAULT false,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL,
            CONSTRAINT roles_organization_id_slug_key UNIQUE (organization_id, slug)
        );

        -- Schema-only, like slice 20's: PlatformOwnerGate checks PrincipalType and never a role grant, but
        -- IdentityRepository.FindBySupabaseUserIdAsync unconditionally Includes UserRoles -> Role on every
        -- staff lookup, so without this table the resolve 500s before the gate is ever reached.
        CREATE TABLE user_roles (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users (id),
            role_id uuid NOT NULL REFERENCES roles (id)
        );

        -- Schema-only, and it exists for ONE assertion. The TS creates a "Super Administrador" role with no
        -- permissions and no members; three comments in this slice say so. Without this table the
        -- role_permissions half of that claim is untestable BY CONSTRUCTION, so a future "improvement" that
        -- grants the role a permission — the most natural edit anyone will ever make to this code, since the
        -- role as written is useless — would diverge from TS with the whole suite green.
        CREATE TABLE role_permissions (
            id uuid PRIMARY KEY,
            role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
            permission_id uuid NOT NULL
        );
        """;

    private const string ProvisioningSchemaSql =
        """
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

        -- DELIBERATELY NO FOREIGN KEY on organization_id. Verified against the prod baseline: the only FKs
        -- on this table are business_units_company_id_fkey and business_units_parent_id_fkey. The column is
        -- unenforced by any constraint and is the ENTIRE basis of the tenant_isolation predicate below —
        -- inventing an FK here would hide exactly the hazard the RLS negative control tests for.
        CREATE TABLE business_units (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
            name text NOT NULL,
            code text NULL,
            parent_id uuid NULL REFERENCES business_units (id),
            settings jsonb NOT NULL DEFAULT '{}',
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        -- Same no-FK-on-organization_id hazard as business_units.
        CREATE TABLE teams (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL,
            business_unit_id uuid NOT NULL REFERENCES business_units (id) ON DELETE CASCADE,
            name text NOT NULL,
            leader_id uuid NULL REFERENCES users (id),
            settings jsonb NOT NULL DEFAULT '{}',
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        CREATE TABLE subscriptions (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
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
            updated_at timestamp(3) NOT NULL,
            CONSTRAINT subscriptions_organization_id_key UNIQUE (organization_id),
            CONSTRAINT subscriptions_stripe_customer_id_key UNIQUE (stripe_customer_id),
            CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id)
        );

        CREATE TABLE modules (
            code text PRIMARY KEY,
            name text NOT NULL,
            description text NULL,
            kind text NOT NULL,
            metered boolean NOT NULL DEFAULT false,
            unit text NULL,
            default_unit_price double precision NULL,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        CREATE TABLE plans (
            code text PRIMARY KEY,
            name text NOT NULL,
            description text NULL,
            active boolean NOT NULL DEFAULT true,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL
        );

        CREATE TABLE plan_modules (
            id uuid PRIMARY KEY,
            plan_code text NOT NULL REFERENCES plans (code) ON DELETE CASCADE,
            module_code text NOT NULL REFERENCES modules (code) ON DELETE CASCADE,
            "limit" integer NULL,
            CONSTRAINT plan_modules_plan_code_module_code_key UNIQUE (plan_code, module_code)
        );

        CREATE TABLE org_entitlements (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
            module_code text NOT NULL REFERENCES modules (code) ON DELETE CASCADE,
            enabled boolean NOT NULL DEFAULT true,
            source text NOT NULL,
            "limit" integer NULL,
            unit_price double precision NULL,
            activated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) NOT NULL,
            CONSTRAINT org_entitlements_organization_id_module_code_key UNIQUE (organization_id, module_code)
        );
        """;

    // MIGRATION-DECLARED RLS predicates — NOT re-verified against live production. Every citation below is
    // to a repo migration file and every one is exact; what is NOT established is that live prod still
    // matches them. This repo carries a standing finding that live RLS diverged from the repo migrations on
    // 67 production tables (project_rls_fail_open_67_tables_2026-08-02), so "the migration says X" and
    // "production enforces X" must not be conflated here. If any of these seven live policies differs — an
    // added `OR is_platform_owner` escape, a missing FORCE — the R9 proof holds against this fixture and
    // not against prod. Probing prod is the only thing that would close that, and it has not been done for
    // this slice.
    //   organizations                      20260604100000_enable_rls_tenant_isolation/migration.sql:316-320 (own id)
    //   companies                          :119-122
    //   business_units                     :87-90
    //   teams                              :295-298
    //   roles                              :255-258
    //   subscriptions                      :275-278
    //   org_entitlements                   20260708000000_add_entitlements/migration.sql:76-79
    //   modules / plans / plan_modules     NO RLS — global catalogues, explicitly exempt (:75). Reproduced,
    //                                      and that is why the catalogue read works from inside the new
    //                                      org's TenantScope.
    private const string GrantsAndRlsSql =
        """
        GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, companies, business_units, teams, roles,
            subscriptions, org_entitlements TO app_tenant;
        GRANT SELECT ON plan_modules, modules, plans, users TO app_tenant;

        ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON organizations
            USING (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
        ALTER TABLE companies FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON companies
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;
        ALTER TABLE business_units FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON business_units
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
        ALTER TABLE teams FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON teams
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
        ALTER TABLE roles FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON roles
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON subscriptions
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

        ALTER TABLE org_entitlements ENABLE ROW LEVEL SECURITY;
        ALTER TABLE org_entitlements FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON org_entitlements
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    private const string AuditLogsSql =
        """
        CREATE TABLE audit_logs (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
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

        -- Append-only at the GRANT level: no UPDATE/DELETE for app_tenant. NOT the full CB-1b control —
        -- AuditWriterFixture also applies AuditImmutability.BuildAppendOnlySql's insert-only TRIGGER, which
        -- this fixture does not. Harmless for an INSERT-only writer, but do not read this as CB-1b fidelity.
        GRANT SELECT, INSERT ON audit_logs TO app_tenant;

        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON audit_logs
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;

    // notifications (and `users` above) carry no RLS here, and that is a REAL COVERAGE GAP inherited from
    // slice 20, not a simplification. Production has FORCE RLS + a tenant_isolation policy on both. The
    // fan-out is unscoped on both stacks, so it works in prod only because the connecting role is BYPASSRLS
    // — and because this fixture's login role is a superuser, the notify tests pass identically whether or
    // not that dependency holds. Adding the policies here would NOT close the gap (a superuser bypasses them
    // too); closing it needs a NOBYPASSRLS login role for this one call. Recorded rather than papered over.
    private const string NotificationsSql =
        """
        CREATE TABLE notifications (
            id uuid PRIMARY KEY,
            organization_id uuid NULL,
            user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
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
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """;

    /// <summary>
    /// The seven <c>ats-base</c> plan modules, mirroring <c>ATS_BASE_MODULES</c>. Split out so
    /// <see cref="ClearPlanModulesAsync"/>/<see cref="RestorePlanModulesAsync"/> can drive the fail-OPEN
    /// zero-entitlement case (<c>org-provisioning.ts</c> commits an org with no entitlements when the
    /// catalogue is empty) without rebuilding the container.
    /// </summary>
    private const string PlanModulesSeedSql =
        """
        INSERT INTO plan_modules (id, plan_code, module_code, "limit") VALUES
            (gen_random_uuid(), 'ats-base', 'vacancies', NULL),
            (gen_random_uuid(), 'ats-base', 'candidate_portal', NULL),
            (gen_random_uuid(), 'ats-base', 'ai_screening', 5000),
            (gen_random_uuid(), 'ats-base', 'compliance_matrix', NULL),
            (gen_random_uuid(), 'ats-base', 'assessments', NULL),
            (gen_random_uuid(), 'ats-base', 'interviews', NULL),
            (gen_random_uuid(), 'ats-base', 'validations', NULL),
            (gen_random_uuid(), 'growth', 'custom_reports', 25)
        ON CONFLICT (plan_code, module_code) DO NOTHING;
        """;

    private const string SeedSql =
        """
        INSERT INTO organizations (id, name, slug, plan, settings, is_active, updated_at) VALUES
            ('11111111-1111-1111-1111-111111111111', 'Acme', 'acme', 'trial', '{}', true, CURRENT_TIMESTAMP),
            ('22222222-2222-2222-2222-222222222222', 'Beta', 'beta', 'starter', '{}', true, CURRENT_TIMESTAMP);

        -- EXACTLY TWO platform owners. The notification fan-out test asserts that count, so adding a third
        -- here (e.g. an org-less owner purely for the auth tests) would silently weaken it.
        INSERT INTO users (id, organization_id, supabase_user_id, email, is_platform_owner, is_active) VALUES
            ('a1000000-0000-0000-0000-0000000000aa', '11111111-1111-1111-1111-111111111111', 'sub-slice21-platform-owner', 'owner@tims.test', true, true),
            ('a1000000-0000-0000-0000-0000000000bb', '22222222-2222-2222-2222-222222222222', 'sub-slice21-owner-two', 'owner2@tims.test', true, true),
            ('a1000000-0000-0000-0000-0000000000cc', '22222222-2222-2222-2222-222222222222', 'sub-slice21-org-user', 'orguser@tims.test', false, true);

        -- The full 11-module catalogue from seed-entitlements.ts:5-16, INCLUDING the four addon-kind modules
        -- that ats-base must never grant. Seeding only the seven would make the "no addon was granted"
        -- assertion vacuous.
        INSERT INTO modules (code, name, kind, metered, unit, default_unit_price, updated_at) VALUES
            ('vacancies', 'Vacantes', 'core', false, NULL, NULL, CURRENT_TIMESTAMP),
            ('candidate_portal', 'Portal del candidato', 'core', false, NULL, NULL, CURRENT_TIMESTAMP),
            ('ai_screening', 'Filtro IA documental', 'core', true, 'screenings', 0.5, CURRENT_TIMESTAMP),
            ('compliance_matrix', 'Matriz de cumplimiento', 'core', false, NULL, NULL, CURRENT_TIMESTAMP),
            ('assessments', 'Evaluaciones TIMS', 'core', false, NULL, NULL, CURRENT_TIMESTAMP),
            ('interviews', 'Entrevistas', 'core', false, NULL, NULL, CURRENT_TIMESTAMP),
            ('validations', 'Validaciones', 'core', false, NULL, NULL, CURRENT_TIMESTAMP),
            ('ai_voice_interview', 'Entrevista por voz IA', 'addon', true, 'minutes', 0.15, CURRENT_TIMESTAMP),
            ('video_interviews', 'Videollamadas', 'addon', true, 'minutes', 0.02, CURRENT_TIMESTAMP),
            ('proctoring', 'Proctoring', 'addon', true, 'exams', 10, CURRENT_TIMESTAMP),
            ('custom_reports', 'Reportes personalizados', 'addon', false, NULL, NULL, CURRENT_TIMESTAMP);

        -- TWO plans, not one. `growth` is not a production plan — it exists so the writer's
        -- `plan_code = 'ats-base'` filter is falsifiable (see OtherPlanCode). With a single seeded plan the
        -- filtered and unfiltered queries return the identical set.
        INSERT INTO plans (code, name, description, updated_at) VALUES
            ('ats-base', 'ATS Base', 'Licencia base del ATS', CURRENT_TIMESTAMP),
            ('growth', 'Growth', 'FIXTURE-ONLY control plan — never granted by createOrganization', CURRENT_TIMESTAMP);

        -- ai_screening carries a NON-NULL limit so `Limit = planModule.Limit` is falsifiable, and
        -- custom_reports sits ONLY under `growth` so the plan filter is falsifiable. See
        -- AtsBaseModuleLimits / OtherPlanOnlyModule for why each matters.
        INSERT INTO plan_modules (id, plan_code, module_code, "limit") VALUES
            (gen_random_uuid(), 'ats-base', 'vacancies', NULL),
            (gen_random_uuid(), 'ats-base', 'candidate_portal', NULL),
            (gen_random_uuid(), 'ats-base', 'ai_screening', 5000),
            (gen_random_uuid(), 'ats-base', 'compliance_matrix', NULL),
            (gen_random_uuid(), 'ats-base', 'assessments', NULL),
            (gen_random_uuid(), 'ats-base', 'interviews', NULL),
            (gen_random_uuid(), 'ats-base', 'validations', NULL),
            (gen_random_uuid(), 'growth', 'custom_reports', 25);
        """;

    public sealed record OrgSnapshot(
        string Name,
        string Slug,
        string Plan,
        string Settings,
        string? BillingEmail,
        bool IsActive,
        string? Domain,
        string? Logo,
        DateTime CreatedAt,
        DateTime UpdatedAt,
        DateTime? DeletedAt);

    public sealed record CompanyRow(
        Guid Id, Guid OrganizationId, string Name, string Country, string Currency, string Timezone,
        string Language, bool IsActive, DateTime UpdatedAt);

    public sealed record BusinessUnitRow(
        Guid Id, Guid OrganizationId, Guid CompanyId, string Name, bool IsActive, DateTime UpdatedAt);

    public sealed record TeamRow(
        Guid Id, Guid OrganizationId, Guid BusinessUnitId, string Name, bool IsActive, DateTime UpdatedAt);

    public sealed record RoleRow(
        string Name, string Slug, string? Description, bool IsSystem, bool IsActive, DateTime UpdatedAt);

    public sealed record SubscriptionRow(
        string Plan, string Status, DateTime? TrialEndsAt, string? StripeCustomerId, string? StripeSubscriptionId,
        DateTime? CurrentPeriodStart, DateTime? CurrentPeriodEnd, DateTime UpdatedAt);

    public sealed record EntitlementRow(
        string ModuleCode, bool Enabled, string Source, int? Limit, double? UnitPrice, DateTime ActivatedAt, DateTime UpdatedAt);

    public sealed record AuditRow(string Action, string Entity, string? EntityId, Guid? ActorId, string? ChangesType, string? ChangesText);

    public sealed record NotificationRow(Guid UserId, string Type, string Title, string? Module, string? ActionUrl);

    public sealed record ProvisionedCounts(
        long Organizations, long Companies, long BusinessUnits, long Teams, long Roles, long Subscriptions, long Entitlements)
    {
        public static ProvisionedCounts Empty { get; } = new(0, 0, 0, 0, 0, 0, 0);
    }
}
