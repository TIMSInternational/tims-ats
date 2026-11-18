using Sentry.AspNetCore;
using Sentry.Extensibility;
using Sentry.Serilog;
using Serilog;
using Serilog.Events;

namespace Tims.Api.ErrorReporting;

/// <summary>
/// Error reporting to Sentry, OFF unless a DSN is configured (<c>Sentry:Dsn</c>, i.e. the <c>Sentry__Dsn</c>
/// environment variable). With no DSN nothing is registered: no SDK, no middleware, no Serilog sink, no network.
/// </summary>
/// <remarks>
/// <para>
/// Two halves, both gated on the same DSN check:
/// <list type="bullet">
/// <item><see cref="AddErrorReporting"/> — <c>UseSentry</c> on the web host: initialises the SDK when the host is
/// built and pushes a per-request scope, so an event raised inside a request carries the (scrubbed) request.</item>
/// <item><see cref="WriteToErrorReporting"/> — the Serilog sink, which turns Error/Fatal log events into Sentry
/// events. This is what actually reports most failures here: Serilog replaces the logger factory (so Sentry's own
/// logging provider never sees a log line), <c>SecurityHeadersMiddleware</c> turns an unhandled request exception
/// into a logged 500 outside Development (so it never reaches Sentry's middleware), and the hosted services catch,
/// log and retry rather than throw.</item>
/// </list>
/// </para>
/// <para>
/// Privacy (rule: api-security.md §Observability): errors only (no Sentry logs, no sessions), <c>SendDefaultPii</c>
/// off, request bodies never read, outbound
/// <c>HttpClient</c> calls are left untouched (no trace headers added to third-party requests, no failed-request
/// events), and every payload passes <see cref="SentryPayloadScrubber"/>. Tracing stays off unless
/// <c>Sentry:TracesSampleRate</c> is set.
/// </para>
/// <para>
/// Environment: <c>Sentry:Environment</c> if set, otherwise the host environment lower-cased by the SDK
/// (<c>production</c> on App Runner). Release: <c>Sentry:Release</c> if set, otherwise <c>SENTRY_RELEASE</c>, which
/// the container image bakes in from the deployed commit SHA (Dockerfile <c>SOURCE_COMMIT</c> build argument).
/// </para>
/// </remarks>
public static class ErrorReportingExtensions
{
    public const string SectionName = "Sentry";
    public const string DsnKey = SectionName + ":Dsn";

    /// <summary>True when a non-blank DSN is configured. The single on/off switch for both halves.</summary>
    public static bool IsEnabled(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        return !string.IsNullOrWhiteSpace(configuration[DsnKey]);
    }

    /// <summary>
    /// Registers the Sentry ASP.NET Core integration when a DSN is configured; otherwise does nothing. A DSN that is
    /// set but malformed fails startup (the repo's config fail-fast convention) with a message that never echoes it.
    /// </summary>
    public static WebApplicationBuilder AddErrorReporting(this WebApplicationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        if (!IsEnabled(builder.Configuration))
        {
            return builder;
        }

        // Trimmed: a secret pasted with a trailing newline must not turn into a startup failure.
        var dsn = builder.Configuration[DsnKey]!.Trim();
        if (!IsWellFormedDsn(dsn))
        {
            throw new InvalidOperationException(
                $"{DsnKey} is set but is not a valid Sentry DSN (expected https://<public key>@<host>/<project id>). "
                + "Unset it to run without error reporting.");
        }

        builder.WebHost.UseSentry(options =>
        {
            options.Dsn = dsn;
            Configure(options);
        });
        return builder;
    }

    /// <summary>Adds the Sentry Serilog sink when a DSN is configured; otherwise returns the configuration unchanged.</summary>
    public static LoggerConfiguration WriteToErrorReporting(this LoggerConfiguration loggerConfiguration, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(loggerConfiguration);
        if (!IsEnabled(configuration))
        {
            return loggerConfiguration;
        }

        return loggerConfiguration.WriteTo.Sentry(sink =>
        {
            sink.MinimumEventLevel = LogEventLevel.Error;
            sink.MinimumBreadcrumbLevel = LogEventLevel.Information;
        });
    }

    /// <summary>
    /// The SDK settings this service runs with. Applied AFTER the <c>Sentry</c> configuration section is bound, so the
    /// privacy settings here cannot be loosened from configuration.
    /// </summary>
    public static void Configure(SentryAspNetCoreOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        options.SendDefaultPii = false;
        options.MaxRequestBodySize = RequestSize.None;
        options.CaptureFailedRequests = false;
        options.DisableSentryHttpMessageHandler = true;
        options.AutoSessionTracking = false;

        // Errors only. The Serilog sink would otherwise also ship EVERY log line as a Sentry "log" (the SDK's
        // structured-logs product), with all of its properties — query strings included. Dropped unconditionally.
        options.EnableLogs = false;
        options.SetBeforeSendLog(static _ => null);

        options.UseSerilog();

        options.SetBeforeSend(SentryPayloadScrubber.Scrub);
        options.SetBeforeSendTransaction(SentryPayloadScrubber.Scrub);
        options.SetBeforeBreadcrumb(SentryPayloadScrubber.Scrub);
    }

    // The SDK rejects a malformed DSN with an exception at host build; checking first gives a clear, DSN-free message.
    private static bool IsWellFormedDsn(string dsn) =>
        Uri.TryCreate(dsn, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
        && !string.IsNullOrEmpty(uri.UserInfo)
        && uri.AbsolutePath.Trim('/').Length > 0;
}
