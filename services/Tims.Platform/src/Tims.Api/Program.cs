using System.Diagnostics;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog;
using Serilog.Formatting.Compact;
using StackExchange.Redis;
using Tims.Api.AccessReview;
using Tims.Api.Fx;
using Tims.Api.AlertMetrics;
using Tims.Api.Audit;
using Tims.Api.Authentication;
using Tims.Api.Billing;
using Tims.Api.Compensation;
using Tims.Api.Configuration;
using Tims.Api.HealthChecks;
using Tims.Api.Http;
using Tims.Api.RateLimiting;
using Tims.Api.Evaluation360;
using Tims.Api.ExternalVendor;
using Tims.Api.Engagement;
using Tims.Api.Dei;
using Tims.Api.NineBox;
using Tims.Api.Reporting;
using Tims.Api.Succession;
using Tims.Api.Monitoring;
using Tims.Api.PlatformDashboard;
using Tims.Api.PlatformInvitations;
using Tims.Api.PlatformOrganizations;
using Tims.Api.TeamIntel;
using Tims.Api.Validation;
using Tims.Application.Access;
using Tims.Application.AlertMetrics;
using Tims.Application.AccessReview;
using Tims.Application.Audit;
using Tims.Application.Billing;
using Tims.Application.Compensation;
using Tims.Application.Evaluation360;
using Tims.Application.ExternalVendor;
using Tims.Application.Identity;
using Tims.Application.Engagement;
using Tims.Application.Dei;
using Tims.Application.Fx;
using Tims.Application.NineBox;
using Tims.Application.Reporting;
using Tims.Application.Succession;
using Tims.Application.Monitoring;
using Tims.Application.PlatformDashboard;
using Tims.Application.PlatformInvitations;
using Tims.Application.PlatformOrganizations;
using Tims.Application.TeamIntel;
using Tims.Application.Validation;
using Tims.Domain.Access;
using Tims.Domain.Billing;
using Tims.Domain.Identity;
using Tims.Infrastructure.Access;
using Tims.Infrastructure.AlertMetrics;
using Tims.Infrastructure.AccessReview;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.Billing;
using Tims.Infrastructure.Compensation;
using Tims.Infrastructure.Evaluation360;
using Tims.Infrastructure.ExternalVendor;
using Tims.Infrastructure.Hris;
using Tims.Infrastructure.Engagement;
using Tims.Infrastructure.Dei;
using Tims.Infrastructure.Fx;
using Tims.Infrastructure.NineBox;
using Tims.Infrastructure.Identity;
using Tims.Infrastructure.RateLimiting;
using Tims.Infrastructure.Reporting;
using Tims.Infrastructure.Succession;
using Tims.Infrastructure.Monitoring;
using Tims.Infrastructure.PlatformDashboard;
using Tims.Infrastructure.PlatformInvitations;
using Tims.Infrastructure.PlatformOrganizations;
using Tims.Infrastructure.TeamIntel;
using Tims.Infrastructure.Validation;

