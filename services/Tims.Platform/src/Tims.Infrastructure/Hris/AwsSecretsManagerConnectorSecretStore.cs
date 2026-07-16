using Tims.Application.Hris;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// STUB implementation of <see cref="IConnectorSecretStore"/> reserved for AWS Secrets Manager
/// credential resolution — DEFERRED to WP3.4 (creds work). It is interface-only: no AWS SDK dependency
/// is wired yet, and every call throws <see cref="NotSupportedException"/> so an accidental production
/// wiring fails loudly rather than silently returning no credential. The dev path is
/// <see cref="EnvConnectorSecretStore"/>.
/// </summary>
public sealed class AwsSecretsManagerConnectorSecretStore : IConnectorSecretStore
{
    public Task<ConnectorSecret> GetAsync(string secretRef, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "AWS Secrets Manager credential resolution is deferred to WP3.4; no AWS SDK is wired yet. " +
            "Use EnvConnectorSecretStore for dev/local.");
}
