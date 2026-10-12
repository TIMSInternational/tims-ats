using System.Net;
using Npgsql;

namespace Tims.Workers;

/// <summary>
/// Startup gate for <c>Platform:DatabaseConnectionString</c>. <see cref="PlatformOptions"/> only carries
/// <c>[Required]</c>, which ACCEPTS two values that must never reach a running scheduler:
/// <list type="bullet">
///   <item>the literal <c>REPLACE_ME_OUT_OF_BAND</c> that <c>deploy/terraform/main.tf</c> seeds into every managed
///   secret before the owner sets the real value — a public string from this repository, and</item>
///   <item>the <c>appsettings.json</c> dev default (<c>Host=localhost</c>), which is what the host silently falls back
///   to when the ECS secret injection is missing. Because every DbContext is lazy and <c>/health</c> runs no DB
///   check, that host would stay "healthy" forever while every FX/HRIS fire failed.</item>
/// </list>
/// Both fail the process at boot instead (ValidateOnStart), so ECS's deployment circuit breaker rolls back rather
/// than leaving a green task that does nothing. The value is never logged or echoed in the failure message.
/// </summary>
public static class DatabaseConnectionStringGuard
{
    /// <summary>The placeholder the Terraform module writes into every secret (see CronCallerGate in Tims.Api).</summary>
    public const string TerraformPlaceholder = "REPLACE_ME_OUT_OF_BAND";

    public const string FailureMessage =
        "Platform:DatabaseConnectionString is unusable: it is empty, contains the Terraform placeholder " +
        "REPLACE_ME_OUT_OF_BAND, cannot be parsed, has no Host, or (outside Development/Testing) points at a " +
        "loopback host such as the appsettings.json default. Set the real secret value; the value itself is not logged.";

    /// <summary>
    /// True when the connection string is usable. <paramref name="requireRemoteHost"/> is set for every
    /// non-Development environment: production must never fall back to the loopback dev default.
    /// </summary>
    public static bool IsUsable(string? connectionString, bool requireRemoteHost)
    {
        if (string.IsNullOrWhiteSpace(connectionString) ||
            connectionString.Contains(TerraformPlaceholder, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        NpgsqlConnectionStringBuilder parsed;
        try
        {
            parsed = new NpgsqlConnectionStringBuilder(connectionString);
        }
        catch (ArgumentException)
        {
            return false;
        }

        var hosts = (parsed.Host ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (hosts.Length == 0)
        {
            return false;
        }

        return !requireRemoteHost || hosts.All(host => !IsLoopback(host));
    }

    private static bool IsLoopback(string host)
    {
        // Npgsql allows "host:port" entries in a multi-host list; strip a trailing :port (not for bare IPv6).
        var name = host;
        if (name.StartsWith('[') && name.Contains(']'))
        {
            name = name[1..name.IndexOf(']')];
        }
        else if (name.Count(c => c == ':') == 1)
        {
            name = name[..name.IndexOf(':')];
        }

        if (string.Equals(name, "localhost", StringComparison.OrdinalIgnoreCase) || name.StartsWith('/'))
        {
            // A leading '/' is a Unix-domain socket directory — local by definition.
            return true;
        }

        return IPAddress.TryParse(name, out var ip) && IPAddress.IsLoopback(ip);
    }
}
