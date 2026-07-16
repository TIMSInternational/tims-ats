using System.Diagnostics;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog;
using Serilog.Formatting.Compact;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Api.HealthChecks;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Infrastructure.Identity;

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
    builder.Host.UseSerilog((context, services, configuration) => configuration
        .ReadFrom.Configuration(context.Configuration)
        .ReadFrom.Services(services)
        .WriteTo.Console(new RenderedCompactJsonFormatter()));

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
    builder.Services.AddScoped<PrincipalResolver>();
    builder.Services.AddScoped<IPermissionGrantRepository, PermissionGrantRepository>();
    builder.Services.AddScoped<PermissionService>();
    builder.Services.AddSingleton<IPermissionCache, NullPermissionCache>();

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

    // --- OpenAPI (emitted to contracts/openapi at build; served at /openapi/v1.json) --
    builder.Services.AddOpenApi();

    var app = builder.Build();

    app.UseAuthentication();
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
        .WithName("ExternalWhoAmI");

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
    static async Task<TenantContext?> ResolvePrincipalAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
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
