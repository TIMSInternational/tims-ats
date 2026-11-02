namespace Tims.Workers.HealthChecks;

/// <summary>
/// The container-level liveness probe for the Fargate deployment (docs/runbooks/workers-deploy.md).
/// The <c>aspnet</c> runtime image ships neither curl nor wget, so the ECS task-definition health check
/// re-invokes this same binary: <c>dotnet Tims.Workers.dll --healthcheck</c>. That mode performs ONE GET
/// against the host's own <c>/health</c> liveness endpoint on loopback and exits <c>0</c> on 2xx, <c>1</c>
/// otherwise — it never builds the host, never reads configuration, and never touches the database
/// (liveness must not flap on a DB outage; <c>/ready</c> covers that).
///
/// <para>The target is pinned to loopback: an override URL whose host is not loopback is rejected, so the
/// probe can never be pointed at another service.</para>
/// </summary>
public static class ContainerHealthProbe
{
    public const string Flag = "--healthcheck";

    /// <summary>The image's listener (<c>ASPNETCORE_URLS=http://+:8080</c>) as seen from inside the container.</summary>
    public static readonly Uri DefaultTarget = new("http://127.0.0.1:8080/health");

    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(3);

    public static bool IsProbeInvocation(string[] args) =>
        args.Length > 0 && string.Equals(args[0], Flag, StringComparison.Ordinal);

    /// <summary>
    /// Resolves the probe target: the default, or an explicit loopback http URL given as the second argument.
    /// Returns null for anything else (non-loopback host, non-http scheme, malformed).
    /// </summary>
    public static Uri? ResolveTarget(string[] args)
    {
        if (args.Length < 2)
        {
            return DefaultTarget;
        }

        return Uri.TryCreate(args[1], UriKind.Absolute, out var uri)
               && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
               && uri.IsLoopback
               && uri.UserInfo.Length == 0
            ? uri
            : null;
    }

    /// <summary>One GET; 0 when the response is 2xx, 1 on any non-2xx status, timeout or transport failure.</summary>
    public static async Task<int> ProbeAsync(HttpClient client, Uri target, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentNullException.ThrowIfNull(target);
        try
        {
            using var response = await client.GetAsync(target, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            return 1;
        }
    }

    /// <summary>The <c>--healthcheck</c> entry point used by Program.cs. Writes one line to stdout/stderr (no secrets exist here).</summary>
    public static async Task<int> RunAsync(string[] args)
    {
        var target = ResolveTarget(args);
        if (target is null)
        {
            await Console.Error.WriteLineAsync("healthcheck: target must be an http(s) loopback URL").ConfigureAwait(false);
            return 2;
        }

        using var client = new HttpClient { Timeout = Timeout };
        var code = await ProbeAsync(client, target, CancellationToken.None).ConfigureAwait(false);
        Console.WriteLine(code == 0 ? "healthcheck: ok" : "healthcheck: unhealthy");
        return code;
    }
}
