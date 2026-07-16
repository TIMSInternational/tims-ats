using System.ComponentModel.DataAnnotations;

namespace Tims.Workers;

/// <summary>
/// The worker host's narrow view of the shared "Platform" config section — the subset the scheduler host
/// actually needs (service name, DB connection string, OTLP endpoint). It is a DELIBERATE mirror, not a
/// reference to <c>Tims.Api.Configuration.PlatformOptions</c>: the clean-architecture rule forbids
/// Tims.Workers referencing Tims.Api (ArchitectureTests pins Workers → [Application, Infrastructure]), and
/// the host has no need for the API-only knobs (Supabase JWT, Redis, impersonation). Bound + validated at
/// startup (ValidateDataAnnotations + ValidateOnStart) exactly like the Api — the Zod-env-gate analog: a
/// missing DB connection string fails the process FAST at boot, never at first job fire.
/// </summary>
public sealed class PlatformOptions
{
    public const string SectionName = "Platform";

    /// <summary>Human-readable service name (OTel resource, logs).</summary>
    [Required]
    public string ServiceName { get; init; } = "tims-workers";

    /// <summary>
    /// Postgres connection string for the platform DB. Required — absence fails startup. Used by the
    /// readiness probe and (via the HRIS DI plane) the sync job's EF contexts.
    /// </summary>
    [Required]
    public string DatabaseConnectionString { get; init; } = string.Empty;

    /// <summary>
    /// OTLP exporter endpoint for traces + metrics. Optional: when absent, telemetry is still produced
    /// but not exported (no-op exporter), mirroring the Api.
    /// </summary>
    public string? OtlpEndpoint { get; init; }
}
