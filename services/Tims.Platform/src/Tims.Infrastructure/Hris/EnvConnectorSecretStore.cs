using System.Text;
using Tims.Application.Hris;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// DEV / local implementation of <see cref="IConnectorSecretStore"/>: resolves a secret reference to
/// a value read from an environment variable. It carries NO real credentials — a developer exports the
/// placeholder locally. The production AWS Secrets Manager implementation is deferred to WP3.4 behind
/// the same port (<see cref="AwsSecretsManagerConnectorSecretStore"/>).
///
/// Fail-closed: an unconfigured reference throws (never returns an empty credential). The exception
/// message names the REFERENCE and the env-var NAME only — never a secret value.
/// </summary>
public sealed class EnvConnectorSecretStore : IConnectorSecretStore
{
    public Task<ConnectorSecret> GetAsync(string secretRef, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(secretRef);
        cancellationToken.ThrowIfCancellationRequested();

        var envName = ToEnvVarName(secretRef);
        var value = Environment.GetEnvironmentVariable(envName);
        if (string.IsNullOrEmpty(value))
        {
            throw new InvalidOperationException(
                $"HRIS connector secret '{secretRef}' is not configured (expected environment variable " +
                $"'{envName}'). The dev secret store carries no real credentials.");
        }

        return Task.FromResult(new ConnectorSecret(value));
    }

    /// <summary>Maps a secret reference (e.g. <c>bamboohr/api-key</c>) to an env-var name (<c>HRIS_SECRET_BAMBOOHR_API_KEY</c>).</summary>
    internal static string ToEnvVarName(string secretRef)
    {
        var builder = new StringBuilder("HRIS_SECRET_");
        foreach (var c in secretRef)
        {
            builder.Append(char.IsLetterOrDigit(c) ? char.ToUpperInvariant(c) : '_');
        }

        return builder.ToString();
    }
}
