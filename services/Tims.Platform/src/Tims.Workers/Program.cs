using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Quartz;
using Serilog;
using Serilog.Formatting.Compact;
using Tims.Application.Audit;
using Tims.Application.Fx;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.Fx;
using Tims.Infrastructure.Hris;
using Tims.Workers;
using Tims.Workers.Fx;
using Tims.Workers.HealthChecks;
using Tims.Workers.Hris;
using Tims.Workers.Jobs;
using Tims.Workers.Scheduling;

// Two-stage Serilog init: a bootstrap logger captures failures during host build (including
// config-validation failures), then the full logger is swapped in. Mirrors Tims.Api.
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // --- Structured JSON logging (Pino-parity). NEVER logs job payloads / secrets / PII. --------
    // preserveStaticLogger: the host's DI logger is its OWN, so building it never re-freezes the shared
    // process-wide static Log.Logger (the bootstrap logger above stays live for the try/catch below). This
    // keeps the host safe to boot alongside others in one process — e.g. the integration suite booting the
    // worker host concurrently with the API host, which would otherwise race on the static "already frozen".
    builder.Host.UseSerilog(
        (context, services, configuration) => configuration
            .ReadFrom.Configuration(context.Configuration)
            .ReadFrom.Services(services)
            .WriteTo.Console(new RenderedCompactJsonFormatter()),
        preserveStaticLogger: true);

    // --- Config: bind + validate at startup (fail-fast), the Zod-env-gate analog ----------------
    builder.Services
        .AddOptions<PlatformOptions>()
        .Bind(builder.Configuration.GetSection(PlatformOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();
    builder.Services
        .AddOptions<WorkerOptions>()
        .Bind(builder.Configuration.GetSection(WorkerOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();
    builder.Services
        .AddOptions<HrisOptions>()
        .Bind(builder.Configuration.GetSection(HrisOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();
    builder.Services
        .AddOptions<FxOptions>()
        .Bind(builder.Configuration.GetSection(FxOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();

    // Read the bootstrap values raw (before Build()): OTel resource/exporter and the Quartz schedule
    // must be wired at registration time. ValidateOnStart above still guards the runtime-critical values.
    var platformSection = builder.Configuration.GetSection(PlatformOptions.SectionName);
    var serviceName = platformSection[nameof(PlatformOptions.ServiceName)] ?? "tims-workers";
    var otlpEndpoint = platformSection[nameof(PlatformOptions.OtlpEndpoint)];
    var databaseConnectionString = platformSection[nameof(PlatformOptions.DatabaseConnectionString)];
    var workerOptions = builder.Configuration.GetSection(WorkerOptions.SectionName).Get<WorkerOptions>()
        ?? new WorkerOptions();

    // --- OpenTelemetry: worker job spans + Npgsql DB spans; job metrics on the "Tims.Workers" meter --
    builder.Services.AddOpenTelemetry()
        .ConfigureResource(resource => resource.AddService(serviceName))
        .WithTracing(tracing =>
        {
            tracing.AddSource(ResilientJobRunner.ActivitySourceName); // worker job spans
            tracing.AddSource("Npgsql"); // Npgsql's built-in ActivitySource → DB command spans
            if (!string.IsNullOrWhiteSpace(otlpEndpoint))
            {
                tracing.AddOtlpExporter(exporter => exporter.Endpoint = new Uri(otlpEndpoint));
            }
        })
        .WithMetrics(metrics =>
        {
            metrics.AddMeter(JobMetrics.MeterName);
            if (!string.IsNullOrWhiteSpace(otlpEndpoint))
            {
                metrics.AddOtlpExporter(exporter => exporter.Endpoint = new Uri(otlpEndpoint));
            }
        });

    // --- HRIS DI plane (copied from Tims.Api Program.cs) ----------------------------------------
    // The sweep reads connectors on the PRIVILEGED owner connection and writes per-org UNDER TenantScope
    // (RLS). AddDbContext is lazy, so a placeholder connection string never blocks startup.
    builder.Services.AddDbContext<HrisDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddDbContext<DataAccessAuditDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddScoped<IDataAccessAuditor, DataAccessAuditWriter>();
    builder.Services.AddHrisConnectors();
    builder.Services.AddHrisSyncWorker();

    // --- FX gateway plane (Slice 11c): the daily refresh job pins ExchangeRate-API rates into fx_rates ------
    // (originally Frankfurter/ECB; swapped 2026-07-28 — see
    // docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md, Frankfurter never supported COP/CRC).
    // The global RLS-exempt FxRateDbContext writes on the PRIVILEGED/owner connection (no TenantScope). The
    // typed client + Polly resilience is AddFxRateGateway; the write repo + use case are scoped so
    // Quartz's per-fire DI scope resolves them fresh. AddDbContext is lazy — a placeholder conn never blocks boot.
    builder.Services.AddDbContext<FxRateDbContext>(options => options.UseNpgsql(databaseConnectionString));
    builder.Services.AddFxRateGateway();
    builder.Services.AddScoped<IFxRateWriteRepository, FxRateWriteRepository>();
    builder.Services.AddScoped<RefreshFxRatesUseCase>();
    builder.Services.AddScoped<FxRefreshJob>();
    // Scoped so Quartz's Microsoft-DI job factory resolves it (and its scoped sweep) from the per-fire scope.
    builder.Services.AddScoped<FxRefreshQuartzJob>();

    // --- Resilient-job framework ----------------------------------------------------------------
    builder.Services.AddSingleton<IJobFailureAlerter, LogOnlyJobFailureAlerter>();
    builder.Services.AddScoped(serviceProvider =>
    {
        var options = serviceProvider.GetRequiredService<IOptions<WorkerOptions>>().Value;
        return new ResilientJobRunner(
            serviceProvider.GetRequiredService<ILogger<ResilientJobRunner>>(),
            serviceProvider.GetRequiredService<IJobFailureAlerter>(),
            options.JobMaxAttempts,
            ResilientJobRunner.ExponentialBackoff(TimeSpan.FromMilliseconds(options.JobBaseRetryDelayMilliseconds)));
    });
    // Scoped so Quartz's Microsoft-DI job factory resolves it (and its scoped sweep) from the per-fire scope.
    builder.Services.AddScoped<HrisSyncQuartzJob>();

    // --- Quartz scheduler -----------------------------------------------------------------------
    // Quartz.Extensions.Hosting's job factory creates a DI scope PER job execution, so scoped deps
    // resolve per-fire. WaitForJobsToComplete lets an in-flight sweep finish on graceful shutdown.
    // ApplyPersistentStore switches to the CLUSTERED Postgres ADO store for multi-replica HA when
    // Workers:ClusteredSchedulerEnabled is true; otherwise the default in-memory RAMJobStore (which
    // requires the scheduler to be pinned to a single replica) is used. Configure registers the jobs.
    builder.Services.AddQuartz(quartz =>
    {
        QuartzScheduleBuilder.ApplyPersistentStore(quartz, workerOptions, databaseConnectionString);
        QuartzScheduleBuilder.Configure(quartz, workerOptions);
    });
    builder.Services.AddQuartzHostedService(options => options.WaitForJobsToComplete = true);

    // --- Health / readiness ---------------------------------------------------------------------
    builder.Services.AddHealthChecks()
        .AddCheck<WorkerReadinessHealthCheck>("postgres", tags: ["ready"]);

    var app = builder.Build();

    app.UseSerilogRequestLogging();

    // Liveness: process is up and the pipeline responds. Runs NO dependency checks (App Runner/Fargate
    // health check). Must NOT touch the DB.
    app.MapHealthChecks("/health", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
    {
        Predicate = _ => false,
    });

    // Readiness: the scheduler needs the DB → a cheap Postgres ping. Unreachable DB → 503.
    app.MapHealthChecks("/ready", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
    {
        Predicate = check => check.Tags.Contains("ready"),
    });

    app.MapGet("/", () => Results.Ok(new { service = serviceName, status = "ok" }))
        .WithName("ServiceInfo");

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Tims.Workers host terminated unexpectedly during startup");
    throw;
}
finally
{
    Log.CloseAndFlush();
}
