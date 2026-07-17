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
using Tims.Api.Authentication;
using Tims.Api.Billing;
using Tims.Api.Configuration;
using Tims.Api.HealthChecks;
using Tims.Api.RateLimiting;
using Tims.Api.ExternalVendor;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Application.Billing;
using Tims.Application.ExternalVendor;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Billing;
using Tims.Domain.Identity;
using Tims.Infrastructure.Access;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.Billing;
using Tims.Infrastructure.ExternalVendor;
using Tims.Infrastructure.Hris;
using Tims.Infrastructure.Identity;
using Tims.Infrastructure.RateLimiting;

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
    builder.Services.AddDbContext<ExternalAssessmentDbContext>(options => options.UseNpgsql(databaseConnectionString));
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
                options.MetadataAddress = jwksMetadataAddress;
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
                // Pin the asymmetric algorithm Supabase signs with — closes alg-confusion
                // (a token forged with alg=HS256/none can never be accepted).
                ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
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
    });

    var app = builder.Build();

    app.UseAuthentication();

    // Principal resolution runs AFTER authentication and BEFORE rate limiting: it resolves the TIMS
    // principal ONCE (JWT `sub` → TenantContext via PrincipalResolver) and stashes it, so the limiter
    // keys authenticated staff/owner on the TIMS `users.id` (AI → `org:{orgId}`) — NOT the raw JWT
    // `sub` — matching the TS `ctx.user.id` surface, and the authz probes reuse it (dedupe).
    app.UseMiddleware<PrincipalResolutionMiddleware>();

    // Rate limiting runs AFTER principal resolution (so the resolved TIMS principal is available to
    // key the bucket) but BEFORE authorization/handlers. Infra + auth-probe paths are exempt inside
    // the middleware; the API-key per-key quota is enforced by ApiKeyRateLimitFilter post-auth.
    app.UseMiddleware<RateLimitMiddleware>();

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