// Two-stage Serilog init: a bootstrap logger captures failures during host build
// (including config-validation failures), then the full logger is swapped in.
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // --- Structured JSON logging (Pino-parity), request/tenant correlation ids -------
    // NEVER logs request bodies / tokens / PII (rule: api-security.md §Observability).
    // preserveStaticLogger: true keeps each host's fully-configured Serilog instance INDEPENDENT of the
    // shared static bootstrap `Log.Logger` (which stays the console bootstrap logger — used only by the
    // startup Log.Fatal / CloseAndFlush below, never at runtime; the DI ILogger + request logging use this
    // configured instance). Without it, every in-process host FREEZES the one static ReloadableLogger, so
    // booting several WebApplicationFactory<Program> hosts concurrently throws "logger is already frozen".
    builder.Host.UseSerilog(
        (context, services, configuration) => configuration
            .ReadFrom.Configuration(context.Configuration)
            .ReadFrom.Services(services)
            .WriteTo.Console(new RenderedCompactJsonFormatter()),
        preserveStaticLogger: true);

    // --- Config: bind + validate at startup (fail-fast), the Zod-env-gate analog ------
    builder.Services
        .AddOptions<PlatformOptions>()
        .Bind(builder.Configuration.GetSection(PlatformOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();

    // Read the two bootstrap values raw (before Build()): OTel resource + exporter must be
    // wired at registration time, so they can't come from the validated IOptions<PlatformOptions>
    // yet. ValidateOnStart above still guards the runtime-critical values (e.g. DB conn string).
    var platformSection = builder.Configuration.GetSection(PlatformOptions.SectionName);
    var serviceName = platformSection[nameof(PlatformOptions.ServiceName)] ?? "tims-platform";
    var otlpEndpoint = platformSection[nameof(PlatformOptions.OtlpEndpoint)];

    // --- OpenTelemetry: traces on HTTP requests + Npgsql DB commands ------------------
    builder.Services.AddOpenTelemetry()
        .ConfigureResource(resource => resource.AddService(serviceName))
        .WithTracing(tracing =>
        {
            tracing.AddAspNetCoreInstrumentation();
            tracing.AddSource("Npgsql"); // Npgsql's built-in ActivitySource → DB command spans
            if (!string.IsNullOrWhiteSpace(otlpEndpoint))
            {
                tracing.AddOtlpExporter(exporter => exporter.Endpoint = new Uri(otlpEndpoint));
            }
        });

    // --- Health / readiness -----------------------------------------------------------
    builder.Services.AddHealthChecks()
        .AddCheck<DatabaseHealthCheck>("postgres", tags: ["ready"])
        .AddCheck<RedisHealthCheck>("redis", tags: ["ready"]);

    // --- Supabase JWT authentication (WP2.1) ------------------------------------------
    // Validates issuer, audience, lifetime, AND signing key (JWKS) — never skips exp/iss/aud
    // (banned-pattern list). Fail-closed: an unset issuer/JWKS rejects every token.
    var jwtIssuer = platformSection[nameof(PlatformOptions.SupabaseJwtIssuer)];
    var jwtAudience = platformSection[nameof(PlatformOptions.SupabaseJwtAudience)] ?? "authenticated";
    var jwksMetadataAddress = platformSection[nameof(PlatformOptions.SupabaseJwksMetadataAddress)];

    // --- Identity plane data sources (WP2.2 staff / WP2.3 external API keys) -----------
    // READ-ONLY EF context over the Prisma-OWNED identity tables on the PRIVILEGED (pre-tenant)
    // connection — never through TenantScope/RLS. The connection string is read raw here (same as
    // the JWT bootstrap values); AddDbContext is lazy, so a placeholder value never blocks startup.
    var databaseConnectionString = platformSection[nameof(PlatformOptions.DatabaseConnectionString)];
    builder.Services.AddDbContext<IdentityDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IApiKeyRepository, ApiKeyRepository>();
    builder.Services.AddScoped<ApiKeyResolver>();

    // --- Principal resolution + permission enforcement (WP2.2/WP2.5) -------------------
    // Wires PrincipalResolver into the live request path (deferred Slice-2 wiring) and the
    // WP2.5 authz kernel: resolve the JWT `sub` → TenantContext, fetch its grants read-only,
    // run AccessKernel.Decide. The permission cache defaults to the fail-soft null impl (no
    // Redis needed); a Redis-backed cache is a config-gated swap for this one registration.
    builder.Services.AddScoped<IIdentityRepository, IdentityRepository>();
    // Candidate resolution (4th principal type): a portal Supabase session with NO staff User row
    // resolves to PrincipalType.Candidate by email within a request-supplied org. Read-only over the
    // Prisma-OWNED `candidates` table via IdentityDbContext. PrincipalResolver picks up CandidateResolver
    // as an optional dependency to run staff-first / candidate-fallback (never an email-join to staff).
    builder.Services.AddScoped<ICandidateRepository, CandidateRepository>();
    builder.Services.AddScoped<CandidateResolver>();
    builder.Services.AddScoped<PrincipalResolver>();
    builder.Services.AddScoped<IPermissionGrantRepository, PermissionGrantRepository>();
    builder.Services.AddScoped<PermissionService>();
    builder.Services.AddSingleton<IPermissionCache, NullPermissionCache>();

    // --- Scoped IDOR machinery (WP2.5b): anchor loaders + AssertScoped probe -----------
    // AnchorDbContext runs UNDER TenantScope (SET LOCAL ROLE app_tenant + org GUC) on the SAME DB
    // connection, but the tenant/RLS-scoped path — NOT the privileged IdentityDbContext. A context
    // FACTORY (not a scoped context) so every request-local anchor loader + probe gets a fresh,
    // isolated instance it owns and disposes (anchors must never be cached across requests).
    builder.Services.AddDbContextFactory<AnchorDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IAnchorLoaderFactory, EfAnchorLoaderFactory>();
    builder.Services.AddScoped<ScopedProbe>();

    // --- Audit plane (WP2.7): the single data_access_log writer ------------------------
    // The ONE legitimate, append-only C# write. DataAccessAuditDbContext maps the Prisma-OWNED,
    // append-only `data_access_logs` table and writes UNDER TenantScope (app_tenant + org GUC) so the
    // RLS WITH CHECK passes for the caller's org. Same DB connection string as the identity plane.
    builder.Services.AddDbContext<DataAccessAuditDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IDataAccessAuditor, DataAccessAuditWriter>();

    // --- HRIS plane (WP3.1): the first EF-OWNED product context ------------------------
    // HrisDbContext owns the DDL of the four `hris_`-prefixed tables and is write-capable. Like the
    // tenant/audit contexts it is "dumb" about tenancy — every HRIS read/write runs UNDER TenantScope
    // (SET LOCAL ROLE app_tenant + org GUC) so RLS engages. Additive registration on the same platform
    // connection string; later slices add the connector/sync/secret services on top.
    builder.Services.AddDbContext<HrisDbContext>(options => options.UseNpgsql(databaseConnectionString));

    // --- External-vendor assessment read plane (Phase-5 Slice 1) ----------------------
    // The FIRST strangler: the external-vendor assessment READ surface ported to C#. Read-only EF
    // (efcoreReadOnly) over the Prisma-OWNED assessment_results ⋈ assessment_assignments ⋈
    // assessment_types, run UNDER TenantScope (app_tenant + org GUC) so RLS engages. The use case audits
    // every exported psychometric row fail-closed (IDataAccessAuditor, registered above) BEFORE returning
    // any data. Cutover is deploy-gated (deferred) — no traffic is routed here yet.
    // A dedicated data source with EnableUnmappedTypes so the native Postgres `band` enum column reads
    // into the mapped C# string property. Registered as a WRAPPER (ExternalAssessmentDataSourceHolder),
    // NOT the open NpgsqlDataSource service type -- exactly like BillingReadDbContext below -- so
    // EnableUnmappedTypes stays exclusive to this context and never bleeds into the other string-based
    // contexts.
    builder.Services.AddSingleton(_ =>
        new ExternalAssessmentDataSourceHolder(ExternalAssessmentDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<ExternalAssessmentDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<ExternalAssessmentDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IExternalAssessmentRepository, ExternalAssessmentRepository>();
    builder.Services.AddScoped<ExternalAssessmentReadUseCase>();

    // --- External-vendor validation WRITE plane (Phase-5 Slice 2) ----------------------
    // The FIRST C# write to a PRODUCT table: the external-vendor validation submit surface ported to C#.
    // Write-capable EF (efcoreStranglerWrite) over the Prisma-OWNED preemployment_validations table, run
    // UNDER TenantScope (app_tenant + org GUC) so RLS engages. The use case does the atomic pending-only
    // update then a fail-SOFT audit (IDataAccessAuditor). Prisma still owns the DDL AND the staff
    // updateValidation write, so the ownership flip is deferred; cutover is deploy-gated (no traffic here).
    builder.Services.AddDbContext<ExternalValidationDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IExternalValidationRepository, ExternalValidationRepository>();
    builder.Services.AddScoped<ExternalValidationSubmitUseCase>();

    // --- Billing invoice READ plane (Phase-5 Slice 3) ---------------------------------
    // The SECOND strangler + the FIRST staff-JWT C# product read: billing.listInvoices / getInvoice
    // ported to C#. Read-only EF (efcoreReadOnly) over the Prisma-OWNED invoices ⋈ subscriptions, run
    // UNDER TenantScope (app_tenant + org GUC) so RLS engages. Authenticated by the Supabase JWT scheme
    // and gated on the billing:read grant via the SAME PermissionService kernel as the tRPC
    // permissionProcedure. Cutover is deploy-gated (deferred) — dark unless BillingReadEnabled.
    // A dedicated data source with EnableUnmappedTypes so the native Prisma enum columns
    // (InvoiceStatus/OrgPlan/SubscriptionStatus) read into the mapped C# string properties. Registered
    // lazily (built on first BillingReadDbContext construction — only a real billing request), so an
    // unconfigured/placeholder-DB boot (dark flag) never eagerly opens it.
    // Registered as a WRAPPER (BillingReadDataSourceHolder), NOT the open NpgsqlDataSource service type:
    // EFCore.PG's UseNpgsql(connectionString) auto-resolves an app-registered NpgsqlDataSource, so an open
    // registration would bleed EnableUnmappedTypes into every other (string-based) context. The wrapper
    // keeps the data source exclusive to BillingReadDbContext.
    builder.Services.AddSingleton(_ =>
        new BillingReadDataSourceHolder(BillingReadDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<BillingReadDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<BillingReadDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IBillingReadRepository, BillingReadRepository>();
    builder.Services.AddScoped<BillingReadUseCase>();
    // Slice 3b usage/plan/config reads: the use case reuses IBillingReadRepository (subscription + counts on
    // the same read context). getBillingConfig reads the deploy's Stripe config (optional; absent → honest
    // "not configured"), bound but NOT ValidateOnStart (every field is optional).
    builder.Services.AddScoped<BillingUsageUseCase>();

    // Phase-5 Slice 5 (efcoreReadOnly): the recruitment-analytics READ surface. Plain read-only context —
    // the aggregated status/source columns are ordinary strings (NOT native Prisma enums), so unlike billing
    // it needs no NpgsqlDataSource with EnableUnmappedTypes. Reads run UNDER TenantScope/RLS; dark unless
    // ReportingReadEnabled (deploy-gated cutover).
    builder.Services.AddDbContext<ReportingReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IReportingReadRepository, ReportingReadRepository>();
    builder.Services.AddScoped<ReportingReadUseCase>();

    // Phase-5 (efcoreStranglerWrite): the STAFF pre-employment-validation write (the 2nd strangler writer on
    // preemployment_validations). Write-capable context UNDER TenantScope/RLS; the endpoint additionally runs
    // the by-id offer IDOR probe (ScopedProbe, already registered above). Dark unless ValidationStaffWriteEnabled.
    builder.Services.AddDbContext<StaffValidationDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IStaffValidationRepository, StaffValidationRepository>();
    builder.Services.AddScoped<StaffValidationUpdateUseCase>();

    // Phase-5 Slice 6 (efcoreReadOnly): the team-intel READ surface. Plain read-only context over the
    // Prisma-OWNED teams/user_teams/users/business_units/vacancies/okrs (no native enums → no
    // NpgsqlDataSource). Reads run UNDER TenantScope/RLS; the by-id reads additionally run the team IDOR probe
    // (ScopedProbe, already registered above) and compare composes scopeWhereFor('team'). Dark unless
    // TeamIntelReadEnabled (deploy-gated cutover).
    builder.Services.AddDbContext<TeamIntelReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<ITeamIntelReadRepository, TeamIntelReadRepository>();
    builder.Services.AddScoped<TeamIntelReadUseCase>();

    // Phase-5 Q0b slice 1 / issue #100 (efcoreReadOnly): the monitoring READ surface — the prerequisite
    // the ownership-flip runbook §7b names as the gating item for flips #64/#66/#68. Plain read-only
    // context over the Prisma-OWNED alerts/alert_rules/action_plans/users/vacancies/salary_adjustments/
    // surveys/survey_responses (every status column is plain text → no NpgsqlDataSource needed). Reads
    // run UNDER TenantScope/RLS; getActionPlanAlerts additionally composes scopeWhereFor('actionPlan').
    // Dark unless MonitoringReadEnabled (deploy-gated cutover).
    builder.Services.AddDbContext<MonitoringReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IMonitoringReadRepository, MonitoringReadRepository>();
    builder.Services.AddScoped<MonitoringReadUseCase>();

    // Phase-5 slice 19 (#76): platform-owner ORGANIZATIONS READ. Cross-org by design and NEVER wrapped
    // in TenantScope — PlatformOwnerGate is the entire authorization boundary. Read-only over
    // Prisma-owned tables (efcoreReadOnly): this slice adds no writer and moves nothing in the ledger.
    // Dark unless PlatformOrganizationsReadEnabled (deploy-gated cutover).
    // A dedicated data source with EnableUnmappedTypes, shared by the read and write contexts of this
    // domain: organizations.plan / subscriptions.plan+status / invoices.status / platform_invitations.status
    // are NATIVE Prisma enum columns mapped to C# strings, and EFCore.PG throws on those without it. Slice 19
    // shipped WITHOUT this and would have 500'd on every read once flipped on — the fault is invisible to
    // unit tests and only appears against a real Postgres (found by the slice-20 integration tests; guarded
    // by PlatformOrganizationsReadDbContextTests). Registered as a WRAPPER, not the open NpgsqlDataSource
    // service type, so EnableUnmappedTypes cannot bleed into every other string-based context. Built lazily,
    // so a dark-flag boot on a placeholder DB never opens it.
    builder.Services.AddSingleton(_ =>
        new PlatformOrganizationsDataSourceHolder(PlatformOrganizationsDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<PlatformOrganizationsReadDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<PlatformOrganizationsDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IPlatformOrganizationsReadRepository, PlatformOrganizationsReadRepository>();
    builder.Services.AddScoped<PlatformOrganizationsReadUseCase>();

    // Phase-5 slice 22 (#75): platform-owner INVITATIONS READ (getInvitationKpis / listInvitations /
    // exportInvitationsCsv). Cross-org by design and NEVER wrapped in TenantScope — PlatformOwnerGate is the
    // entire authorization boundary. Read-only over Prisma-owned tables (efcoreReadOnly): no writer added,
    // nothing moved in the ledger. Dark unless PlatformInvitationsReadEnabled.
    // Its OWN data-source holder rather than PlatformOrganizations', because EnableUnmappedTypes is per-domain
    // by convention (one holder per domain, so a domain's type handling cannot bleed into another's) — and it
    // is MANDATORY here: platform_invitations.type AND .status are native Prisma enums read as C# strings, so
    // listInvitations and exportInvitationsCsv would both throw InvalidCastException on the first materialised
    // row against a real Postgres, with every unit test green. Built lazily, so a dark-flag boot on a
    // placeholder DB never opens it.
    builder.Services.AddSingleton(_ =>
        new PlatformInvitationsDataSourceHolder(PlatformInvitationsDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<PlatformInvitationsReadDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<PlatformInvitationsDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IPlatformInvitationsReadRepository, PlatformInvitationsReadRepository>();
    builder.Services.AddScoped<PlatformInvitationsReadUseCase>();

    // Phase-5 slice 23 (#81, PR 1 of 3): platform-owner DASHBOARD READ, the three FX-free procedures
    // (getPlanDistribution / getUserGrowth / getRecentActivity). Cross-org by design and NEVER wrapped in
    // TenantScope — PlatformOwnerGate is the entire authorization boundary. Read-only over Prisma-owned
    // tables (users efcoreReadOnly; organizations/subscriptions efcoreStranglerWrite via slices 20/21):
    // no writer added, nothing moved in the ledger. Dark unless PlatformDashboardReadEnabled.
    // Its OWN data-source holder (EnableUnmappedTypes is per-domain by convention), and MANDATORY here:
    // subscriptions.plan and organizations.plan are native OrgPlan enums read as C# strings, so
    // getPlanDistribution and getRecentActivity would both throw InvalidCastException on the first
    // materialised row against a real Postgres, with every unit test green. getUserGrowth is raw SQL
    // projecting text + bigint and alone would survive.
    builder.Services.AddSingleton(_ =>
        new PlatformDashboardDataSourceHolder(PlatformDashboardDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<PlatformDashboardReadDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<PlatformDashboardDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IPlatformDashboardReadRepository, PlatformDashboardReadRepository>();
    builder.Services.AddScoped<PlatformDashboardReadUseCase>();

    // PR 2 of 3, same flag and the SAME context/data source: the six remaining FX-free reads
    // (getAttentionItems / getMrrTrend / getMrrForecast / getCustomerHealth / getUpsellOpportunities /
    // search). Split into four repository+use-case pairs rather than one of each, because the four
    // groups share no query and merging them would put five unrelated kernels in one 600-line file.
    // The context widens to invoices, platform_invitations, feature_flags and vacancies — all four
    // already in efcoreReadOnly[], so still no ledger move and still no writer.
    builder.Services.AddScoped<IPlatformDashboardAttentionRepository, PlatformDashboardAttentionRepository>();
    builder.Services.AddScoped<PlatformDashboardAttentionUseCase>();
    builder.Services.AddScoped<IPlatformDashboardMrrRepository, PlatformDashboardMrrRepository>();
    builder.Services.AddScoped<PlatformDashboardMrrUseCase>();
    builder.Services.AddScoped<IPlatformDashboardAccountsRepository, PlatformDashboardAccountsRepository>();
    builder.Services.AddScoped<PlatformDashboardAccountsUseCase>();
    builder.Services.AddScoped<IPlatformDashboardSearchRepository, PlatformDashboardSearchRepository>();
    builder.Services.AddScoped<PlatformDashboardSearchUseCase>();

    // PR 3 of 3, same flag and the SAME context/data source again: the three FX-DERIVED reads
    // (getDashboardKpis / getRevenueByCustomer / getChurnRisk). The context gains ONE COLUMN, invoices
    // .paid_at, and no new table — so still no ledger move and still no writer. What is new is the
    // DEPENDENCY: this use case also consumes the Slice-11c FX plane (IFxRateProvider over the global
    // fx_rates context, registered unconditionally further down), which is why it takes the provider
    // rather than FxMoneyConverter — it wraps each call in a per-request MemoizingFxRateProvider so one
    // currency pair costs one lookup per request, as the TS rate cache does.
    builder.Services.AddScoped<IPlatformDashboardFxRepository, PlatformDashboardFxRepository>();
    builder.Services.AddScoped<PlatformDashboardFxUseCase>();

    // The FINAL dashboard read, same flag and the SAME context/data source once more: getAiCostAnomalies.
    // The context gains THREE NEW TABLES (ai_agents / ai_agent_org_configs / ai_agent_usage_logs), and
    // unlike every earlier PR of this slice those are NEW efcoreReadOnly[] ledger entries — nothing had
    // ever mapped them (see the platform_dashboard_read_slice23_ai note). Still SELECTs only, no writer.
    builder.Services.AddScoped<IPlatformDashboardAiRepository, PlatformDashboardAiRepository>();
    builder.Services.AddScoped<PlatformDashboardAiUseCase>();

    // Phase-5 slice 20 (#76): platform-owner ORGANIZATIONS WRITE (updateOrganization/suspendOrganization).
    // Its OWN context, mapping organizations AND audit_logs, because the fail-closed audit decided on #76
    // only holds if the audit INSERT shares the org UPDATE's transaction — and since every context here is
    // registered with its own connection (nothing shares a DbConnection + UseTransaction), reusing
    // AuditLogDbContext would put them in two transactions and quietly lose the guarantee. Runs UNDER TenantScope (the org id is
    // known, so RLS stays engaged); the notification fan-out is the one unscoped part, by necessity.
    // Dark unless PlatformOrganizationsWriteEnabled (deploy-gated cutover; TS stays the sole active writer).
    builder.Services.AddDbContext<PlatformOrganizationsWriteDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<PlatformOrganizationsDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IPlatformOrganizationsWriteRepository, PlatformOrganizationsWriteRepository>();
    builder.Services.AddScoped<PlatformOrganizationsWriteUseCase>();

    // Phase-5 slice 21 (#76): platform-owner ORGANIZATION CREATE + the shared org-provisioning service.
    // Its OWN context, mapping organizations + roles + companies + business_units + teams +
    // org_entitlements + plan_modules (read-only) + audit_logs + users/notifications (the fan-out),
    // for the same reason slice 20's does: the fail-closed audit only holds if the audit INSERT shares the
    // creation transaction, and every context here is registered with its own connection (nothing shares a
    // DbConnection + UseTransaction), so reusing AuditLogDbContext would split them. Reuses the SAME
    // PlatformOrganizationsDataSourceHolder registered above (one per domain) — EnableUnmappedTypes is
    // mandatory here, since the create path reads the organization row back and organizations.plan is a
    // native PG enum. Runs UNDER TenantScope opened on the client-generated new org id.
    // NOT mapped, deliberately: `subscriptions` is written ONLY by raw ExecuteSqlInterpolatedAsync
    // (PlatformOrganizationsCreateRepository), because plan/status are native PG enums EF has no store
    // mapping to write through. It is therefore INVISIBLE to scripts/table-ownership.mjs, which greps for
    // table names in EF ToTable calls and nothing else (#199) — as is `organizations`, written the same way
    // for the same reason. Those two are the slice's governance blind spot; every OTHER table here goes
    // through EF precisely so its ledger entry is actually enforced.
    //
    // Do NOT write that grep's pattern out literally in a comment: the checker cannot tell code from prose,
    // so an illustrative snippet registers as a real mapping and fails the governance test with a table name
    // of "...". Which is, itself, the sharpest available demonstration of #199.
    // Dark unless PlatformOrganizationsCreateEnabled (deploy-gated; TS stays the sole active writer, and
    // stays a writer permanently — self-serve signup shares the same helpers).
    builder.Services.AddDbContext<PlatformOrganizationsCreateDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<PlatformOrganizationsDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IPlatformOrganizationsCreateRepository, PlatformOrganizationsCreateRepository>();
    builder.Services.AddScoped<PlatformOrganizationsCreateUseCase>();

    // §8 Q0b slice 2 / issue #172: the CROSS-ORG alert-metric read for the alert-evaluation cron — the last
    // blocker on flips #64 and #66. Deliberately REUSES MonitoringReadDbContext above rather than adding a
    // second context over the same two tables: the identical counts already ship in
    // MonitoringReadRepository.GetExecutiveKpiCountsAsync, and each read here still runs under TenantScope
    // scoped to ONE explicitly-named org, so this surface bypasses no RLS. What makes it "privileged" is the
    // right to NAME any org, enforced at the edge by CronCallerGate's secret — not a BYPASSRLS login role.
    builder.Services.AddScoped<IAlertMetricsReadRepository, AlertMetricsReadRepository>();
    builder.Services.AddScoped<AlertMetricsReadUseCase>();

    // Phase-5 Slice 7 (efcoreReadOnly): the evaluation360 READ surface. Unlike the reporting/team-intel reads,
    // the review_cycles.status / rater_assignments.relationship / rater_assignments.status columns are NATIVE
    // Prisma enums that this surface FILTERS on (status='pending', cycle.status='open', status='published',
    // status='submitted') — Postgres has no implicit enum=text operator — so a dedicated data source maps them
    // to CLR enums (isolated behind a holder like the billing contexts, so the mappings never bleed into other
    // string-based contexts). Reads run UNDER TenantScope/RLS; the self-service reads ALSO hard-filter on the
    // resolved caller's user id. The myReport aggregation reuses the shared Eval360Aggregate min-3 kernel. Dark
    // unless Evaluation360ReadEnabled (deploy-gated cutover; TS stays the sole active reader until Federico flips it).
    builder.Services.AddSingleton(_ =>
        new Evaluation360ReadDataSourceHolder(Evaluation360ReadDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<Evaluation360ReadDbContext>((sp, options) =>
        options.UseNpgsql(
            sp.GetRequiredService<Evaluation360ReadDataSourceHolder>().DataSource,
            Evaluation360ReadDataSource.MapEnums));
    builder.Services.AddScoped<IEvaluation360ReadRepository, Evaluation360ReadRepository>();
    builder.Services.AddScoped<Evaluation360ReadUseCase>();

    // Phase-5 Slice 13 (efcoreStranglerWrite): the evaluation360 WRITE surface. Write-capable EF over the
    // Prisma-OWNED review_cycles/rater_assignments/rater_responses (+ read-only users for the assignRaters
    // membership check), run UNDER TenantScope/RLS. The status/relationship native enums are FILTERED/SET, so the
    // write context reuses the Slice-7 enum-mapped data source behind a DEDICATED holder (isolated, no bleed). The 5
    // STAFF writes gate on evaluation360:create/update + the org-gate; submitRatings is IDENTITY-anchored (the Slice-7
    // self-service gate — any resolved principal, hard-filtered on rater_user_id = caller). Dark unless
    // Evaluation360WriteEnabled (deploy-gated cutover; TS stays the sole active writer). A COEXISTENCE write — the
    // three tables are still read by Evaluation360ReadDbContext (a distinct read-only context).
    builder.Services.AddSingleton(_ =>
        new Evaluation360WriteDataSourceHolder(Evaluation360ReadDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<Evaluation360WriteDbContext>((sp, options) =>
        options.UseNpgsql(
            sp.GetRequiredService<Evaluation360WriteDataSourceHolder>().DataSource,
            Evaluation360ReadDataSource.MapEnums));
    builder.Services.AddScoped<IEvaluation360WriteRepository, Evaluation360WriteRepository>();
    builder.Services.AddScoped<Evaluation360WriteUseCase>();

    // Phase-5 Slice 8 (efcoreReadOnly): the succession READ surface. Plain read-only context over the
    // Prisma-OWNED critical_roles/successors (+ users/salary_bands/employee_compensations/nine_box_evaluations)
    // — readiness/criticality/type/quadrant are plain Strings (NOT native enums), so no NpgsqlDataSource. Reads
    // run UNDER TenantScope/RLS; the by-id reads run the assertScoped('criticalRole') IDOR probe (ScopedProbe,
    // already registered above), listCriticalRoles/getCriticalRole/simulate/suggested compose scopeWhereFor,
    // and the analytics reads apply the org-gate. getCompGapAlerts enforces a secondary compensation:read grant
    // + audits exposed comp rows via IDataAccessAuditor (already registered). Dark unless SuccessionReadEnabled.
    builder.Services.AddDbContext<SuccessionReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<ISuccessionReadRepository, SuccessionReadRepository>();
    builder.Services.AddScoped<SuccessionReadUseCase>();

    // Phase-5 Slice 14 (efcoreStranglerWrite): the succession WRITE surface (the 5 succession writes). Write-capable
    // EF over the Prisma-OWNED critical_roles + successors (+ read-only users for the addSuccessor nested user
    // projection) — criticality/readiness/type are plain Strings (NOT native enums), so no NpgsqlDataSource. Every
    // write runs UNDER TenantScope/RLS with an explicit org value. addCriticalRole requires org/company scope
    // (requireOrgScope); addSuccessor runs assertScoped('criticalRole') (parent IDOR probe) THEN
    // assertSubjectInScope on the TARGET userId (ScopedProbe/IAnchorLoaderFactory/SubjectInScope, already registered
    // above) + maps the @@unique([criticalRoleId, userId]) violation → 409; remove/updateReadiness/updateBand run the
    // by-id assertScoped probe (successor registered as a probe root THIS slice). The WRITE port completing the
    // succession domain (FLIP-READY). Dark unless SuccessionWriteEnabled (deploy-gated cutover; TS stays the sole
    // active writer). A COEXISTENCE write — critical_roles/successors are still read by SuccessionReadDbContext.
    builder.Services.AddDbContext<SuccessionWriteDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<ISuccessionWriteRepository, SuccessionWriteRepository>();
    builder.Services.AddScoped<SuccessionWriteUseCase>();

    // Phase-5 Slice 9 (efcoreReadOnly): the FX-free compensation READ surface. Plain read-only context over the
    // Prisma-OWNED salary_bands/employee_compensations/benefit_plans/benefit_enrollments (+ users) —
    // salary_adjustments.type/.status + benefit_plans.type are plain Strings (NOT native enums), so no
    // NpgsqlDataSource. Reads run UNDER TenantScope/RLS; getBenefitsUtilization/getCompaRatioDistribution apply
    // the org-gate, listPendingAdjustments composes scopeWhereFor('salaryAdjustment') + selectFor field-auth,
    // getEmployeeComp does assertSubjectInScope + selectFor, myCompensation is own-pinned. The field-authed reads
    // audit exposed rows via IDataAccessAuditor (already registered). Dark unless CompensationReadEnabled.
    builder.Services.AddDbContext<CompensationReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<ICompensationReadRepository, CompensationReadRepository>();
    builder.Services.AddScoped<CompensationReadUseCase>();

    // Phase-5 Slice 12 (efcoreStranglerWrite): the compensation WRITE surface (POST /compensation/adjustments +
    // /compensation/adjustments/{id}/approve). Write-capable EF over the Prisma-OWNED salary_adjustments +
    // employee_compensations (no native enums → no NpgsqlDataSource), run UNDER TenantScope/RLS. createAdjustment
    // does assertSubjectInScope on the TARGET userId + the currency fallback + a pending INSERT; approveAdjustment
    // runs the assertScoped('salaryAdjustment') by-id IDOR probe (ScopedProbe, already registered above) + a
    // fail-closed audit (IDataAccessAuditor, already registered) BEFORE the atomic conditional transaction. The
    // FIRST compensation WRITE port. Dark unless CompensationWriteEnabled (deploy-gated cutover; TS stays the sole
    // active writer). A COEXISTENCE write — salary_adjustments/employee_compensations are still read by
    // CompensationReadDbContext (a distinct read-only context).
    builder.Services.AddDbContext<CompensationWriteDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<ICompensationWriteRepository, CompensationWriteRepository>();
    builder.Services.AddScoped<CompensationWriteUseCase>();

    // Phase-5 Slice 10 (efcoreReadOnly): the nine-box READ surface. Plain read-only context over the
    // Prisma-OWNED nine_box_evaluations + calibration_sessions/calibration_members/calibration_votes (+ users/
    // user_teams/teams) — quadrant + calibration status/member-status are plain Strings (NOT native enums), so
    // no NpgsqlDataSource. Reads run UNDER TenantScope/RLS; getGrid/getMovementHistory compose
    // scopeWhereFor('nineBoxEvaluation'), getEmployeeDetail/getAxisBreakdown do assertSubjectInScope,
    // listCalibrations/getBenchStrength/getDashboardKpis apply the org-gate, getCalibration hand-rolls the
    // committee-membership gate, myCalibrations the created-by-OR-member self list. Dark unless NineBoxReadEnabled.
    builder.Services.AddDbContext<NineBoxReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<INineBoxReadRepository, NineBoxReadRepository>();
    builder.Services.AddScoped<NineBoxReadUseCase>();

    // Phase-5 Slice 15 (efcoreStranglerWrite): the nine-box calibration WRITE surface (the 5 calibration writes).
    // Write-capable EF over the Prisma-OWNED calibration_sessions + calibration_members (+ read-only users for the
    // in-org checks) — status/quadrant are plain Strings (NOT native enums), so no NpgsqlDataSource. The
    // calibration_votes upsert is a raw ON-CONFLICT INSERT on the context's connection (EF has no native upsert).
    // Writes run UNDER TenantScope/RLS; the member/vote WITH CHECK (session-org, subquery policy) is the tenant guard
    // (those tables have no organization_id). createCalibration/addCalibrationMember/removeCalibrationMember/
    // finalizeCalibration gate on ninebox:create|update + requireOrgScope; submitCalibrationVote is MEMBERSHIP+IDENTITY
    // anchored (ninebox:update, NO requireOrgScope — voter = caller). The WRITE port completing the nine-box domain
    // (FLIP-READY). Dark unless NineBoxWriteEnabled (deploy-gated cutover; TS stays the sole active writer). A
    // COEXISTENCE write — the three tables are still read by NineBoxReadDbContext (a distinct read-only context).
    builder.Services.AddDbContext<NineBoxWriteDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<INineBoxWriteRepository, NineBoxWriteRepository>();
    builder.Services.AddScoped<NineBoxWriteUseCase>();

    // Phase-5 Slice 11 (efcoreReadOnly): the engagement READ surface. Plain read-only context over the
    // Prisma-OWNED surveys/survey_responses/action_plans/leader_commitments/alerts (+ users) — surveys.type/.status,
    // action_plans.status, leader_commitments.status, alerts.* are all plain Strings (NOT native enums), so no
    // NpgsqlDataSource. Reads run UNDER TenantScope/RLS; the 9 org-rollup aggregates apply the org-gate,
    // listActionPlans/listLeaderCommitments compose scopeWhereFor('actionPlan'|'leaderCommitment'), and
    // myPendingSurveys/getSurveyForResponse are OWN identity-anchored (no org-gate). The suppression shapers are
    // the pure @tims/shared / Tims.Domain.Engagement kernels. Dark unless EngagementReadEnabled.
    builder.Services.AddDbContext<EngagementReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IEngagementReadRepository, EngagementReadRepository>();
    builder.Services.AddScoped<EngagementReadUseCase>();

    // Phase-5 Slice 16 (efcoreStranglerWrite): the engagement WRITE surface (5 writes). Write-capable EF over the
    // Prisma-OWNED surveys + survey_responses + action_plans (+ read-only users for the H1 in-org check) — type/status
    // are plain Strings (NOT native enums), so no NpgsqlDataSource; jsonb columns bind as string with HasColumnType.
    // Writes run UNDER TenantScope/RLS. createSurvey/activateSurvey are grant-only; submitSurveyResponse is
    // IDENTITY-anchored (userId = caller, NO requireOrgScope) + maps @@unique([surveyId,userId]) → 409 and
    // not-found-or-inactive → clean 404 (documented improvement over the TS 500); createActionPlan does
    // assertSubjectInScope(responsibleId) + the H1 in-org backstop; updateActionPlan runs assertScoped('actionPlan')
    // (by-id IDOR probe, actionPlan registered as a probe root THIS slice) THEN assertSubjectInScope + H1 on a
    // reassignment. ScopedProbe / IAnchorLoaderFactory / SubjectInScope are already registered above. The WRITE port
    // completing the engagement domain. Dark unless EngagementWriteEnabled (deploy-gated cutover; TS stays the sole
    // active writer). A COEXISTENCE write — surveys/survey_responses/action_plans are still read by
    // EngagementReadDbContext AND by the LIVE TS monitoring.ts / dei.ts / alert-evaluation cron.
    builder.Services.AddDbContext<EngagementWriteDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IEngagementWriteRepository, EngagementWriteRepository>();
    builder.Services.AddScoped<EngagementWriteUseCase>();

    // Phase-5 Slice 11b (efcoreReadOnly): the DEI READ surface (people-dashboards GROUP 2). Unlike the engagement
    // read, employee_demographics carries THREE NATIVE Prisma enums the demographic reads GROUP BY (Gender /
    // Ethnicity / DisabilityStatus) — Postgres has no implicit enum=text operator — so a dedicated data source maps
    // them to CLR enums (isolated behind a holder like the billing/eval360 contexts, so the mappings never bleed
    // into other string-based contexts). Reads run UNDER TenantScope/RLS; the gate is GRANT-ONLY (dei:read; no
    // org-gate — k-anonymity is the disclosure control). The suppression/ratio shapers are the pure @tims/shared /
    // Tims.Domain.Dei kernels. Dark unless DeiReadEnabled (deploy-gated cutover; TS stays the sole active reader
    // until Federico flips it). getPayEquity (FX) → Slice 11c.
    builder.Services.AddSingleton(_ =>
        new DeiReadDataSourceHolder(DeiReadDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<DeiReadDbContext>((sp, options) =>
        options.UseNpgsql(
            sp.GetRequiredService<DeiReadDataSourceHolder>().DataSource,
            DeiReadDataSource.MapEnums));
    builder.Services.AddScoped<IDeiReadRepository, DeiReadRepository>();
    builder.Services.AddScoped<DeiReadUseCase>();

    // Phase-5 Slice 11c: the FX read plane. The global RLS-exempt FxRateDbContext reads the DB-pinned rates
    // the refresh writes; FxRateProvider resolves the latest effective-dated pin (cross-rate via USD,
    // FAIL-SOFT cold-start → null); FxMoneyConverter bridges the reads to the pure convertMoney/sumMoney kernels.
    // Feeds dei.getPayEquity + the five compensation FX reads. Dark unless FxReadsEnabled (deploy-gated cutover).
    builder.Services.AddDbContext<FxRateDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IFxRateProvider, FxRateProvider>();
    builder.Services.AddScoped<FxMoneyConverter>();
    builder.Services.AddScoped<CompensationFxReadUseCase>();

    // The FX REFRESH plane (2026-08-15) — the write half of Slice 11c, hosted HERE because the Workers
    // host it was designed for was never deployed while FxReadsEnabled went live, freezing every
    // production pin at as_of 2026-07-31 (see PlatformOptions.FxRefreshEnabled for the full incident).
    // The gateway + write repo + use case register UNCONDITIONALLY (inert without a resolver, and the
    // resilience tests drive the same registration); ONLY the hosted loop is flag-gated, mirroring how
    // routes register DI always but map behind their flag. FxOptions has valid defaults for every knob,
    // so ValidateOnStart cannot fail a host that never configured an Fx section.
    builder.Services
        .AddOptions<FxOptions>()
        .Bind(builder.Configuration.GetSection(FxOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();
    builder.Services.AddFxRateGateway();
    builder.Services.AddScoped<IFxRateWriteRepository, FxRateWriteRepository>();
    builder.Services.AddScoped<RefreshFxRatesUseCase>();

    // Hosted-service registration must happen BEFORE Build(), so this reads the RAW config value the way
    // the bootstrap block reads ServiceName/OtlpEndpoint — the bound PlatformOptions is not resolvable
    // yet. isOpenApiDocGeneration deliberately does NOT force this on: the doc-generation escape hatch
    // exists to inventory ROUTES, and this maps none.
    if (bool.TryParse(platformSection[nameof(PlatformOptions.FxRefreshEnabled)], out var fxRefreshEnabled)
        && fxRefreshEnabled)
    {
        builder.Services.AddHostedService<FxRefreshHostedService>();
    }

    // Phase-5 Slice 17 (efcoreReadOnly): the cross-org audit-log READ surface. Plain read-only context
    // over the Prisma-OWNED audit_logs (+ context-local users/organizations read entities for the
    // actor/organization joins) — NEVER wrapped in TenantScope (platform-owner-only; RLS does not
    // restrict this reader, see AuditReadDbContext). Dark unless AuditLogReadEnabled.
    builder.Services.AddDbContext<AuditReadDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IAuditReadRepository, AuditReadRepository>();

    // Phase-5 Slice 18 (efcoreReadOnly on users/roles/user_roles/role_permissions/permissions/
    // organizations; access_reviews stays Prisma-owned until Task 9): the access-review report +
    // attestation orchestration. SecurityEventWriter reuses the AuditLogDbContext registered below
    // (Billing Self-Serve block) — not re-registered here.
    builder.Services.AddDbContext<AccessReviewDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IAccessReviewRepository, AccessReviewRepository>();
    builder.Services.AddScoped<ISecurityEventWriter, SecurityEventWriter>();
    builder.Services.AddScoped<AccessReviewService>();

    builder.Services
        .AddOptions<StripeBillingOptions>()
        .Bind(builder.Configuration.GetSection(StripeBillingOptions.SectionName));
    // The submit use case truncates its completion instant to whole milliseconds through TimeProvider so
    // persisted (timestamp(3)) == returned (v1) == JS `new Date()` ms precision; register the system clock.
    builder.Services.TryAddSingleton(TimeProvider.System);

    // --- Billing Stripe-webhook WRITE plane (Phase-5 Slice 4) --------------------------
    // The state-sync engine that upserts subscriptions + mirrors organizations.plan from Stripe events. A
    // COEXISTENCE efcoreStranglerWrite (subscriptions has other non-webhook writers, so the ownership flip is
    // deferred). Runs on the PRIVILEGED connection, NOT TenantScope: the webhook carries no org GUC (Stripe is
    // not a tenant), so it scopes every write by explicit organization_id on a role that bypasses RLS. Its
    // EnableUnmappedTypes data source (for the native SubscriptionStatus enum read) is isolated behind a
    // holder — exactly like BillingReadDbContext — so it never bleeds into the string-based contexts.
    builder.Services.AddSingleton(_ =>
        new BillingWebhookDataSourceHolder(BillingWebhookDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<BillingWebhookDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<BillingWebhookDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IBillingWebhookRepository, BillingWebhookRepository>();
    // The Stripe SDK boundary (signature verify + retrieve/cancel), fed the secret + webhook signing secret
    // from StripeBillingOptions — the gateway takes plain values so Infrastructure never references the Api layer.
    builder.Services.AddScoped<IStripeWebhookGateway>(sp =>
    {
        var stripe = sp.GetRequiredService<IOptions<StripeBillingOptions>>().Value;
        return new StripeWebhookGateway(stripe.SecretKey, stripe.WebhookSecret);
    });
    // The self-serve price env the kernel maps a Stripe price id back to an OrgPlan with (no downgrade on unknown).
    builder.Services.AddSingleton(sp =>
    {
        var stripe = sp.GetRequiredService<IOptions<StripeBillingOptions>>().Value;
        return new StripeBillingEnv(stripe.PriceStarter, stripe.PriceProfessional);
    });
    builder.Services.AddScoped<IBillingWebhookLog, LoggerBillingWebhookLog>();
    builder.Services.AddScoped<BillingWebhookUseCase>();

    // --- Billing tenant SELF-SERVE plane (Phase-5 Slice 4b) ---------------------------
    // createCheckoutSession / createPortalSession / cancelSubscription — Stripe outbound + the customer-link
    // compare-and-set (subscriptions, efcoreStranglerWrite) + a fail-soft audit_logs write (efcoreAppendOnly,
    // the FIRST C# audit_logs writer). Runs on the TENANT path UNDER TenantScope (app_tenant + org GUC, RLS) —
    // NOT the privileged webhook path. Its EnableUnmappedTypes data source (for the subscription enum read) is
    // isolated behind a holder, like the other billing contexts.
    builder.Services.AddSingleton(_ =>
        new BillingSelfServeDataSourceHolder(BillingSelfServeDataSource.Build(databaseConnectionString ?? string.Empty)));
    builder.Services.AddDbContext<BillingSelfServeDbContext>((sp, options) =>
        options.UseNpgsql(sp.GetRequiredService<BillingSelfServeDataSourceHolder>().DataSource));
    builder.Services.AddScoped<IBillingSelfServeRepository, BillingSelfServeRepository>();
    // The first C# audit_logs writer (best-effort, fail-soft), shared by the portal/cancel actions.
    builder.Services.AddDbContext<AuditLogDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IBillingAuditWriter, BillingAuditWriter>();
    // The self-serve Stripe outbound gateway (customer/checkout/portal/cancel), fed the secret key from options.
    builder.Services.AddScoped<IStripeBillingGateway>(sp =>
        new StripeBillingGateway(sp.GetRequiredService<IOptions<StripeBillingOptions>>().Value.SecretKey));
    // The config-presence gate + plan→price + return-origin, built from StripeBillingOptions.
    builder.Services.AddSingleton(sp =>
    {
        var stripe = sp.GetRequiredService<IOptions<StripeBillingOptions>>().Value;
        // Honor the existing NEXT_PUBLIC_APP_URL env var (the TS source), with Stripe:AppUrl as an explicit
        // override — so a deploy that only sets NEXT_PUBLIC_APP_URL gets the right return origin (not the default).
        var envAppUrl = Environment.GetEnvironmentVariable("NEXT_PUBLIC_APP_URL");
        var appUrl = string.IsNullOrEmpty(envAppUrl) ? stripe.AppUrl : envAppUrl;
        return new BillingSelfServeConfig(
            stripe.SecretKey, stripe.PriceStarter, stripe.PriceProfessional, appUrl, stripe.PortalConfigurationId);
    });
    builder.Services.AddScoped<BillingSelfServeUseCase>();

    // --- HRIS connector plane (WP3.2): typed BambooHR client + resilience + secrets ----
    // Bind + validate HrisOptions at startup (the Zod-env-gate analog, mirroring PlatformOptions),
    // then wire the dev secret store, the provider factory, and the typed HttpClient carrying the
    // Polly-v8 pipeline (total timeout → retry+backoff+jitter on 429/5xx → circuit breaker). Additive;
    // no live BambooHR call is made — Slice 3 drives the connector from the sync use case.
    builder.Services
        .AddOptions<HrisOptions>()
        .Bind(builder.Configuration.GetSection(HrisOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();
    builder.Services.AddHrisConnectors();

    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            if (!string.IsNullOrWhiteSpace(jwksMetadataAddress))
            {
                // MetadataAddress needs the OIDC DISCOVERY document, not a raw JWKS URL — a
                // JWKS URL loads zero signing keys (silent 401s). Normalize a mistaken
                // …/jwks.json to its …/openid-configuration sibling. See SupabaseJwtMetadata.
                options.MetadataAddress = SupabaseJwtMetadata.NormalizeDiscoveryAddress(jwksMetadataAddress);
            }
            else if (!string.IsNullOrWhiteSpace(jwtIssuer))
            {
                // No explicit metadata address → derive discovery from the issuer
                // (.NET appends /.well-known/openid-configuration).
                options.Authority = jwtIssuer;
            }
            options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
            options.MapInboundClaims = false; // keep raw claim names (e.g. "sub")
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = jwtIssuer,
                ValidateAudience = true,
                ValidAudience = jwtAudience,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                // Pin to the ASYMMETRIC algorithms Supabase may sign with (ES256 is the current
                // Supabase default, RS256 covers a key-type rotation) — closes alg-confusion: a token
                // forged with alg=HS256/none can never be accepted because no symmetric alg is listed.
                ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256, SecurityAlgorithms.RsaSha256],
                ClockSkew = TimeSpan.FromSeconds(30),
                NameClaimType = "sub",
            };
            // Fail closed on a subjectless token: the whole identity plane resolves the TIMS
            // principal FROM `sub` (WP2.2), so a validly-signed token with no `sub` must not
            // authenticate (it would otherwise reach handlers as a null-subject principal).
            options.Events = new JwtBearerEvents
            {
                OnTokenValidated = context =>
                {
                    if (string.IsNullOrEmpty(context.Principal?.FindFirst("sub")?.Value))
                    {
                        context.Fail("token is missing the required 'sub' claim");
                    }
                    return Task.CompletedTask;
                },
            };
        })
        // --- External `tims_` API-key scheme (WP2.3) ----------------------------------
        // A distinct scheme from the Supabase JWT: it authenticates integrations presenting
        // `Authorization: Bearer tims_...`, resolving the key to an ExternalApiKey principal.
        // Fail-closed inside the handler (no valid key → 401).
        .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(
            ApiKeyAuthenticationHandler.SchemeName, _ => { });

    builder.Services.AddAuthorization(options =>
        // Policy that authenticates ONLY the ApiKey scheme, so /external-whoami cannot be reached
        // with a Supabase JWT (or any other scheme) — the API-key surface is isolated.
        options.AddPolicy(ApiKeyAuthenticationHandler.SchemeName, policy =>
        {
            policy.AddAuthenticationSchemes(ApiKeyAuthenticationHandler.SchemeName);
            policy.RequireAuthenticatedUser();
        }));

    // --- Rate limiting (WP2.6) --------------------------------------------------------
    // Shared-bucket sliding-window limiter that reproduces @upstash/ratelimit byte-for-byte, so
    // C# and TS throttle against the SAME Redis keys. The Redis limiter is registered ONLY when a
    // connection string is configured (Upstash exposes a Redis TCP endpoint); AbortOnConnectFail
    // is false so a transient outage surfaces as a per-call RedisConnectionException the guard
    // handles (fail-open-to-in-memory in Development, fail-closed in production) rather than
    // crashing the host. The in-memory fallback is always registered but engaged Development-only.
    var redisConnectionString = platformSection[nameof(PlatformOptions.RedisConnectionString)];
    if (!string.IsNullOrWhiteSpace(redisConnectionString))
    {
        builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
        {
            var config = ConfigurationOptions.Parse(redisConnectionString);
            config.AbortOnConnectFail = false;
            return ConnectionMultiplexer.Connect(config);
        });
        builder.Services.AddSingleton<RedisSlidingWindowRateLimiter>();
    }

    builder.Services.AddSingleton<InMemorySlidingWindowRateLimiter>();
    builder.Services.AddSingleton<RateLimitGuard>(sp => new RateLimitGuard(
        sp.GetService<RedisSlidingWindowRateLimiter>(),
        sp.GetRequiredService<InMemorySlidingWindowRateLimiter>(),
        sp.GetRequiredService<IHostEnvironment>()));

    // --- OpenAPI (emitted to contracts/openapi at build; served at /openapi/v1.json) --
    builder.Services.AddOpenApi(options =>
    {
        // Keep the SubmitValidationBody request schema faithful to the Zod contract: `notes` is OPTIONAL
        // (drop it from `required`) and, when present, a NON-NULL string (drop the null type union the C#
        // nullable annotation emits). status + result stay required non-null (the [Required] DTO members).
        options.AddSchemaTransformer((schema, context, _) =>
        {
            if (context.JsonTypeInfo.Type == typeof(SubmitValidationBody))
            {
                schema.Required?.Remove("notes");
                if (schema.Properties is not null
                    && schema.Properties.TryGetValue("notes", out var notesSchema)
                    && notesSchema is Microsoft.OpenApi.OpenApiSchema concreteNotes)
                {
                    concreteNotes.Type = Microsoft.OpenApi.JsonSchemaType.String;
                }
            }

            // The staff updateValidation body: `result` AND `notes` are OPTIONAL (drop from `required`) and,
            // when present, NON-NULL (drop the null union the C# nullable annotation emits) — matching the Zod
            // .optional() (absent OK; present-null rejected → 400). status stays required (the [Required] member).
            if (context.JsonTypeInfo.Type == typeof(StaffValidationUpdateBody))
            {
                schema.Required?.Remove("result");
                schema.Required?.Remove("notes");
                if (schema.Properties is not null)
                {
                    if (schema.Properties.TryGetValue("notes", out var staffNotes)
                        && staffNotes is Microsoft.OpenApi.OpenApiSchema concreteStaffNotes)
                    {
                        concreteStaffNotes.Type = Microsoft.OpenApi.JsonSchemaType.String;
                    }

                    // result is `oneOf: [{null}, {$ref JsonObject}]` from the nullable annotation — drop the
                    // null branch so present-result must be an object (absence is handled by `required` above).
                    if (schema.Properties.TryGetValue("result", out var staffResult)
                        && staffResult is Microsoft.OpenApi.OpenApiSchema concreteStaffResult
                        && concreteStaffResult.OneOf is not null)
                    {
                        for (var i = concreteStaffResult.OneOf.Count - 1; i >= 0; i--)
                        {
                            if (concreteStaffResult.OneOf[i] is Microsoft.OpenApi.OpenApiSchema branch
                                && branch.Type == Microsoft.OpenApi.JsonSchemaType.Null)
                            {
                                concreteStaffResult.OneOf.RemoveAt(i);
                            }
                        }
                    }
                }
            }

            // PlatformOrganizationRow (#211, 2026-08-11) — RESTORE the `type` its date properties lost.
            //
            // Those three properties gained [JsonConverter(NodeIso…DateTimeConverter)] so the emitted
            // instants actually carry the trailing `Z` that `format: date-time` (RFC 3339) promises and
            // that the TS `Date.prototype.toISOString()` contract requires. The generator, however,
            // cannot infer a schema type through a custom converter: it kept `format: date-time` and
            // DROPPED `"type": "string"` (and `deletedAt`'s `["null","string"]` union). That is a
            // contract REGRESSION — a typeless schema is weaker for a generated client than the wrong
            // serialization was — so the fix is both halves, not one. Same shape as the two body
            // transformers above: state the schema the wire actually carries.
            if (context.JsonTypeInfo.Type == typeof(PlatformOrganizationRow) && schema.Properties is not null)
            {
                foreach (var (name, nullable) in new[]
                         {
                             ("createdAt", false), ("updatedAt", false), ("deletedAt", true),
                         })
                {
                    if (schema.Properties.TryGetValue(name, out var dateSchema)
                        && dateSchema is Microsoft.OpenApi.OpenApiSchema concreteDate)
                    {
                        concreteDate.Type = nullable
                            ? Microsoft.OpenApi.JsonSchemaType.String | Microsoft.OpenApi.JsonSchemaType.Null
                            : Microsoft.OpenApi.JsonSchemaType.String;
                    }
                }
            }

            return Task.CompletedTask;
        });

        // GET /platform/dashboard/search (#81 PR 2) — `query` is REQUIRED, and the emitted contract said
        // otherwise.
        //
        // The handler binds it as `string?` on purpose (TRAP 9: a non-nullable parameter makes minimal-API
        // model binding 400 a missing query string BEFORE PlatformOwnerGate runs, handing an anonymous
        // caller a 400 where tRPC gives 401). The generator reads that nullable annotation and emits the
        // parameter without `required: true` — so the contract advertised an optional parameter that the
        // handler answers 400 for. Same defect class as the SubmitValidationBody transformer above, in the
        // opposite direction: state what the endpoint actually enforces, which is Zod's
        // `z.object({ query: z.string().min(1).max(100) })`. The bounds are carried too, so a generated
        // client sees the same limits the handler rejects on.
        options.AddOperationTransformer((operation, context, _) =>
        {
            if (context.Description.RelativePath == "platform/dashboard/search"
                && operation.Parameters is not null)
            {
                foreach (var parameter in operation.Parameters)
                {
                    // The collection is typed as the read-only IOpenApiParameter interface; the concrete
                    // type is what carries settable members, exactly as the schema transformers above
                    // cast to OpenApiSchema.
                    if (parameter.Name != "query" || parameter is not Microsoft.OpenApi.OpenApiParameter concrete)
                    {
                        continue;
                    }

                    concrete.Required = true;
                    if (concrete.Schema is Microsoft.OpenApi.OpenApiSchema schema)
                    {
                        schema.MinLength = PlatformDashboardSearchUseCase.MinQueryLength;
                        schema.MaxLength = PlatformDashboardSearchUseCase.MaxQueryLength;
                    }
                }
            }

            return Task.CompletedTask;
        });

        // GET /billing/plan (getCurrentPlan) is a faithful port of `db.subscription.findUnique`, which
        // returns the subscription OR top-level `null` when the org has none — so its 200 body is NULLABLE.
        // Produces<SubscriptionV1> emits a bare `$ref` (non-null); rewrite it to the SAME nullable-ref form
        // the generator uses elsewhere (oneOf: [{type:null},{$ref}], e.g. InvoiceDetailV1.subscription) so a
        // generated client models the legitimate `200 null`.
        options.AddOperationTransformer((operation, context, _) =>
        {
            if (context.Description.RelativePath == "billing/plan"
                && operation.Responses is not null
                && operation.Responses.TryGetValue("200", out var ok)
                && ok.Content is not null
                && ok.Content.TryGetValue("application/json", out var media))
            {
                media.Schema = new Microsoft.OpenApi.OpenApiSchema
                {
                    OneOf =
                    [
                        new Microsoft.OpenApi.OpenApiSchema { Type = Microsoft.OpenApi.JsonSchemaType.Null },
                        new Microsoft.OpenApi.OpenApiSchemaReference("SubscriptionV1"),
                    ],
                };
            }

            return Task.CompletedTask;
        });

        // GET /compensation/my-compensation (myCompensation) returns the caller's field-authed comp DTO OR
        // top-level `null` when they have no comp row — so its 200 body is NULLABLE. Produces<JsonObject>
        // emits a non-null object schema; rewrite to oneOf:[{null},{object}] so a generated client models the
        // legitimate `200 null` (review/Codex F4). The DTO is a dynamic field-authed object (no named ref).
        options.AddOperationTransformer((operation, context, _) =>
        {
            if (context.Description.RelativePath == "compensation/my-compensation"
                && operation.Responses is not null
                && operation.Responses.TryGetValue("200", out var ok)
                && ok.Content is not null
                && ok.Content.TryGetValue("application/json", out var media))
            {
                media.Schema = new Microsoft.OpenApi.OpenApiSchema
                {
                    OneOf =
                    [
                        new Microsoft.OpenApi.OpenApiSchema { Type = Microsoft.OpenApi.JsonSchemaType.Null },
                        new Microsoft.OpenApi.OpenApiSchema { Type = Microsoft.OpenApi.JsonSchemaType.Object },
                    ],
                };
            }

            return Task.CompletedTask;
        });
    });

    // CORS for the browser SPA (apps/web) calling this API directly. Explicit,
    // config-driven origins (Platform:AllowedCorsOrigins, comma-separated) — never a
    // wildcard. Empty ⇒ no browser origin is allowed (fail-safe; server-to-server callers
    // such as the parity harness send no Origin header and are unaffected). No
    // AllowCredentials: the browser client authenticates with a Bearer token +
    // credentials:'omit' (no cookies), so credentialed CORS is neither needed nor granted.
    const string BrowserCorsPolicyName = "BrowserCors";
    var corsOrigins = (platformSection[nameof(PlatformOptions.AllowedCorsOrigins)] ?? string.Empty)
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    builder.Services.AddCors(options =>
    {
        options.AddPolicy(BrowserCorsPolicyName, policy =>
        {
            if (corsOrigins.Length > 0)
            {
                policy.WithOrigins(corsOrigins)
                    .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                    .WithHeaders("Authorization", "Content-Type", "Accept");
            }
        });
    });

    var app = builder.Build();

    // #181 — strip the client-controlled `x-real-ip` before ANYTHING can read it. This is deliberately
    // the first middleware in the pipeline: both consumers of the trusted-IP rule (the rate limiter's
    // anonymous key and every audit writer) read the raw header, so the untrusted value has to be gone
    // before either runs. App Runner does not set or strip this header, so on this deployment it was
    // caller-supplied. See TrustedProxyHeaderMiddleware for why the fix is here and not in the shared
    // ClientIp kernel, which is pinned cross-stack.
    app.UseMiddleware<TrustedProxyHeaderMiddleware>();

    // CORS runs FIRST among the request-handling middlewares — an unauthenticated preflight (OPTIONS) is
    // answered by this middleware before it can reach authentication or the fail-closed rate limiter.
    app.UseCors(BrowserCorsPolicyName);

    app.UseAuthentication();

    // Principal resolution runs AFTER authentication and BEFORE rate limiting: it resolves the TIMS
    // principal ONCE (JWT `sub` → TenantContext via PrincipalResolver) and stashes it, so the limiter
    // keys authenticated staff/owner on the TIMS `users.id` (AI → `org:{orgId}`) — NOT the raw JWT
    // `sub` — matching the TS `ctx.user.id` surface, and the authz probes reuse it (dedupe).
    app.UseMiddleware<PrincipalResolutionMiddleware>();

    // #173 — authz_denied observer, the port of TS's OUTERMOST `withSecurityAudit`. Registered
    // immediately AFTER principal resolution and BEFORE everything that can deny, so on the way
    // back out it sees both the resolved tenant (to attribute the row) and the final 401/403 from
    // any gate below — every *StaffGate, every endpoint-written 403, and UseAuthorization's own
    // challenges. It writes nothing on success and never alters the response.
    //
    // CORRECTION (#182): an earlier version of this comment claimed it also sees "the rate limiter's
    // own rejections". It does not — RateLimitMiddleware returns 429, and this observer filters to
    // 401/403 only. TS records throttling under a distinct `rate_limit` action; there is no C#
    // counterpart, which is a real coverage gap rather than something this middleware already covers.
    // #181 — the one kill switch. DISABLED-phrased, not Enabled-phrased: this middleware is already
    // live, so a default-false `Enabled` flag would have silently switched off a live security control on
    // the next deploy. Absent or garbled ⇒ the control stays ON.
    // Resolved here rather than reusing the `externalOptions` local below — that one is declared further
    // down, after the middleware pipeline is built.
    var pipelineOptions = app.Services.GetRequiredService<IOptions<PlatformOptions>>().Value;
    if (SecurityDenialAuditMiddleware.IsDisabled(pipelineOptions.SecurityDenialAuditDisabled))
    {
        app.Logger.LogWarning(
            "SECURITY: Platform:SecurityDenialAuditDisabled is set — authz_denied audit rows are NOT being "
            + "written. This is an incident-response escape hatch, not a steady state.");
    }
    else
    {
        app.UseMiddleware<SecurityDenialAuditMiddleware>();
    }

    // Rate limiting runs AFTER principal resolution (so the resolved TIMS principal is available to
    // key the bucket) but BEFORE authorization/handlers. Infra + auth-probe paths are exempt inside
    // the middleware; the API-key per-key quota is enforced by ApiKeyRateLimitFilter post-auth.
    app.UseMiddleware<RateLimitMiddleware>();

    // #173 — MFA step-up, the port of TS's `withMfaEnforcement`. Registered AFTER the denial
    // observer so that observer sees this 403 and correctly SKIPS it: an MFA refusal is audited
    // distinctly as `mfa_step_up_required`, never as a generic `authz_denied` (observeDenial's
    // same carve-out). Fails OPEN on an unset/garbled Platform:MfaEnforced.
    //
    // #181 — moved to AFTER the rate limiter. It short-circuits on refusal, so registering it first
    // meant a refused caller never reached the limiter at all: a stolen aal1 super_admin token — the
    // exact thing this gate exists to neutralise — became an unmetered amplifier, one audit_logs
    // INSERT plus a principal-resolution DB read per request, at whatever rate the caller chose.
    // Still inside SecurityDenialAuditMiddleware, so the carve-out above is unaffected.
    app.UseMiddleware<MfaStepUpMiddleware>();

    app.UseAuthorization();

    app.UseSerilogRequestLogging(options =>
        options.EnrichDiagnosticContext = (diagnostic, httpContext) =>
            diagnostic.Set("TraceId", Activity.Current?.TraceId.ToString()));

    app.MapOpenApi();

    // Liveness: process is up and the pipeline responds. Runs no dependency checks.
    app.MapHealthChecks("/health", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
    {
        Predicate = _ => false,
    });

    // Readiness: dependency checks (DB + Redis). Degraded (e.g. Redis unconfigured) → 200;
    // Unhealthy (DB unreachable) → 503.
    app.MapHealthChecks("/ready", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
    {
        Predicate = check => check.Tags.Contains("ready"),
    });

    app.MapGet("/", () => Results.Ok(new { service = serviceName, status = "ok" }))
        .WithName("ServiceInfo");

    // Auth-infra probe (WP2.1): echoes the authenticated Supabase user id (`sub`). Requires a
    // valid JWT — the integration tests assert 401 for tampered/expired/wrong-aud/wrong-iss.
    // NOT a product endpoint; carries no tenant data (WP2.2 resolves that from `sub`).
    app.MapGet("/whoami", (System.Security.Claims.ClaimsPrincipal user) =>
            Results.Ok(new { sub = user.FindFirst("sub")?.Value }))
        .RequireAuthorization()
        .WithName("WhoAmI");

    // Auth-infra probe (WP2.3): the API-key analog of /whoami. Requires the ApiKey scheme (a valid
    // `tims_` key), echoing the resolved org id + parsed scopes. Integration tests assert 401 for a
    // revoked/expired/suspended-org/no-token/wrong-scheme credential. NOT a product endpoint.
    app.MapGet("/external-whoami", (System.Security.Claims.ClaimsPrincipal user) =>
            Results.Ok(new
            {
                organizationId = user.FindFirst(ApiKeyAuthenticationHandler.OrganizationIdClaimType)?.Value,
                scopes = user.FindAll(ApiKeyAuthenticationHandler.ScopeClaimType).Select(c => c.Value).ToArray(),
            }))
        .RequireAuthorization(ApiKeyAuthenticationHandler.SchemeName)
        // Per-key rate-limit quota (apikey:{id}), enforced AFTER the ApiKey scheme authenticates —
        // the C# analog of the TS per-key limit in requireApiKey (trpc.ts).
        .AddEndpointFilter<ApiKeyRateLimitFilter>()
        .WithName("ExternalWhoAmI");

    // --- Phase-5 strangler deploy gating (dark-by-default) ----------------------------
    // The external surfaces are mapped ONLY when their per-surface deploy flag is on, so deploying
    // Tims.Api activates NO second live reader/writer — TS stays the single active stack until Federico
    // flips the flag at canary. EXCEPTION: build-time OpenAPI document generation (GetDocument.Insider is
    // the process entry assembly) forces both mapped so the emitted contract stays accurate even while the
    // runtime default is dark; at real runtime the entry assembly is Tims.Api, so the flags fully govern.
    var externalOptions = app.Services.GetRequiredService<IOptions<PlatformOptions>>().Value;
    var isOpenApiDocGeneration =
        string.Equals(Assembly.GetEntryAssembly()?.GetName().Name, "GetDocument.Insider", StringComparison.Ordinal);

    // External-vendor assessment READ surface (Phase-5 Slice 1): GET /external/assessment-results (list,
    // cursor) + /external/assessment-results/{assignmentId} (getOne). ApiKey scheme + assessment:read
    // grant/scope + per-key rate limit; audits every exported row fail-closed. Dark unless the flag is on.
    if (externalOptions.ExternalVendorReadEnabled || isOpenApiDocGeneration)
    {
        app.MapExternalAssessmentEndpoints();
    }

    // External-vendor validation WRITE surface (Phase-5 Slice 2): POST
    // /external/validations/{validationId}/result. ApiKey scheme + validation:update grant +
    // validation:write scope (alwaysEnforce) + per-key rate limit; atomic pending-only update, fail-soft
    // audit. First C# product-table write. Dark unless the flag is on (deploy-gated cutover).
    if (externalOptions.ExternalVendorWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapExternalValidationEndpoints();
    }

    // Billing invoice READ surface (Phase-5 Slice 3): GET /billing/invoices (list, cursor) +
    // /billing/invoices/{id} (getInvoice). Supabase JWT scheme + billing:read grant (PermissionService);
    // reads run under the resolved org's TenantScope. First staff-JWT C# product surface. Dark unless the
    // flag is on (deploy-gated cutover; TS stays the sole active reader until Federico flips it).
    if (externalOptions.BillingReadEnabled || isOpenApiDocGeneration)
    {
        app.MapBillingReadEndpoints();
    }

    // Billing usage/plan/config READ surface (Phase-5 Slice 3b): GET /billing/usage (real counts +
    // entitled-plan limits), /billing/plan (getCurrentPlan — raw subscription or null), /billing/config
    // (getBillingConfig — Stripe config-presence predicate). Same Supabase JWT + billing:read gate as the
    // invoice reads. Dark unless the flag is on (deploy-gated cutover; TS stays the sole active reader).
    if (externalOptions.BillingUsageEnabled || isOpenApiDocGeneration)
    {
        app.MapBillingUsageEndpoints();
    }

    // Billing Stripe-webhook WRITE surface (Phase-5 Slice 4): POST /billing/webhooks/stripe. ANONYMOUS (the
    // Stripe signature over the raw body is the auth); the state-sync engine upserts subscriptions + mirrors
    // organizations.plan on the PRIVILEGED connection. First C# webhook + first privileged (non-TenantScope)
    // write. Dark unless the flag is on (deploy-gated cutover; the TS webhook stays the sole active writer).
    if (externalOptions.BillingWebhookWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapBillingWebhookEndpoints();
    }

    // Billing tenant SELF-SERVE WRITE surface (Phase-5 Slice 4b): POST /billing/checkout-session,
    // /billing/portal-session, /billing/cancel-subscription. Staff-JWT + billing:update gate; tenant-scoped
    // (Stripe outbound + customer-link CAS + fail-soft audit). Dark unless the flag is on (deploy-gated cutover;
    // TS stays the sole active self-serve path until Federico flips it).
    if (externalOptions.BillingSelfServeEnabled || isOpenApiDocGeneration)
    {
        app.MapBillingSelfServeEndpoints();
    }

    // Phase-5 Slice 5 (efcoreReadOnly): the recruitment-analytics reads (/reporting/*). Staff-JWT +
    // vacancy:read + organization/company scope (the org-rollup gate); reads are org-wide pipeline/offer
    // aggregates. Dark unless the flag is on (deploy-gated cutover; TS stays the sole active reader).
    if (externalOptions.ReportingReadEnabled || isOpenApiDocGeneration)
    {
        app.MapReportingReadEndpoints();
    }

    // Phase-5 (efcoreStranglerWrite): the staff pre-employment-validation write (PATCH /validations/{id}).
    // Staff-JWT + offer:update + the parent-offer IDOR probe. Dark unless the flag is on (deploy-gated cutover;
    // TS stays the sole active staff writer until Federico flips it — completing this makes the table flip-ready).
    if (externalOptions.ValidationStaffWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapStaffValidationEndpoints();
    }

    // Team-intel READ surface (Phase-5 Slice 6): GET /team-intel/teams/{id}/{profile|members|balance-score|
    // balance-alerts|recommended-hires}, /team-intel/compare, /team-intel/dashboard-kpis. Staff-JWT +
    // team_intel:read; the by-id reads run the assertScoped('team') IDOR probe (first live scope-probe on a
    // READ path), compare composes scopeWhereFor('team'), dashboard-kpis applies the org-gate. Dark unless the
    // flag is on (deploy-gated cutover; TS stays the sole active reader until Federico flips it).
    if (externalOptions.TeamIntelReadEnabled || isOpenApiDocGeneration)
    {
        app.MapTeamIntelReadEndpoints();
    }

    // Monitoring READ surface (Phase-5 Q0b slice 1, issue #100): GET /monitoring/{executive-kpis|
    // module-health|alerts|action-plan-alerts|cross-module-trend|alert-rules}. Staff-JWT +
    // monitoring:read; action-plan-alerts composes scopeWhereFor('actionPlan') as a row filter, the
    // other five are org-wide (TS parity — the live reader applies no org-gate here). Dark unless the
    // flag is on (deploy-gated cutover; TS stays the sole active reader until Federico flips it).
    if (externalOptions.MonitoringReadEnabled || isOpenApiDocGeneration)
    {
        app.MapMonitoringReadEndpoints();
    }

    if (externalOptions.PlatformOrganizationsReadEnabled || isOpenApiDocGeneration)
    {
        app.MapPlatformOrganizationsReadEndpoints();
    }

    // Phase-5 slice 22 (#75): GET /platform/invitations{,/kpis,/export} — the platform-owner invitations
    // READ surface. Three of that router's ten procedures; the other seven are out for three distinct
    // reasons (writes / unauthenticated token endpoints / no email capability in this service) — see
    // PlatformOptions.PlatformInvitationsReadEnabled. Dark unless the flag is on.
    if (externalOptions.PlatformInvitationsReadEnabled || isOpenApiDocGeneration)
    {
        app.MapPlatformInvitationsReadEndpoints();
    }

    // Phase-5 slice 23 (#81): GET /platform/dashboard/{plan-distribution,user-growth,
    // recent-activity,attention-items,mrr-trend,mrr-forecast,customer-health,upsell-opportunities,search}
    // — the FX-free tier — plus PR 3's {kpis,revenue-by-customer,churn-risk}, the three sumMoney callers,
    // plus ai-cost-anomalies, the thirteenth and final read. ALL THIRTEEN of the cluster's reads are now
    // ported — see PlatformOptions.PlatformDashboardReadEnabled. ONE flag covers all thirteen, so a canary
    // flip exposes the whole ported cluster at once. Dark unless it is on.
    //
    // PR 3's three are the only dashboard routes that can answer 503: they resolve an fx_rates pin before
    // any arithmetic, and a missing pin fails the request rather than emitting a partially-converted total
    // (TS's getFxRate throws; see PlatformDashboardFxResultKind).
    if (externalOptions.PlatformDashboardReadEnabled || isOpenApiDocGeneration)
    {
        app.MapPlatformDashboardReadEndpoints();
        app.MapPlatformDashboardFxReadEndpoints();
        app.MapPlatformDashboardAiReadEndpoints();
    }

    // Phase-5 slice 20 (#76): PATCH /platform/organizations/{id} + POST /platform/organizations/{id}/suspend.
    // This flag IS the one-active-writer control for `organizations` (efcoreStranglerWrite) — with it off the
    // routes are never mapped and TS is the sole writer.
    if (externalOptions.PlatformOrganizationsWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapPlatformOrganizationsWriteEndpoints();
    }

    // Phase-5 slice 21 (#76): POST /platform/organizations — the 7-table provisioning create.
    // This flag IS the one-active-writer control for the six provisioned tables; with it off the route is
    // never mapped and TS is the sole writer.
    if (externalOptions.PlatformOrganizationsCreateEnabled || isOpenApiDocGeneration)
    {
        app.MapPlatformOrganizationsCreateEndpoints();
    }

    // §8 Q0b slice 2 / issue #172: GET /internal/alert-metrics — the cross-org metric read for the
    // alert-evaluation cron (active_surveys → flip #64, pending_salary_adjustments → flip #66). NOT a staff
    // surface: it is anonymous to the auth schemes and authenticated by the cron secret in the handler, so
    // no tenant JWT reaches it. Dark unless the flag is on (deploy-gated cutover; TS stays the sole active
    // reader until Federico flips it). With the flag off the route is never mapped and 404s.
    if (externalOptions.AlertMetricsCronReadEnabled || isOpenApiDocGeneration)
    {
        app.MapAlertMetricsEndpoints();
    }

    // Evaluation360 READ surface (Phase-5 Slice 7): GET /evaluation360/cycles + /cycles/{id}/progress (STAFF:
    // evaluation360:read + organization/company org-gate, Codex F3), and /evaluation360/my/rater-tasks,
    // /my/reports/{cycleId}, /my/report-cycles (SELF-SERVICE: identity-anchored — any resolved principal, NO
    // grant, NO scope — hard-filtered on the caller's own user id). Dark unless the flag is on (deploy-gated
    // cutover; TS stays the sole active reader until Federico flips it).
    if (externalOptions.Evaluation360ReadEnabled || isOpenApiDocGeneration)
    {
        app.MapEvaluation360ReadEndpoints();
    }

    // Evaluation360 WRITE surface (Phase-5 Slice 13): POST /evaluation360/cycles (createCycle) +
    // /cycles/{id}/open|close|publish (the three guarded transitions, count-0 ⇒ 409) + /cycles/{id}/raters
    // (assignRaters — in-tx status re-check + org-membership validation + skipDuplicates ON CONFLICT insert), all
    // STAFF (evaluation360:create/update + org-gate), plus /assignments/{id}/ratings (submitRatings — SELF-SERVICE,
    // IDENTITY-anchored on rater_user_id = caller so an org-admin cannot forge another rater's feedback → 404; atomic
    // claim-idempotency + the 6 rater_responses insert). The WRITE port completing the evaluation360 domain. Dark
    // unless the flag is on (deploy-gated cutover; TS stays the sole active writer until Federico flips it).
    if (externalOptions.Evaluation360WriteEnabled || isOpenApiDocGeneration)
    {
        app.MapEvaluation360WriteEndpoints();
    }

    // Succession READ surface (Phase-5 Slice 8): the nine succession reads (/succession/*). Staff-JWT +
    // succession:read; exercises ALL THREE scope mechanics (scopeWhereFor row filter, assertScoped('criticalRole')
    // by-id IDOR probe, requireOrgScope org-rollup). getCompGapAlerts adds a secondary compensation:read grant +
    // fail-closed audit of exposed comp rows. Dark unless the flag is on (deploy-gated cutover; TS stays the sole
    // active reader until Federico flips it).
    if (externalOptions.SuccessionReadEnabled || isOpenApiDocGeneration)
    {
        app.MapSuccessionReadEndpoints();
    }

    // Succession WRITE surface (Phase-5 Slice 14): the 5 succession writes — POST /succession/critical-roles
    // (addCriticalRole, requireOrgScope), POST /succession/critical-roles/{id}/successors (addSuccessor,
    // assertScoped('criticalRole') → 404 THEN assertSubjectInScope(userId) → 403; dedup @@unique → 409),
    // DELETE /succession/successors/{id} (removeSuccessor, assertScoped('successor') → 404), PATCH
    // /succession/successors/{id}/readiness (updateSuccessorReadiness, assertScoped('successor') → 404), PATCH
    // /succession/critical-roles/{id}/band (updateCriticalRoleBand, assertScoped('criticalRole') → 404). Staff-JWT +
    // succession:create/update/delete; addSuccessor stamps addedById = caller. The WRITE port completing the
    // succession domain (FLIP-READY). Dark unless the flag is on (deploy-gated cutover; TS stays the sole active
    // writer until Federico flips it).
    if (externalOptions.SuccessionWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapSuccessionWriteEndpoints();
    }

    // Compensation READ surface (Phase-5 Slice 9, FX-free subset): the seven FX-free compensation reads
    // (/compensation/*). Staff-JWT + compensation:read. getSalaryBands/getMarketComparison are grant-only;
    // getBenefitsUtilization/getCompaRatioDistribution apply the org-gate (F3); listPendingAdjustments composes
    // scopeWhereFor('salaryAdjustment') + selectFor + fail-closed audit; getEmployeeComp does assertSubjectInScope
    // + selectFor + audit; myCompensation is own-pinned. The five FX reads + two writes stay on TS. Dark unless the
    // flag is on (deploy-gated cutover; TS stays the sole active reader until Federico flips it).
    if (externalOptions.CompensationReadEnabled || isOpenApiDocGeneration)
    {
        app.MapCompensationReadEndpoints();
    }

    // Compensation WRITE surface (Phase-5 Slice 12): POST /compensation/adjustments (createAdjustment) +
    // /compensation/adjustments/{id}/approve (approveAdjustment). Staff-JWT + compensation:create / :approve;
    // createAdjustment assertSubjectInScope's the target userId, approveAdjustment runs the
    // assertScoped('salaryAdjustment') by-id probe + a fail-closed audit BEFORE the atomic conditional
    // transaction (pending-only transition → count-0 CONFLICT, then the comp propagation). The FIRST compensation
    // WRITE port. Dark unless the flag is on (deploy-gated cutover; TS stays the sole active writer).
    if (externalOptions.CompensationWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapCompensationWriteEndpoints();
    }

    // Nine-box READ surface (Phase-5 Slice 10): the eleven nine-box reads (/ninebox/*). Staff-JWT +
    // ninebox:read. getGrid/getMovementHistory compose scopeWhereFor('nineBoxEvaluation') (out-of-scope rows
    // drop; teamId/unitId/companyId only intersect); getEmployeeDetail/getAxisBreakdown do assertSubjectInScope
    // (out-of-set → 403); listCalibrations/getBenchStrength/getDashboardKpis apply the org-gate (F3);
    // getCalibration hand-rolls the committee-membership gate (org/company → any; narrow → created-by OR member,
    // 404/403); myCalibrations the created-by-OR-member self list; simulate/getQuadrantPlan are grant-only PURE.
    // Dark unless the flag is on (deploy-gated cutover; TS stays the sole active reader until Federico flips it).
    if (externalOptions.NineBoxReadEnabled || isOpenApiDocGeneration)
    {
        app.MapNineBoxReadEndpoints();
    }

    // Nine-box calibration WRITE surface (Phase-5 Slice 15): the 5 calibration writes — POST /ninebox/calibrations
    // (createCalibration, requireOrgScope), POST /ninebox/calibrations/{sessionId}/votes (submitCalibrationVote,
    // MEMBERSHIP+IDENTITY — session→404, non-member voter→403, evaluatedUser→404; voter = caller), POST
    // /ninebox/calibrations/{sessionId}/members (addCalibrationMember, requireOrgScope; dup→409), DELETE
    // /ninebox/calibrations/{sessionId}/members/{userId} (removeCalibrationMember, requireOrgScope; count-0→404),
    // POST /ninebox/calibrations/{sessionId}/finalize (finalizeCalibration, requireOrgScope; count-0→404). Staff-JWT +
    // ninebox:create/update; createCalibration validates every memberId in-org (cross-tenant hardening→400). The WRITE
    // port completing the nine-box domain (FLIP-READY). Dark unless the flag is on (deploy-gated cutover; TS stays the
    // sole active writer until Federico flips it).
    if (externalOptions.NineBoxWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapNineBoxWriteEndpoints();
    }

    // Phase-5 Slice 11 (efcoreReadOnly): the engagement READ surface (14 reads). Staff-JWT + engagement:read; the
    // 9 org-rollup aggregates apply the org-gate (narrow → 403), listActionPlans/listLeaderCommitments compose
    // scopeWhereFor (out-of-scope rows drop), myPendingSurveys/getSurveyForResponse are OWN identity-anchored (no
    // org-gate), listSurveys is grant-only + per-item min-5. Dark unless the flag is on (deploy-gated cutover; TS
    // stays the sole active reader until Federico flips it).
    if (externalOptions.EngagementReadEnabled || isOpenApiDocGeneration)
    {
        app.MapEngagementReadEndpoints();
    }

    // Phase-5 Slice 16 (efcoreStranglerWrite): the engagement WRITE surface (5 writes) — POST /engagement/surveys
    // (createSurvey, grant-only), POST /engagement/surveys/{id}/activate (activateSurvey, grant-only; missing → 404),
    // POST /engagement/surveys/{id}/responses (submitSurveyResponse, IDENTITY-anchored userId = caller, NO org-gate;
    // survey inactive → 404, dedup → 409), POST /engagement/action-plans (createActionPlan, assertSubjectInScope +
    // H1 → 403), PATCH /engagement/action-plans/{id} (updateActionPlan, assertScoped('actionPlan') → 404 THEN
    // assertSubjectInScope + H1 on reassignment → 403). Staff-JWT + engagement:create/update. The WRITE port
    // completing the engagement domain. Dark unless the flag is on (deploy-gated cutover; TS stays the sole active
    // writer until Federico flips it).
    if (externalOptions.EngagementWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapEngagementWriteEndpoints();
    }

    // Phase-5 Slice 11b (efcoreReadOnly): the DEI READ surface (10 reads). Staff-JWT + dei:read (GRANT-ONLY — no
    // org-gate; k-anonymity is the disclosure control). The demographic group-bys materialize the three native
    // Prisma enums via the enum-mapped data source. Dark unless the flag is on (deploy-gated cutover; TS stays the
    // sole active reader until Federico flips it). getPayEquity (FX) → Slice 11c.
    if (externalOptions.DeiReadEnabled || isOpenApiDocGeneration)
    {
        app.MapDeiReadEndpoints();
    }

    // Phase-5 Slice 11c: the FX-derived reads (dei.getPayEquity + the five compensation FX reads), gated on
    // their OWN flag. (The original note here — "they canary AFTER the FxRefreshJob first populates
    // fx_rates" — described the design; in reality FxSeedOnce populated once, the flag went live 2026-07-31,
    // and the refresh never ran. See PlatformOptions.FxRefreshEnabled for the incident + fix.)
    if (externalOptions.FxReadsEnabled || isOpenApiDocGeneration)
    {
        app.MapDeiPayEquityEndpoint();
        app.MapCompensationFxReadEndpoints();
    }

    // Cross-org audit-log READ surface (Phase-5 Slice 17): GET /audit/logs (getCrossOrgAuditLogs,
    // cursor-paginated) + /audit/logs/export (exportAuditLogsCsv, csv|json). Platform-owner-only
    // (PlatformOwnerGate — NO permission grant, NO tenant scope; the reader runs OUTSIDE TenantScope/RLS
    // by design). Dark unless the flag is on (deploy-gated cutover; TS stays the sole active reader
    // until Federico flips it).
    if (externalOptions.AuditLogReadEnabled || isOpenApiDocGeneration)
    {
        app.MapAuditReadEndpoints();
    }

    // Access-review READ surface (Phase-5 Slice 18): GET /access-review (getAccessReview),
    // /access-review/export (exportAccessReviewCsv), /access-review/attestations
    // (listAccessReviewAttestations). Platform-owner-only, org-scoped (required organizationId, NOT
    // RLS). Dark unless the flag is on.
    if (externalOptions.AccessReviewReadEnabled || isOpenApiDocGeneration)
    {
        app.MapAccessReviewReadEndpoints();
    }

    // Access-review WRITE surface (Phase-5 Slice 18): POST /access-review/attest. The FIRST C# write
    // to access_reviews. Dark unless the flag is on (separate from the read flag for independent
    // canary control).
    if (externalOptions.AccessReviewWriteEnabled || isOpenApiDocGeneration)
    {
        app.MapAccessReviewWriteEndpoints();
    }

    // Authz probe (WP2.5): the C# equivalent of the tRPC `requirePermission` gate. Resolves the
    // TIMS principal from the JWT `sub` (PrincipalResolver, honoring the impersonation cookie +
    // secret), runs PermissionService.CheckAsync, and returns 200 { allowed, scope } if allowed,
    // else 403. NOT a product endpoint — it proves the end-to-end JWT → principal → authz wiring.
    app.MapGet("/require-permission/{module}/{action}", async (
            string module,
            string action,
            ClaimsPrincipal user,
            HttpContext httpContext,
            PrincipalResolver principalResolver,
            PermissionService permissionService,
            IOptions<PlatformOptions> platformOptions,
            CancellationToken cancellationToken) =>
        {
            var context = await ResolvePrincipalAsync(
                user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
            if (context is null)
            {
                // Valid signed JWT but `sub` is not a resolvable active staff/owner row (candidate
                // session, deactivated/unprovisioned user) — this is `ctx.user === null` in the TS
                // context, i.e. UNAUTHORIZED (401), distinct from a resolved-but-denied 403.
                return Results.StatusCode(StatusCodes.Status401Unauthorized);
            }

            try
            {
                var decision = await permissionService.CheckAsync(context, module, action, cancellationToken);
                return decision.Allowed
                    ? Results.Ok(new { allowed = true, scope = decision.Scope?.ToWire() })
                    : Results.StatusCode(StatusCodes.Status403Forbidden);
            }
            catch (TenantOrgRequiredException)
            {
                // Privileged principal with no org on a tenant module — the TS kernel raises
                // BAD_REQUEST here rather than running unscoped.
                return Results.BadRequest(new { error = "organization_required" });
            }
        })
        .RequireAuthorization()
        .WithName("RequirePermission");

    // Authz probe (WP2.5): the org-rollup gate — the C# equivalent of `requireOrgScope`. Same
    // principal resolution + permission check, then RequireOrgScopeSatisfied: a narrow scope on
    // an org-rollup endpoint is FORBIDDEN (403); only organization/company scope passes.
    app.MapGet("/require-org-scope/{module}/{action}", async (
            string module,
            string action,
            ClaimsPrincipal user,
            HttpContext httpContext,
            PrincipalResolver principalResolver,
            PermissionService permissionService,
            IOptions<PlatformOptions> platformOptions,
            CancellationToken cancellationToken) =>
        {
            var context = await ResolvePrincipalAsync(
                user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
            if (context is null)
            {
                // Valid signed JWT but `sub` is not a resolvable active staff/owner row (candidate
                // session, deactivated/unprovisioned user) — this is `ctx.user === null` in the TS
                // context, i.e. UNAUTHORIZED (401), distinct from a resolved-but-denied 403.
                return Results.StatusCode(StatusCodes.Status401Unauthorized);
            }

            try
            {
                var decision = await permissionService.CheckAsync(context, module, action, cancellationToken);
                return decision is { Allowed: true, Scope: { } scope } && OrgGate.RequireOrgScopeSatisfied(scope)
                    ? Results.Ok(new { allowed = true, scope = scope.ToWire() })
                    : Results.StatusCode(StatusCodes.Status403Forbidden);
            }
            catch (TenantOrgRequiredException)
            {
                return Results.BadRequest(new { error = "organization_required" });
            }
        })
        .RequireAuthorization()
        .WithName("RequireOrgScope");

    // Shared principal resolution for the authz probes: JWT `sub` → TenantContext (or null when the
    // caller is not resolvable staff). Honors the platform-owner impersonation cookie + secret.
    // Reuses the principal already resolved by PrincipalResolutionMiddleware (stashed in
    // HttpContext.Items) to avoid a second DB round-trip; falls back to resolving here if absent
    // (e.g. a path the middleware exempts), staying robust.
    static async Task<TenantContext?> ResolvePrincipalAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal resolvedPrincipal)
        {
            return resolvedPrincipal.Context;
        }

        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub))
        {
            return null;
        }

        var resolution = await principalResolver.ResolveStaffAsync(
            sub,
            httpContext.Request.Headers.Cookie.ToString(),
            options.ImpersonationSecret,
            DateTime.UtcNow,
            cancellationToken);

        return resolution is { Resolved: true, Context: { } context } ? context : null;
    }

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Tims.Platform host terminated unexpectedly during startup");
    throw;
}
finally
{
    Log.CloseAndFlush();
}

/// <summary>
/// Exposed so the integration test host references it — <see cref="Tims.IntegrationTests"/>
/// ApiSmokeTests boots this exact host via WebApplicationFactory&lt;Program&gt; to assert
/// /health, /ready, config fail-fast, and the OpenAPI document.
/// </summary>
public partial class Program;
