namespace Tims.Application.Hris;

/// <summary>
/// The PER-CONNECTOR authentication context threaded from one <c>hris_connectors</c> row into its
/// <see cref="IHrisConnector"/> call, so each org's sync authenticates against ITS OWN provider tenant —
/// NEVER a shared global credential or base URL (the multi-tenant-isolation invariant). <see cref="SecretRef"/>
/// is the opaque pointer the <see cref="IConnectorSecretStore"/> resolves to the API key; <see cref="Subdomain"/>
/// selects the provider tenant the connector builds its base URL for. Both are REQUIRED for an active
/// connector: the sync use case FAILS the run closed (never falls back to a global tenant) when either is
/// missing, so two org connectors can never pull the same source tenant and cross-persist its PII.
/// </summary>
public sealed record HrisConnectorAuthContext(string SecretRef, string Subdomain);
