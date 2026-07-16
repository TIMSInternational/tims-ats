using Tims.Domain.Hris;

namespace Tims.Application.Hris;

/// <summary>
/// The provider-agnostic port a sync use case drives to pull employee data from an HRIS source. An
/// implementation (Phase 3: <c>BambooHrConnector</c>) owns transport, auth, resilience and payload
/// parsing, and returns provider-neutral <see cref="HrisSourceEmployee"/> field-bags — the mapper
/// (<see cref="BambooHrEmployeeMapper"/>) turns those into canonical <see cref="ExternalEmployee"/>s.
/// </summary>
public interface IHrisConnector
{
    /// <summary>
    /// Fetches one page of the employee directory using the PER-CONNECTOR <paramref name="auth"/> (its own
    /// secret + subdomain) — never a global credential/URL. Pass <paramref name="cursor"/> = null for the
    /// first page and the returned <see cref="HrisDirectoryPage.Next"/> to continue until it is null.
    /// </summary>
    Task<HrisDirectoryPage> FetchDirectoryAsync(
        HrisConnectorAuthContext auth, HrisFetchCursor? cursor, CancellationToken cancellationToken);

    /// <summary>
    /// Fetches the full record for a single employee by its source-side external id, using the
    /// PER-CONNECTOR <paramref name="auth"/>.
    /// </summary>
    Task<HrisSourceEmployee> FetchEmployeeAsync(
        HrisConnectorAuthContext auth, string externalId, CancellationToken cancellationToken);
}
