namespace Tims.Application.Hris;

/// <summary>
/// The credentials SEAM. Resolves a connector's stored secret REFERENCE (e.g.
/// <c>hris_connectors.secret_ref</c> — an opaque pointer, NEVER the secret itself) to its
/// <see cref="ConnectorSecret"/>. Phase 3 wires a dev/in-memory implementation; the AWS Secrets
/// Manager implementation is deferred to WP3.4 behind this same port, so no code above Infrastructure
/// changes when real credential storage lands.
/// </summary>
public interface IConnectorSecretStore
{
    /// <summary>
    /// Resolves <paramref name="secretRef"/> to its secret. Implementations MUST fail closed
    /// (throw) when the reference is unknown/unconfigured rather than returning an empty credential.
    /// </summary>
    Task<ConnectorSecret> GetAsync(string secretRef, CancellationToken cancellationToken);
}
