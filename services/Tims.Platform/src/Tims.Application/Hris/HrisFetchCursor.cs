namespace Tims.Application.Hris;

/// <summary>
/// An OPAQUE paging token for an HRIS directory fetch. BambooHR's directory endpoint returns a single
/// page, but the connector contract is designed for paging providers: a fetch returns the next cursor
/// (or null when exhausted), and the caller passes it back to continue. The <see cref="Value"/> is
/// provider-defined and MUST be treated as opaque by the application/sync layer.
/// </summary>
public sealed record HrisFetchCursor(string Value);
